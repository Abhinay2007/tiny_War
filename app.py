"""Tiny Army — HF Space, a Gradio Blocks app.

Gradio is the host/shell: gr.Blocks → gr.Tabs, mounted on FastAPI via
gr.mount_gradio_app, with tab-switching and the page served by Gradio. The tabs
differ in how much Gradio UI they use:
  • Battle / Sprite Animations — each is just an empty `gr.HTML` div that a head-
    injected ES module (web/tiny.js) fills with our OWN UI: Pixi canvas + the
    shared, framework-agnostic render core and chrome (auto-battler's
    spriteScene.js / spritePlayground.js, bundled to web/, styled by
    web/shell/spriteScene.css). These tabs use NO Gradio widgets — they're custom
    canvas surfaces inside the Gradio shell. (Sprite Animations previously used
    gr.Dropdown/gr.Button; those were replaced by the shared playground.)
  • Barracks — genuine Gradio widgets (gr.Textbox × 2 + gr.Button) wired to a
    Python diary() fn (stub — to be backed by a local llama.cpp small model).
Sprite data is auto-battler's own static manifest + sheets under web/assets.
"""
import json
import asyncio
import json as _json
import os
import pathlib
import re
import threading
import time

# Local dev convenience: load a sibling .env (HF_TOKEN, TINY_*_SPACE keys, etc.) so
# `python app.py` picks them up the same way the HF Space gets them from secrets.
# override=False → if a var is already set in the real environment (as on the
# Space, where there is no .env), that value wins. Optional dep, so a missing
# install just skips it.
try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except ImportError:
    pass

# ZeroGPU requires the spaces shim to be imported before torch. Locally, or on
# non-ZeroGPU hardware, this falls back to a no-op decorator.
try:
    import spaces  # type: ignore

    GPU = spaces.GPU
except Exception:  # pragma: no cover
    def GPU(*dargs, **dkwargs):  # noqa: N802 - mirror spaces.GPU
        def wrap(fn):
            return fn
        if len(dargs) == 1 and callable(dargs[0]) and not dkwargs:
            return dargs[0]
        return wrap

import gradio as gr
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, Response
from fastapi.staticfiles import StaticFiles
import base64
import urllib.request
import urllib.error

import llm
import persona_parse
import prompts

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "web")
USE_GRADIO_SERVER = os.environ.get("TINY_GRADIO_SERVER", "").lower() in ("1", "true", "yes")

# The Sprite tab's character picker + controls are built entirely by the shared
# playground (web/playground.js) from /sprites/characters.json — no Python-side
# dropdown/buttons needed anymore.

# NOTE: link sidebar.css here (head) rather than via mount's css_paths — Gradio
# auto-scopes css_paths/css= selectors with a `.gradio-container .contain` prefix,
# which breaks rules that target <body> or .gradio-container itself (our slide +
# content-push). A plain <link> is injected unscoped, so the shared file applies
# verbatim — same stylesheet the React app uses.
# `upgrade-insecure-requests`: behind HF's custom-domain proxy Gradio emits its
# theme.css link as http:// (the app doesn't see HTTPS), which the HTTPS page
# blocks as mixed content — so the theme font never loads. This CSP upgrades such
# same-host http subresources to https in the browser, fixing it deterministically
# regardless of proxy headers.
# Hide Gradio's tab bar — the sidebar is the sole navigation. Keep it off-screen
# at a fixed wide width (NOT display:none): Gradio's tab bar is width-responsive
# and DROPS overflowing tabs from the DOM on narrow screens, which would leave the
# sidebar unable to find/click them (mobile nav breaks). Off-screen-but-wide keeps
# every tab button present so the sidebar can drive navigation on any viewport.
HIDE_TABS = ('<style>.tab-container[role="tablist"]{position:absolute!important;'
             'left:-99999px!important;top:0!important;width:1400px!important;}</style>')
# Auto-battler's fonts.
FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
         'family=Fraunces:opsz,wght@9..144,400..900&family=JetBrains+Mono:wght@400;500;700&'
         'family=Space+Grotesk:wght@400;500;600;700&display=swap">')
# Parchment theme, applied THEME-INDEPENDENTLY: we override Gradio's own colour +
# font CSS variables with `!important`, so the app renders identically whether the
# OS is in light or DARK mode (Gradio's dark mode turns text white #f3f4f6, which
# was unreadable on parchment). No `?__theme=` redirect — that was fragile and hid
# dark mode from testing. The vars below are Gradio's theme tokens; overriding them
# at the root cascades to every component.
PALETTE = (
    "--body-background-fill:#f3ebdc;--background-fill-primary:#f3ebdc;"
    "--background-fill-secondary:#ece2cc;--body-text-color:#141821;"
    "--body-text-color-subdued:#6d6a5f;--block-background-fill:#fbf6ea;"
    "--block-label-text-color:#141821;--block-title-text-color:#141821;"
    "--input-background-fill:#fbf6ea;--input-text-color:#141821;"
    "--border-color-primary:#cdbf9e;--neutral-200:#ece2cc;"
    "--button-secondary-background-fill:#ece2cc;--button-secondary-text-color:#141821;"
    "--link-text-color:#d8271a;"
    "--font:'Space Grotesk',-apple-system,BlinkMacSystemFont,sans-serif;"
    "--font-mono:'JetBrains Mono',ui-monospace,Menlo,monospace;"
)
# !important on each token so they beat Gradio's light AND dark definitions.
PALETTE_IMP = ";".join(p + " !important" for p in PALETTE.rstrip(";").split(";")) + ";"
THEME = ('<style>'
         f'body,gradio-app,.gradio-container,.gradio-container.dark,.dark{{{PALETTE_IMP}}}'
         "body,gradio-app,.gradio-container{background:#f3ebdc !important;color:#141821 !important;"
         "font-family:'Space Grotesk',-apple-system,sans-serif !important;}"
         # Sprite tab fills the WHOLE content area, like the main sidebar. The
         # picker lives in Gradio's flow (pushed ~110px down, bounded by the tab
         # box) so it can't reach full height there — so we lift the stage out of
         # flow with position:fixed to span top→bottom, right of the main sidebar.
         # Gradio still hides it (display:none on the inactive tab's ancestor).
         '.gradio-container .tabitem{padding:0 !important;}'
         '.gradio-container .tabs{border:0 !important;}'
         '#sprite-stage,#persona-stage,#diary-stage,#classes-stage,#enemies-stage,#worldmap-stage{position:fixed !important;top:0;bottom:0;'
         'right:0;left:var(--tac-w,240px);height:auto !important;z-index:1;}'
         'body.tac-collapsed #sprite-stage,body.tac-collapsed #persona-stage,'
         'body.tac-collapsed #diary-stage,body.tac-collapsed #classes-stage,body.tac-collapsed #enemies-stage,'
         'body.tac-collapsed #worldmap-stage{left:0;}'
         '@media (max-width:768px){#sprite-stage,#persona-stage,#diary-stage,#classes-stage,#enemies-stage,#worldmap-stage{left:0;}}'
         # The Game stage ALWAYS spans the full width (left:0) — the sidebar (z-index 1000) slides OVER
         # it as a drawer instead of pushing/resizing the canvas, so toggling it never leaves a blank
         # strip where the map hasn't re-rendered into the resized area.
         '#battle-stage{position:fixed !important;top:0;bottom:0;left:0;right:0;height:auto !important;z-index:1;}'
         # Gradio's relocated footer links (Use via API / Built with Gradio / Settings), styled to look
         # like the sidebar nav items WITHOUT the tac-nav-item class — that class makes sidebar.js hijack
         # the click (mark them active = white, and swallow navigation). web/tiny.js copies the reference
         # nav item's padding onto them; here we mirror the rest (icon on the left, hover, colour).
         '#tac-extlinks .tac-extlink{display:flex !important;align-items:center;gap:8px !important;width:100%;'
         'min-height:0 !important;background:none !important;border:0 !important;border-radius:0 !important;'
         'box-shadow:none !important;justify-content:flex-start !important;text-align:left !important;'
         'color:var(--tac-ink) !important;font-family:var(--tac-font) !important;font-size:14px !important;'
         'font-weight:500 !important;text-decoration:none !important;cursor:pointer;}'
         '#tac-extlinks .tac-extlink:hover{background:var(--tac-bg-2) !important;}'
         '#tac-extlinks .tac-extlink img,#tac-extlinks .tac-extlink svg{order:-1;width:18px !important;height:18px !important;flex-shrink:0;margin:0 !important;}'
         '</style>')
# `upgrade-insecure-requests` is needed on the HTTPS Space (prevents mixed-content behind HF's
# TLS edge) but BREAKS plain-http LAN testing: it forces every asset/manifest/frame URL to https
# on a server with no TLS → ERR_SSL_PROTOCOL_ERROR. Only emit it when actually deployed on HF
# (SPACE_ID/SPACE_HOST are set there); local `python app.py` over http omits it and just works.
_CSP = ('<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">'
        if (os.environ.get("SPACE_ID") or os.environ.get("SPACE_HOST")) else '')

# Mobile zoom is a readability hazard for a full-screen game: pinch-zoom + double-tap zoom drift
# the canvas, and focusing a text input auto-zooms on iOS. Lock the viewport (re-asserted, since
# Gradio sets its own), keep inputs at 16px (iOS only zooms on <16px focus), kill double-tap via
# touch-action, and block iOS gesture (pinch) events.
NOZOOM = (
    '<style>'
    'html,body,gradio-app,.gradio-container{touch-action:manipulation;}'
    '.gradio-container input,.gradio-container textarea,.gradio-container select,'
    'input,textarea,select{font-size:16px !important;}'
    '</style>'
    '<script>(function(){'
    'function vp(){var m=document.querySelector("meta[name=viewport]");'
    'if(!m){m=document.createElement("meta");m.setAttribute("name","viewport");document.head.appendChild(m);}'
    'm.setAttribute("content","width=device-width, initial-scale=1, maximum-scale=1, '
    'minimum-scale=1, user-scalable=no, viewport-fit=cover");}'
    'vp();document.addEventListener("DOMContentLoaded",vp);setTimeout(vp,800);setTimeout(vp,2500);'
    '["gesturestart","gesturechange","gestureend"].forEach(function(e){'
    'document.addEventListener(e,function(ev){ev.preventDefault();},{passive:false});});'
    '})();</script>'
)
HEAD = (_CSP + NOZOOM
        + HIDE_TABS + FONTS + THEME +
        '<link rel="stylesheet" href="/web/shell/tokens.css">'
        '<link rel="stylesheet" href="/web/shell/sidebar.css">'
        '<link rel="stylesheet" href="/web/shell/spriteScene.css">'
        '<link rel="stylesheet" href="/web/shell/persona.css">'
        '<link rel="stylesheet" href="/web/shell/classes.css">'
        '<link rel="stylesheet" href="/web/shell/worldmap.css">'
        '<script type="module" src="/web/tiny.js"></script>'
        '<script src="/web/shell/sidebar.js"></script>')
# The Game stage fills the whole content area (full-screen map), like the other stages — the
# `#battle-stage` rules above lift it out of Gradio's flow; this just sets the load-time background.
STAGE = "background:#0b0e12"


# Shared app-shell sidebar: rendered from the SAME nav.json + sidebar.css +
# sidebar.js the React app uses (src/shell/*). Here we just template the IR into
# the markup; the CSS styles it and the JS slides/collapses it — proving the
# chrome is shareable across React and Gradio from one source.
def build_sidebar(nav):
    # Render from the shared nav IR. An item belongs on the Space when it carries a
    # `space` field = the Gradio tab label it navigates to (data-target, matched by
    # sidebar.js against the tab buttons). React-only sandbox items (href but no
    # `space`) and sections with no space-items are skipped.
    b = nav.get("brand", {})
    # Brand block mirrors the app's .sidebar-title: a big display-font title with a
    # red dot, plus a small uppercase subtitle.
    out = ['<aside class="tac-sidebar">',
           '<div class="tac-brand">'
           '<div class="tac-brand-row">'
           f'<strong class="tac-title">{b.get("title","")}</strong>'
           '<button class="tac-collapse tac-toggle" title="Collapse">‹</button>'
           '</div>'
           f'<p class="tac-subtitle">{b.get("subtitle","")}</p>'
           '</div>']
    first = True  # mark the default page active (matches Gradio's first/open tab)
    for sec in nav.get("sections", []):
        items = [it for it in sec.get("items", []) if it.get("space")]
        if not items:
            continue
        out.append('<div class="tac-section">')
        if sec.get("title"):
            out.append(f'<div class="tac-section-title">{sec["title"]}</div>')
        if sec.get("title") == "App":
            # The App section is filled entirely by web/tiny.js, which relocates Gradio's footer links
            # (Use via API, Built with Gradio, Settings) here — so all three share the same treatment
            # instead of Settings being a special nav item routed back to the footer.
            out.append('<div id="tac-extlinks"></div>')
        else:
            for it in items:
                cls = "tac-nav-item active" if first else "tac-nav-item"
                first = False
                out.append(f'<a class="{cls}" data-target="{it["space"]}" href="#">'
                           f'<span class="tac-ico">{it.get("icon","")}</span><span>{it["label"]}</span></a>')
        out.append('</div>')
    out.append('</aside>')
    out.append('<button class="tac-toggle tac-reopen" title="Open menu">›</button>')
    return "".join(out)


SIDEBAR_HTML = build_sidebar(json.load(open(os.path.join(WEB, "shell", "nav.json"))))


def diary(unit, traits):
    """Streaming war-diary via the llama.cpp runtime. A Gradio generator: each yield
    replaces the output Textbox, so tokens appear live. Falls back to a stub line if
    the model can't load, so the Barracks tab always works."""
    header = f"— Diary of {(unit or 'a nameless soldier').strip()} —\n\n"
    yield header + "_(summoning the model — the first run downloads it, please wait…)_"
    try:
        acc = header
        first = True
        for chunk in llm.stream_chat(
            prompts.DIARY_SYSTEM, prompts.diary_user_prompt(unit, traits),
            max_tokens=240, temperature=0.9,
        ):
            if first:
                acc = header  # drop the loading note once tokens arrive
                first = False
            acc += chunk
            yield acc
        if first:  # produced nothing
            yield header + "Today I held the line."
    except llm.LlmUnavailable as e:
        yield header + f"Today I held the line. _(model unavailable: {e})_"


with gr.Blocks(title="Tiny Army") as ui:
    gr.HTML(SIDEBAR_HTML)
    with gr.Tabs():
        with gr.Tab("Battle") as battle_tab:
            gr.HTML(f'<div id="battle-stage" style="{STAGE}"></div>')
        with gr.Tab("Sprite Animations") as sprite_tab:
            # The shared playground (web/playground.js) builds the whole page —
            # team picker (a sidebar) + the framed canvas stage + chrome — into this
            # div. No dark box here: the picker is the sidebar, the canvas is the
            # stage (framed by CSS), so it mirrors auto-battler's layout.
            gr.HTML('<div id="sprite-stage" style="overflow:hidden"></div>')
        with gr.Tab("Skill Forge"):
            # Sandbox: the Coding Model (Settings → Coding Model) authors a combat skill
            # for a chosen hero. Filled by web/skillForgePanel.js.
            gr.HTML('<div id="skillforge-stage" style="overflow:hidden"></div>')
        with gr.Tab("Classes"):
            # Sandbox: the shared Classes playground (web/classesSandbox.js, synced from
            # auto-battler) — class picker + WASD combat + customize panel.
            gr.HTML('<div id="classes-stage" style="overflow:hidden"></div>')
        with gr.Tab("Enemies"):
            # Sandbox: the shared Enemies playground (web/enemiesSandbox.js) — enemy
            # roster + WASD combat + stats/skill customize panel.
            gr.HTML('<div id="enemies-stage" style="overflow:hidden"></div>')
        with gr.Tab("World Map"):
            # Sandbox: the shared Map playground (web/mapSandbox.js, synced from auto-battler)
            # — pill switcher + all six map sub-pages (World Map / Necropolis / Orc Kingdom /
            # Forgotten Plains / Interiors / Towers), each with Generated/Tilesheet/Reference.
            gr.HTML('<div id="worldmap-stage" style="overflow:hidden"></div>')
        # Pixi canvases start hidden (0×0); re-measure them when a tab is shown.
        battle_tab.select(None, None, None, js="()=>window.tinyResize&&window.tinyResize()")
        sprite_tab.select(None, None, None, js="()=>window.tinyResize&&window.tinyResize()")
        with gr.Tab("Barracks"):
            # In-browser war-diary (web/diaryPanel.js → wllama, llama.cpp WASM). Runs
            # entirely on the visitor's device — no server inference.
            gr.HTML('<div id="diary-stage" style="overflow:hidden"></div>')
        with gr.Tab("Personas"):
            # In-browser persona generator (web/personaPanel.js → wllama).
            gr.HTML('<div id="persona-stage" style="overflow:hidden"></div>')
        # NOTE: the engine/model picker is injected into Gradio's OWN settings page
        # (footer "Settings" → ?view=settings) by web/settingsPanel.js — not a tab.

# Mount Gradio on FastAPI so we can also serve the JS module + the sprite assets.
fastapi_app = gr.Server() if USE_GRADIO_SERVER else FastAPI()


@fastapi_app.get("/health")
async def health():
    """Lightweight container/platform health check; model services are optional."""
    return {"status": "ok"}


# Behind HF's custom-domain proxy Gradio emits its theme.css <link> as http://
# (the app doesn't see HTTPS), and that link is in the HTML *before* our head=
# meta — so a meta CSP can't upgrade it in time. Sending the CSP as a response
# HEADER governs the whole document regardless of in-page order, so the browser
# upgrades the http theme.css (and any other mixed content) to https.
@fastapi_app.middleware("http")
async def upgrade_insecure(request, call_next):
    resp = await call_next(request)
    # ONLY on the HTTPS Space (see the _CSP note above). On a plain-http LAN this header would
    # force every asset/manifest/favicon to https on a TLS-less server → ERR_SSL_PROTOCOL_ERROR,
    # so local `python app.py` over http must NOT send it.
    if os.environ.get("SPACE_ID") or os.environ.get("SPACE_HOST"):
        resp.headers["Content-Security-Policy"] = "upgrade-insecure-requests"
    # Our /web modules change on every deploy; without this the browser serves a
    # stale cached .js (e.g. old token caps) heuristically. no-cache = always
    # revalidate (cheap 304 via etag when unchanged). Model weights are fetched
    # from huggingface.co, not here, so this doesn't affect their caching.
    if request.url.path.startswith("/web/"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


fastapi_app.mount("/web", StaticFiles(directory=WEB), name="web")
# NOTE: serve sprite assets at /sprites, NOT /assets — Gradio serves its own UI
# bundle from /assets, and mounting there shadows it (breaks the whole UI).
fastapi_app.mount("/sprites", StaticFiles(directory=os.path.join(WEB, "assets")), name="sprites")
# Skill + condition icons for the Classes sandbox (curated subset under web/gw).
fastapi_app.mount("/gw", StaticFiles(directory=os.path.join(WEB, "gw")), name="gw")


def _sse(event, data):
    return f"event: {event}\ndata: {_json.dumps(data)}\n\n"


# ── Qwen3-TTS Voice Design (DashScope) ───────────────────────────────────────
# Server-side proxy so the DASHSCOPE_API_KEY secret never reaches the browser.
# Takes {text, instruct} (instruct = a natural-language voice description, e.g. the
# persona's `voice` field) and returns a 24 kHz WAV. NOT local-first — opt-in engine.
DASHSCOPE_KEY = os.environ.get("DASHSCOPE_API_KEY", "")
# International Model Studio keys (sk-ws-…) use the -intl host; mainland keys use the
# plain host. Default to intl (our key); override with DASHSCOPE_BASE if needed.
_DASHSCOPE_BASE = os.environ.get("DASHSCOPE_BASE", "https://dashscope-intl.aliyuncs.com")
_DASHSCOPE_URL = _DASHSCOPE_BASE + "/api/v1/services/audio/tts/customization"

# TINY_TTS_MODE=local → run the OPEN WEIGHTS in-process (your GPU, off the grid; same
# origin so no CORS/cert dance — the LeLab pattern). Needs `pip install qwen-tts torch
# soundfile`. Lazy-loaded; the Space (cpu-basic) leaves this unset and uses DashScope.
TTS_MODE = os.environ.get("TINY_TTS_MODE", "").strip().lower()
VOXCPM_SPACE = os.environ.get("TINY_VOXCPM_SPACE", "").strip()
# ACE-Step music + sung-vocal generation (local sidecar; see spaces/acestep-zerogpu). NB this is a
# MUSIC model — its "vocals" are sung lyrics, not speech; VoxCPM stays the path for dialogue/TTS.
ACESTEP_SPACE = os.environ.get("TINY_ACESTEP_SPACE", "").strip()
TINY_AYA_SPACE = os.environ.get("TINY_AYA_SPACE", "").strip()
MINICPM5_SPACE = os.environ.get("TINY_MINICPM5_SPACE", "").strip()
# Coding model (Skill Forge): Mellum2 is a ZeroGPU sidecar (same /generate contract as
# Aya); Nemotron-30B is too big to self-host, so it runs via hosted NVIDIA NIM (below).
MELLUM_SPACE = os.environ.get("TINY_MELLUM_SPACE", "").strip()
# BLS Mini-Code 1.0 (Cohere, 30B MoE): another ZeroGPU sidecar (same /generate contract).
# The sidecar suppresses the model's reasoning and streams clean code; see spaces/bls-code-zerogpu.
BLS_CODE_SPACE = os.environ.get("TINY_BLS_CODE_SPACE", "").strip()
_local_tts = None       # VoiceDesign model
_local_clone = None     # Base model (voice clone) — lazy, only if a clone is requested
_local_tts_lock = threading.Lock()


def _load(which):
    import torch
    from qwen_tts import Qwen3TTSModel
    mid = os.environ.get(
        "QWEN_TTS_MODEL" if which == "design" else "QWEN_TTS_CLONE_MODEL",
        "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign" if which == "design" else "Qwen/Qwen3-TTS-12Hz-1.7B-Base")
    dev = "cuda:0" if torch.cuda.is_available() else "cpu"
    dt = torch.bfloat16 if dev != "cpu" else torch.float32
    return Qwen3TTSModel.from_pretrained(mid, device_map=dev, dtype=dt)


def _local_voice_design(text, instruct, language="English"):
    global _local_tts
    import io, soundfile as sf
    with _local_tts_lock:  # one GPU model can't decode in parallel
        if _local_tts is None:
            _local_tts = _load("design")
        wavs, sr = _local_tts.generate_voice_design(
            text=text, language=language, instruct=instruct or "A clear, natural voice at a moderate pace.")
    out = io.BytesIO(); sf.write(out, wavs[0], sr, format="WAV")
    return out.getvalue()


def _local_voice_clone(text, ref_audio_b64, ref_text, language="English"):
    # Keep the SAME timbre as a previously-created voice by cloning from its audio (the
    # "Voice Design → Clone" workflow). qwen-tts wants ref_audio as a (numpy, sr) tuple
    # (a raw base64 string gets mistaken for a file path), so decode the WAV here.
    global _local_clone
    import io, soundfile as sf
    ref_np, ref_sr = sf.read(io.BytesIO(base64.b64decode(ref_audio_b64)))
    with _local_tts_lock:
        if _local_clone is None:
            _local_clone = _load("clone")
        wavs, sr = _local_clone.generate_voice_clone(
            text=text, language=language, ref_audio=(ref_np, ref_sr), ref_text=ref_text or "")
    out = io.BytesIO(); sf.write(out, wavs[0], sr, format="WAV")
    return out.getvalue()


def _dashscope_voice_design(text, instruct):
    payload = _json.dumps({
        "model": "qwen-voice-design",
        "input": {
            "action": "create",
            "voice_prompt": instruct or "A clear, natural voice at a moderate pace.",
            "preview_text": text,
            "target_model": "qwen3-tts-vd-realtime-2025-12-16",
            "preferred_name": "default",
        },
        "parameters": {"sample_rate": 24000, "response_format": "wav"},
    }).encode()
    req = urllib.request.Request(_DASHSCOPE_URL, data=payload, method="POST", headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {DASHSCOPE_KEY}",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            j = _json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return None, f"dashscope {e.code}: {e.read().decode()[:200]}"
    except Exception as e:  # noqa: BLE001
        return None, f"dashscope error: {e}"
    b64 = (j.get("output") or {}).get("preview_audio", {}).get("data")
    if not b64:
        return None, "no audio in response: " + _json.dumps(j)[:200]
    return base64.b64decode(b64), None


# Voice CLONE on the cloud is a TWO-CALL flow (mirrors the open-weights design→clone):
#   1. enroll the reference WAV (qwen-voice-enrollment) → a voice_id
#   2. synthesize new words in that timbre (qwen3-tts-vc-…) → an OSS-signed audio URL
# Synthesis returns the audio as a URL (not base64), so we fetch the bytes ourselves.
_DASHSCOPE_VC_MODEL = os.environ.get("DASHSCOPE_VC_MODEL", "qwen3-tts-vc-2026-01-22")
_DASHSCOPE_GEN_URL = _DASHSCOPE_BASE + "/api/v1/services/aigc/multimodal-generation/generation"


def _dashscope_post(url, payload):
    req = urllib.request.Request(url, data=_json.dumps(payload).encode(), method="POST", headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {DASHSCOPE_KEY}",
    })
    with urllib.request.urlopen(req, timeout=90) as r:
        return _json.loads(r.read().decode())


def _dashscope_voice_clone(text, ref_audio_b64, ref_text):
    try:
        enroll = _dashscope_post(_DASHSCOPE_URL, {
            "model": "qwen-voice-enrollment",
            "input": {
                "action": "create",
                "target_model": _DASHSCOPE_VC_MODEL,
                "preferred_name": "tinyarmy",
                "audio": {"data": "data:audio/wav;base64," + ref_audio_b64},
            },
        })
        voice_id = (enroll.get("output") or {}).get("voice")
        if not voice_id:
            return None, "no voice_id from enrollment: " + _json.dumps(enroll)[:200]
        gen = _dashscope_post(_DASHSCOPE_GEN_URL, {
            "model": _DASHSCOPE_VC_MODEL,
            "input": {"text": text, "voice": voice_id},
        })
    except urllib.error.HTTPError as e:
        return None, f"dashscope clone {e.code}: {e.read().decode()[:200]}"
    except Exception as e:  # noqa: BLE001
        return None, f"dashscope clone error: {e}"
    url = ((gen.get("output") or {}).get("audio") or {}).get("url")
    if not url:
        return None, "no audio url in response: " + _json.dumps(gen)[:200]
    try:
        with urllib.request.urlopen(url, timeout=90) as r:
            return r.read(), None
    except Exception as e:  # noqa: BLE001
        return None, f"dashscope clone fetch error: {e}"


@fastapi_app.post("/qwen-tts")
async def qwen_tts(request: Request):
    body = await request.json()
    text = (body.get("text") or "").strip()
    instruct = (body.get("instruct") or "").strip()
    language = body.get("language") or "English"
    ref_audio = body.get("ref_audio")  # base64 WAV → clone (keep timbre, new words)
    ref_text = body.get("ref_text") or ""
    if not text:
        return Response("text required", status_code=400)
    if TTS_MODE == "local":  # in-process open weights (dev)
        try:
            if ref_audio:
                wav = await asyncio.to_thread(_local_voice_clone, text, ref_audio, ref_text, language)
            else:
                wav = await asyncio.to_thread(_local_voice_design, text, instruct, language)
        except Exception as e:  # noqa: BLE001 — surface a clear setup hint
            return Response(f"local TTS error (pip install qwen-tts torch soundfile?): {e}", status_code=500)
        return Response(wav, media_type="audio/wav", headers={"Cache-Control": "no-store"})
    if not DASHSCOPE_KEY:
        return Response("DASHSCOPE_API_KEY not set (or run with TINY_TTS_MODE=local)", status_code=503)
    if ref_audio:  # clone the prior voice's timbre (enroll → synthesize)
        wav, err = await asyncio.to_thread(_dashscope_voice_clone, text, ref_audio, ref_text)
    else:
        wav, err = await asyncio.to_thread(_dashscope_voice_design, text, instruct)
    if err:
        return Response(err, status_code=502)
    return Response(wav, media_type="audio/wav", headers={"Cache-Control": "no-store"})


def _voxcpm_predict(api_name, *args):
    from gradio_client import Client
    client = Client(VOXCPM_SPACE, token=HF_TOKEN or None)
    last_err = None
    for attempt in range(3):
        try:
            return client.predict(*args, api_name=api_name)
        except Exception as e:  # noqa: BLE001
            last_err = e
            msg = str(e).lower()
            if attempt == 2 or not any(s in msg for s in ("accelerator", "queue", "gpu", "timeout", "temporarily")):
                raise
            time.sleep(1.5 * (attempt + 1))
    raise last_err


def _voxcpm_tts(text, instruct):
    result = _voxcpm_predict(
        "/synthesize",
        text,
        instruct or "A clear, natural voice at a moderate pace.",
    )
    path = result[0] if isinstance(result, (tuple, list)) else result
    with open(os.fspath(path), "rb") as f:
        return f.read()


def _voxcpm_clone(text, ref_audio_b64, ref_text, instruct):
    result = _voxcpm_predict(
        "/clone",
        text,
        ref_audio_b64,
        ref_text or "",
        instruct or "",
    )
    path = result[0] if isinstance(result, (tuple, list)) else result
    with open(os.fspath(path), "rb") as f:
        return f.read()


def _acestep_generate(prompt, lyrics, duration, steps, guidance, seed):
    """Call the ACE-Step sidecar's /generate and return the rendered WAV bytes. Same retry shape
    as _voxcpm_predict (the sidecar shares one GPU pipeline, so transient queue/GPU hiccups retry)."""
    from gradio_client import Client
    client = Client(ACESTEP_SPACE, token=HF_TOKEN or None)
    last_err = None
    for attempt in range(3):
        try:
            result = client.predict(
                prompt or "",
                lyrics or "",
                float(duration or 30.0),
                int(steps or 60),
                float(guidance if guidance is not None else 15.0),
                int(seed if seed is not None else -1),
                api_name="/generate",
            )
            path = result[0] if isinstance(result, (tuple, list)) else result
            with open(os.fspath(path), "rb") as f:
                return f.read()
        except Exception as e:  # noqa: BLE001
            last_err = e
            msg = str(e).lower()
            if attempt == 2 or not any(s in msg for s in ("accelerator", "queue", "gpu", "timeout", "temporarily")):
                raise
            time.sleep(1.5 * (attempt + 1))
    raise last_err


def _tiny_aya_generate(system, user, max_tokens, temperature):
    from gradio_client import Client
    client = Client(TINY_AYA_SPACE, token=HF_TOKEN or None)
    result = client.predict(
        system or "",
        user or "",
        int(max_tokens or 400),
        float(temperature if temperature is not None else 0.8),
        api_name="/generate",
    )
    return str(result or "")


def _space_text_generate(space, system, user, max_tokens, temperature, *extra):
    from gradio_client import Client
    client = Client(space, token=HF_TOKEN or None)
    result = client.predict(
        system or "",
        user or "",
        int(max_tokens or 400),
        float(temperature if temperature is not None else 0.8),
        *extra,  # optional trailing inputs (e.g. BLS sidecar's `think` flag)
        api_name="/generate",
    )
    return str(result or "")


def _space_text_stream(space, system, user, max_tokens, temperature, *extra):
    from gradio_client import Client
    client = Client(space, token=HF_TOKEN or None)
    try:
        job = client.submit(
            system or "",
            user or "",
            int(max_tokens or 400),
            float(temperature if temperature is not None else 0.8),
            *extra,  # optional trailing inputs (e.g. BLS sidecar's `think` flag)
            api_name="/generate_stream",
        )
        prev = ""
        for update in job:
            text = update[0] if isinstance(update, (tuple, list)) else update
            text = str(text or "")
            if len(text) > len(prev):
                yield text[len(prev):]
            prev = text
    except Exception:
        text = _space_text_generate(space, system, user, max_tokens, temperature, *extra)
        if text:
            yield text


def _tiny_aya_stream(system, user, max_tokens, temperature):
    yield from _space_text_stream(TINY_AYA_SPACE, system, user, max_tokens, temperature)


def _minicpm5_stream(system, user, max_tokens, temperature):
    yield from _space_text_stream(MINICPM5_SPACE, system, user, max_tokens, temperature)


def _mellum_stream(system, user, max_tokens, temperature):
    yield from _space_text_stream(MELLUM_SPACE, system, user, max_tokens, temperature)


def _nim_text_stream(system, user, max_tokens, temperature, model=None, think=False):
    """Stream from NVIDIA NIM's OpenAI-compatible chat endpoint (hosted Nemotron). Same
    nvapi-… key as the portrait NIM. think=False sets reasoning_budget=0 to keep the coding
    output clean (Nemotron defaults thinking ON); think=True lets it reason and surfaces the
    reasoning_content wrapped in <think>…</think> ahead of the answer, so the caller can show
    it in a debug panel (same convention as the persona models)."""
    model = model or _NIM_NEMOTRON_MODEL  # defined later in the file; resolve at call time
    messages = []
    if system and system.strip():
        messages.append({"role": "system", "content": system.strip()})
    messages.append({"role": "user", "content": (user or "").strip()})
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": int(max_tokens or 512),
        "temperature": float(temperature if temperature is not None else 0.6),
        "top_p": 0.95,
        "stream": True,
    }
    if not think:
        payload["reasoning_budget"] = 0  # omit entirely to let Nemotron reason
    body = _json.dumps(payload).encode()
    req = urllib.request.Request(_NIM_TEXT_URL, data=body, method="POST", headers={
        "Authorization": f"Bearer {NIM_KEY}", "Content-Type": "application/json", "Accept": "text/event-stream",
    })
    think_open = False
    with urllib.request.urlopen(req, timeout=120) as resp:
        for raw in resp:
            line = raw.decode("utf-8").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                delta = _json.loads(data)["choices"][0]["delta"]
            except Exception:  # noqa: BLE001
                continue
            reasoning = delta.get("reasoning_content") if think else None
            content = delta.get("content")
            if reasoning:
                if not think_open:
                    yield "<think>"
                    think_open = True
                yield reasoning
            if content:
                if think_open:
                    yield "</think>\n"
                    think_open = False
                yield content
    if think_open:
        yield "</think>\n"


def _mellum_stream_with_fallback(system, user, max_tokens, temperature):
    """Mellum2 ZeroGPU sidecar, falling back to Nemotron (NVIDIA NIM) when the sidecar is
    unavailable (asleep / GPU quota / error) BEFORE any token streams. Once Mellum2 has
    emitted output we can't restart cleanly, so a later failure just propagates."""
    emitted = False
    try:
        if not MELLUM_SPACE:
            raise llm.LlmUnavailable("TINY_MELLUM_SPACE not set")
        for chunk in _mellum_stream(system, user, max_tokens, temperature):
            emitted = True
            yield chunk
    except Exception:  # noqa: BLE001
        if emitted or not NIM_KEY:
            raise
        yield from _nim_text_stream(system, user, max_tokens, temperature)


def _bls_code_stream(system, user, max_tokens, temperature, think=False):
    # `think` is the BLS sidecar's optional 5th input; passed through _space_text_stream's *extra.
    yield from _space_text_stream(BLS_CODE_SPACE, system, user, max_tokens, temperature, bool(think))


def _bls_code_stream_with_fallback(system, user, max_tokens, temperature, think=False):
    """BLS Mini-Code ZeroGPU sidecar, falling back to Nemotron (NVIDIA NIM) if the sidecar is
    unavailable BEFORE any token streams (same constraint as Mellum2: can't switch mid-stream)."""
    emitted = False
    try:
        if not BLS_CODE_SPACE:
            raise llm.LlmUnavailable("TINY_BLS_CODE_SPACE not set")
        for chunk in _bls_code_stream(system, user, max_tokens, temperature, think):
            emitted = True
            yield chunk
    except Exception:  # noqa: BLE001
        if emitted or not NIM_KEY:
            raise
        yield from _nim_text_stream(system, user, max_tokens, temperature, think=think)


@fastapi_app.post("/voxcpm-tts")
async def voxcpm_tts(request: Request):
    body = await request.json()
    text = (body.get("text") or "").strip()
    instruct = (body.get("instruct") or "").strip()
    if not text:
        return Response("text required", status_code=400)
    if not VOXCPM_SPACE:
        return Response("TINY_VOXCPM_SPACE not set", status_code=503)
    try:
        wav = await asyncio.to_thread(_voxcpm_tts, text, instruct)
    except Exception as e:  # noqa: BLE001
        return Response(f"VoxCPM error: {e}", status_code=502)
    return Response(wav, media_type="audio/wav", headers={"Cache-Control": "no-store"})


@fastapi_app.post("/voxcpm-clone")
async def voxcpm_clone(request: Request):
    body = await request.json()
    text = (body.get("text") or "").strip()
    ref_audio = body.get("ref_audio") or ""
    ref_text = body.get("ref_text") or ""
    instruct = (body.get("instruct") or "").strip()
    if not text:
        return Response("text required", status_code=400)
    if not ref_audio:
        return Response("ref_audio required", status_code=400)
    if not VOXCPM_SPACE:
        return Response("TINY_VOXCPM_SPACE not set", status_code=503)
    try:
        wav = await asyncio.to_thread(_voxcpm_clone, text, ref_audio, ref_text, instruct)
    except Exception as e:  # noqa: BLE001
        return Response(f"VoxCPM clone error: {e}", status_code=502)
    return Response(wav, media_type="audio/wav", headers={"Cache-Control": "no-store"})


@fastapi_app.post("/api/music")
async def api_music(request: Request):
    """Generate music (and optional sung vocals) with the ACE-Step sidecar. Returns a WAV.
    Body: {prompt, lyrics?, duration?, steps?, guidance?, seed?}. prompt = tags/style;
    lyrics blank or "[inst]" = instrumental."""
    body = await request.json()
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        return Response("prompt required", status_code=400)
    if not ACESTEP_SPACE:
        return Response("TINY_ACESTEP_SPACE not set", status_code=503)
    lyrics = body.get("lyrics") or ""
    duration = body.get("duration", 30.0)
    steps = body.get("steps", 60)
    guidance = body.get("guidance", 15.0)
    seed = body.get("seed", -1)
    try:
        wav = await asyncio.to_thread(_acestep_generate, prompt, lyrics, duration, steps, guidance, seed)
    except Exception as e:  # noqa: BLE001
        return Response(f"ACE-Step error: {e}", status_code=502)
    return Response(wav, media_type="audio/wav", headers={"Cache-Control": "no-store"})


# ── Durable media store (portraits / voices / skill art / chat audio) ─────────
# The client caches these blobs in browser IndexedDB, but IndexedDB is blocked/evicted when the
# Space runs inside HuggingFace's cross-origin <iframe> — so created heroes lose their portrait +
# voice on reload (the persona record itself survives because it lives in localStorage, which the
# iframe keeps). Mirror the blobs SERVER-SIDE, keyed by the id the client already holds in
# localStorage. Same-origin fetch works fine in the iframe; only browser *storage* is partitioned.
# Stored on disk: HF persistent storage (/data) when mounted (survives rebuilds), else a local dir
# (per-container). Override with TINY_DATA_DIR.
_DATA_DIR = pathlib.Path(
    os.environ.get("TINY_DATA_DIR")
    or ("/data" if os.path.isdir("/data") and os.access("/data", os.W_OK)
        else os.path.join(os.path.dirname(os.path.abspath(__file__)), "user_data"))
)
_BLOB_STORES = {"portraits", "voices", "skillIcons", "skillArt", "chatAudio"}
_BLOB_ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,128}$")


def _blob_path(store: str, blob_id: str):
    """Validated path for a media blob, or None if the store/id is invalid (path-traversal guard)."""
    if store not in _BLOB_STORES or not _BLOB_ID_RE.match(blob_id or ""):
        return None
    d = _DATA_DIR / "media" / store
    d.mkdir(parents=True, exist_ok=True)
    return d / blob_id


def _ct_path(p: pathlib.Path):
    return pathlib.Path(str(p) + ".ct")  # sidecar holding the blob's content-type


@fastapi_app.post("/api/blob/{store}/{blob_id}")
async def put_blob(store: str, blob_id: str, request: Request):
    p = _blob_path(store, blob_id)
    if p is None:
        return Response("bad store/id", status_code=400)
    data = await request.body()
    if not data:
        return Response("empty body", status_code=400)
    ct = request.headers.get("content-type") or "application/octet-stream"
    try:
        await asyncio.to_thread(p.write_bytes, data)
        await asyncio.to_thread(_ct_path(p).write_text, ct)
    except Exception as e:  # noqa: BLE001
        return Response(f"save failed: {e}", status_code=500)
    return Response(status_code=204)


@fastapi_app.get("/api/blob/{store}/{blob_id}")
async def get_blob(store: str, blob_id: str):
    p = _blob_path(store, blob_id)
    if p is None or not p.exists():
        return Response(status_code=404)
    ctp = _ct_path(p)
    ct = ctp.read_text().strip() if ctp.exists() else "application/octet-stream"
    return Response(p.read_bytes(), media_type=ct, headers={"Cache-Control": "no-store"})


@fastapi_app.delete("/api/blob/{store}/{blob_id}")
async def del_blob(store: str, blob_id: str):
    p = _blob_path(store, blob_id)
    if p is not None and p.exists():
        try:
            p.unlink()
            _ct_path(p).unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass
    return Response(status_code=204)


# ── Persona portraits (image generation) ─────────────────────────────────────
# Mirrors the voice path: TINY_IMAGE_MODE=local runs the OPEN WEIGHTS on your GPU
# (Z-Image-Turbo, 6B, ~12 GB bf16 — coexists with the TTS model on a 24 GB card);
# otherwise we proxy a cloud provider so its key stays server-side. Returns a PNG.
IMAGE_MODE = os.environ.get("TINY_IMAGE_MODE", "").strip().lower()
HF_TOKEN = os.environ.get("HF_TOKEN", "")
NIM_KEY = os.environ.get("NVIDIA_NIM_API_KEY", "")
_NIM_BASE = "https://ai.api.nvidia.com/v1/genai"
# NIM text/LLM lives on a DIFFERENT host (OpenAI-compatible chat completions) than the
# image/genai host above, but uses the same nvapi-… key. Powers the Nemotron coding model.
_NIM_TEXT_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
_NIM_NEMOTRON_MODEL = os.environ.get("TINY_NEMOTRON_NIM_MODEL", "nvidia/nemotron-3-nano-30b-a3b")
# id -> NIM FLUX preset (same shapes woid uses: schnell fast, dev higher quality).
_NIM_PROVIDERS = {
    "flux-schnell": {"model": "black-forest-labs/flux.1-schnell", "steps": 4, "cfg": 0.0},
    "flux-dev": {"model": "black-forest-labs/flux.1-dev", "steps": 28, "cfg": 3.5},
}
_MIN_IMAGE_BYTES = 15_000  # smaller than this = a blank/safety-blocked frame → retry

_img_pipe = None
_img_lock = threading.Lock()
_klein_pipe = None
_klein_lock = threading.Lock()
_KLEIN_MODEL_ID = os.environ.get("TINY_KLEIN_MODEL", "black-forest-labs/FLUX.2-klein-4B")
_KLEIN_STEPS = int(os.environ.get("TINY_KLEIN_STEPS", "4"))
_KLEIN_GUIDANCE = float(os.environ.get("TINY_KLEIN_GUIDANCE", "1.0"))
_KLEIN_SPACE = os.environ.get("TINY_KLEIN_SPACE", "").strip()


def _load_image_pipe():
    import torch
    from diffusers import ZImagePipeline
    mid = os.environ.get("TINY_IMAGE_MODEL", "Tongyi-MAI/Z-Image-Turbo")
    if not torch.cuda.is_available():
        return ZImagePipeline.from_pretrained(mid, torch_dtype=torch.float32).to("cpu")
    dt = torch.bfloat16
    # GUARDRAIL: the 3090 also drives the desktop, so cap THIS process's VRAM — a spike can
    # then never grab the whole card and crash the display (it OOM-errors instead). Default
    # ~60% of 24 GB ≈ 14 GB; measured peak is ~8 GB, so there's comfortable headroom.
    try:
        torch.cuda.set_per_process_memory_fraction(float(os.environ.get("TINY_IMAGE_VRAM_FRAC", "0.6")), 0)
    except Exception:  # noqa: BLE001
        pass
    if os.environ.get("TINY_IMAGE_QUANT", "1").lower() not in ("0", "false", "no"):
        # 4-bit NF4 quantize the 6B transformer (~12 GB bf16 → ~3 GB). With cpu-offload the
        # measured peak is ~8 GB (vs ~20 GB unquantized, which crashed the display), and the
        # VRAM frees between generations. Portrait quality is effectively unchanged.
        from diffusers import ZImageTransformer2DModel, BitsAndBytesConfig
        quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=dt)
        transformer = ZImageTransformer2DModel.from_pretrained(mid, subfolder="transformer", quantization_config=quant, torch_dtype=dt)
        pipe = ZImagePipeline.from_pretrained(mid, transformer=transformer, torch_dtype=dt)
    else:
        pipe = ZImagePipeline.from_pretrained(mid, torch_dtype=dt)
    # Non-transformer components stream CPU↔GPU per forward; VRAM returns to ~0 when idle.
    pipe.enable_model_cpu_offload()
    return pipe


def _local_portrait(prompt, seed=None, width=1024, height=1024, steps=9):
    global _img_pipe
    import io
    import torch
    with _img_lock:  # one GPU model can't decode in parallel
        if _img_pipe is None:
            _img_pipe = _load_image_pipe()
        gen = None
        if seed is not None:
            dev = "cuda" if torch.cuda.is_available() else "cpu"
            gen = torch.Generator(dev).manual_seed(int(seed))
        img = _img_pipe(prompt=prompt, height=height, width=width,
                        num_inference_steps=steps, guidance_scale=0.0, generator=gen).images[0]
    out = io.BytesIO(); img.save(out, format="PNG")
    return out.getvalue()


def _load_klein_pipe():
    import torch
    from diffusers import Flux2KleinPipeline
    return Flux2KleinPipeline.from_pretrained(_KLEIN_MODEL_ID, torch_dtype=torch.bfloat16)


def _remote_klein_portrait(prompt, seed=None, ref_image=None):
    import os as _os
    import base64 as _b64
    import tempfile as _tmp
    from gradio_client import Client
    client = Client(_KLEIN_SPACE, token=HF_TOKEN or None)
    s = int(seed if seed is not None else 42)
    ref_path = None
    if ref_image:
        try:
            raw = ref_image.split(",", 1)[1] if "," in ref_image else ref_image  # strip a data: URL prefix
            fd, ref_path = _tmp.mkstemp(suffix=".png")
            with _os.fdopen(fd, "wb") as f:
                f.write(_b64.b64decode(raw))
        except Exception:  # noqa: BLE001 — a bad ref just falls back to text-only
            ref_path = None
    try:
        if ref_path:
            from gradio_client import handle_file
            # generate(prompt, seed, lora, ref_image[pose], ref_image2[identity]). No LoRA so the
            # identity comes from the reference; pass the portrait as the identity ref.
            result = client.predict(prompt, s, "", None, handle_file(ref_path), api_name="/generate")
        else:
            result = client.predict(prompt, s, api_name="/generate")
    except Exception:  # noqa: BLE001 — remote may not accept the extra args; retry text-only
        result = client.predict(prompt, s, api_name="/generate")
    finally:
        if ref_path:
            try:
                _os.unlink(ref_path)
            except Exception:  # noqa: BLE001
                pass
    path = result[0] if isinstance(result, (tuple, list)) else result
    with open(_os.fspath(path), "rb") as f:
        return f.read()


def _decode_ref_image(ref_image):
    """base64 PNG / data-URL string -> PIL.Image (RGB), or None. Used as a FLUX.2 identity ref."""
    if not ref_image:
        return None
    try:
        import io
        import base64 as _b64
        from PIL import Image
        raw = ref_image.split(",", 1)[1] if "," in ref_image else ref_image  # strip a data: URL prefix
        return Image.open(io.BytesIO(_b64.b64decode(raw))).convert("RGB")
    except Exception:  # noqa: BLE001 — a bad ref just falls back to text-only
        return None


@GPU(duration=60)
def _klein_portrait(prompt, seed=None, width=1024, height=1024, ref_image=None):
    """FLUX.2 [klein] 4B for ZeroGPU-backed portrait generation. `ref_image` (base64) is an identity
    reference (e.g. a hero's portrait) so a generated scene depicts THAT character — native multi-image
    conditioning, same as the klein-zerogpu sidecar's generate()."""
    global _klein_pipe
    import io
    import random
    import torch
    ref = _decode_ref_image(ref_image)
    with _klein_lock:
        if _klein_pipe is None:
            _klein_pipe = _load_klein_pipe()
        dev = "cuda" if torch.cuda.is_available() else "cpu"
        _klein_pipe.to(dev)
        s = int(seed if seed is not None else random.randint(0, 2_147_483_647))
        kwargs = dict(
            prompt=prompt, width=width, height=height,
            num_inference_steps=_KLEIN_STEPS, guidance_scale=_KLEIN_GUIDANCE,
            generator=torch.Generator(device=dev).manual_seed(s),
        )
        if ref is not None:
            kwargs["image"] = ref
        img = _klein_pipe(**kwargs).images[0]
        if dev == "cuda":
            _klein_pipe.to("cpu")
            try:
                torch.cuda.empty_cache()
            except Exception:
                pass
    out = io.BytesIO(); img.save(out, format="PNG")
    return out.getvalue()


def _nim_portrait(prompt, provider="flux-schnell", width=1024, height=1024):
    import random
    p = _NIM_PROVIDERS.get(provider, _NIM_PROVIDERS["flux-schnell"])
    url = f"{_NIM_BASE}/{p['model']}"
    for _ in range(3):  # retry under the blank/safety-blocked threshold (woid's guard)
        payload = _json.dumps({
            "prompt": prompt, "cfg_scale": p["cfg"], "width": width, "height": height,
            "seed": random.randint(0, 2_147_483_647), "steps": p["steps"],
        }).encode()
        req = urllib.request.Request(url, data=payload, method="POST", headers={
            "Authorization": f"Bearer {NIM_KEY}", "Content-Type": "application/json", "Accept": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                j = _json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            return None, f"nim image {e.code}: {e.read().decode()[:200]}"
        except Exception as e:  # noqa: BLE001
            return None, f"nim image error: {e}"
        b64 = j.get("image") or (j.get("artifacts") or [{}])[0].get("base64")
        if not b64:
            continue
        data = base64.b64decode(b64)
        if len(data) >= _MIN_IMAGE_BYTES:
            return data, None
    return None, "image kept coming back blank — safety-blocked prompt?"


def _hf_portrait(prompt, model="black-forest-labs/FLUX.1-schnell"):
    # HF Inference (text-to-image) returns raw image bytes; reuses our existing HF_TOKEN.
    url = f"https://api-inference.huggingface.co/models/{model}"
    payload = _json.dumps({"inputs": prompt}).encode()
    req = urllib.request.Request(url, data=payload, method="POST", headers={
        "Authorization": f"Bearer {HF_TOKEN}", "Content-Type": "application/json", "Accept": "image/png",
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        return None, f"hf image {e.code}: {e.read().decode()[:200]}"
    except Exception as e:  # noqa: BLE001
        return None, f"hf image error: {e}"
    if len(data) < _MIN_IMAGE_BYTES:
        return None, "hf returned a tiny/blank image"
    return data, None


def _img_mime(data):
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"  # NIM/FLUX returns JPEG
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"   # local Z-Image
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


@fastapi_app.post("/portrait")
async def portrait(request: Request):
    body = await request.json()
    prompt = (body.get("prompt") or "").strip()
    seed = body.get("seed")
    provider = body.get("provider") or ""  # cloud sub-provider hint (e.g. flux-dev)
    engine = (body.get("engine") or "").strip().lower()  # 'local' | 'klein' | 'cloud' | '' = auto
    ref_image = body.get("ref_image")  # optional base64 PNG — an identity reference for Klein (e.g. the
    #                                    character's portrait), so a generated skill image shows THAT character.
    if not prompt:
        return Response("prompt required", status_code=400)
    want_local = engine == "local" or (not engine and IMAGE_MODE == "local")
    want_klein = (
        engine in ("klein", "zerogpu")
        or provider in ("flux-klein-4b", "klein-4b")
        or (not engine and IMAGE_MODE in ("klein", "zerogpu", "klein-zerogpu"))
    )
    if want_local:  # in-process open weights on your GPU (dev)
        if IMAGE_MODE != "local":
            return Response("local image mode not enabled (run with TINY_IMAGE_MODE=local)", status_code=503)
        try:
            png = await asyncio.to_thread(_local_portrait, prompt, seed)
        except Exception as e:  # noqa: BLE001 — surface a clear setup hint
            return Response(f"local image error (pip install 'git+https://github.com/huggingface/diffusers' accelerate?): {e}", status_code=500)
        return Response(png, media_type="image/png", headers={"Cache-Control": "no-store"})
    if want_klein:
        try:
            if _KLEIN_SPACE:
                png = await asyncio.to_thread(_remote_klein_portrait, prompt, seed, ref_image)
            else:
                png = await asyncio.to_thread(_klein_portrait, prompt, seed, 1024, 1024, ref_image)
        except Exception as e:  # noqa: BLE001
            return Response(f"klein image error: {e}", status_code=500)
        return Response(png, media_type="image/png", headers={"Cache-Control": "no-store"})
    # Cloud: prefer NVIDIA NIM (woid's FLUX path), else HF Inference (our HF_TOKEN).
    if NIM_KEY:
        png, err = await asyncio.to_thread(_nim_portrait, prompt, provider or "flux-schnell")
    elif HF_TOKEN:
        png, err = await asyncio.to_thread(_hf_portrait, prompt)
    else:
        return Response("no image provider (set NVIDIA_NIM_API_KEY / HF_TOKEN, or TINY_IMAGE_MODE=local)", status_code=503)
    if err:
        return Response(err, status_code=502)
    return Response(png, media_type=_img_mime(png), headers={"Cache-Control": "no-store"})


@fastapi_app.get("/persona/status")
def persona_status():
    return llm.status()


@fastapi_app.get("/persona/selftest")
def persona_selftest():
    """Measure pure generation speed inside the Space (no proxy, no lock race)."""
    import time
    t0 = time.time()
    n = 0
    try:
        for _ in llm.stream_chat("You are terse.", "Count from one to twenty.",
                                 max_tokens=24, temperature=0.1):
            n += 1
    except Exception as e:
        return {"error": str(e), "tokens": n, "seconds": round(time.time() - t0, 2)}
    s = time.time() - t0
    return {"tokens": n, "seconds": round(s, 2),
            "tok_per_sec": round(n / s, 2) if s else None, **llm.status()}


@fastapi_app.post("/text/generate/stream")
async def text_generate_stream(request: Request):
    body = await request.json()
    model = (body.get("model") or "server-local").strip()
    system = body.get("system") or ""
    user = body.get("user") or ""
    max_tokens = int(body.get("max_tokens") or body.get("maxTokens") or 400)
    temperature = float(body.get("temperature") if body.get("temperature") is not None else 0.8)
    # When set, reasoning models (Nemotron, BLS) surface their <think> trace instead of hiding it.
    think = bool(body.get("think"))
    stop = threading.Event()

    async def gen():
        yield _sse("model", {"model": model})
        loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue()
        DONE = object()

        def worker():
            try:
                if model == "tiny-aya-global-zerogpu":
                    if not TINY_AYA_SPACE:
                        raise llm.LlmUnavailable("TINY_AYA_SPACE not set")
                    for chunk in _tiny_aya_stream(system, user, max_tokens, temperature):
                        if stop.is_set():
                            break
                        loop.call_soon_threadsafe(q.put_nowait, ("delta", chunk))
                elif model == "minicpm5-1b-zerogpu":
                    if not MINICPM5_SPACE:
                        raise llm.LlmUnavailable("TINY_MINICPM5_SPACE not set")
                    for chunk in _minicpm5_stream(system, user, max_tokens, temperature):
                        if stop.is_set():
                            break
                        loop.call_soon_threadsafe(q.put_nowait, ("delta", chunk))
                elif model == "mellum2-zerogpu":
                    # Mellum2 sidecar, with Nemotron NIM as fallback if it's unavailable.
                    if not MELLUM_SPACE and not NIM_KEY:
                        raise llm.LlmUnavailable("TINY_MELLUM_SPACE not set")
                    for chunk in _mellum_stream_with_fallback(system, user, max_tokens, temperature):
                        if stop.is_set():
                            break
                        loop.call_soon_threadsafe(q.put_nowait, ("delta", chunk))
                elif model == "bls-mini-code-zerogpu":
                    # BLS Mini-Code sidecar, with Nemotron NIM as fallback if it's unavailable.
                    if not BLS_CODE_SPACE and not NIM_KEY:
                        raise llm.LlmUnavailable("TINY_BLS_CODE_SPACE not set")
                    for chunk in _bls_code_stream_with_fallback(system, user, max_tokens, temperature, think):
                        if stop.is_set():
                            break
                        loop.call_soon_threadsafe(q.put_nowait, ("delta", chunk))
                elif model == "nemotron-3-nano-30b-nim":
                    if not NIM_KEY:
                        raise llm.LlmUnavailable("NVIDIA_NIM_API_KEY not set")
                    for chunk in _nim_text_stream(system, user, max_tokens, temperature, think=think):
                        if stop.is_set():
                            break
                        loop.call_soon_threadsafe(q.put_nowait, ("delta", chunk))
                else:
                    for chunk in llm.stream_chat(
                        system,
                        user,
                        max_tokens=max_tokens,
                        temperature=temperature,
                        should_stop=stop.is_set,
                    ):
                        loop.call_soon_threadsafe(q.put_nowait, ("delta", chunk))
            except Exception as e:  # noqa: BLE001
                loop.call_soon_threadsafe(q.put_nowait, ("error", str(e)))
            loop.call_soon_threadsafe(q.put_nowait, (DONE, None))

        threading.Thread(target=worker, daemon=True).start()

        try:
            while True:
                kind, val = await q.get()
                if kind is DONE:
                    break
                if kind == "error":
                    yield _sse("error", {"error": val})
                    return
                yield _sse("delta", {"content": val})
        finally:
            stop.set()
        yield _sse("done", {"model": model})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    })


# Persona generation, woid-protocol-compatible so web/personaStream.js consumes it
# unchanged: emits `model` → `delta`* → `persona-done` → `done` (or `error`). The
# blocking llama.cpp generator runs in a worker thread bridged to this async SSE
# generator via a thread-safe queue, so it never stalls uvicorn's event loop.
# Defined BEFORE mount_gradio_app so the "/" Gradio mount doesn't shadow it.
@fastapi_app.post("/persona/generate/stream")
async def persona_generate_stream(request: Request):
    body = await request.json()
    seed = body.get("seed", "")
    unit_class = body.get("class") or body.get("unitClass") or ""

    stop = threading.Event()  # set when the client disconnects → worker stops, lock frees

    async def gen():
        yield _sse("model", {"model": llm.model_id()})
        loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue()
        DONE = object()

        def worker():
            try:
                for chunk in llm.stream_chat(
                    prompts.PERSONA_SYSTEM, prompts.persona_user_prompt(unit_class, seed),
                    max_tokens=160, temperature=0.8, should_stop=stop.is_set,
                ):
                    loop.call_soon_threadsafe(q.put_nowait, ("delta", chunk))
            except Exception as e:  # LlmUnavailable or runtime error
                loop.call_soon_threadsafe(q.put_nowait, ("error", str(e)))
            loop.call_soon_threadsafe(q.put_nowait, (DONE, None))

        threading.Thread(target=worker, daemon=True).start()

        raw_parts = []
        try:
            while True:
                kind, val = await q.get()
                if kind is DONE:
                    break
                if kind == "error":
                    yield _sse("error", {"error": val})
                    return
                raw_parts.append(val)
                yield _sse("delta", {"content": val})
        finally:
            stop.set()  # client gone or stream done → release the model

        try:
            p = persona_parse.parse_persona_json("".join(raw_parts))
        except Exception as e:
            yield _sse("error", {"error": f"could not parse persona: {e}"})
            return
        payload = {"name": p["name"], "about": p["about"], "specialty": p["specialty"],
                   "personality": p["personality"], "vibe": p["vibe"], "profileModel": llm.model_id()}
        yield _sse("persona-done", payload)
        yield _sse("done", {**payload, "_generator": {"model": llm.model_id()}})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    })


app = gr.mount_gradio_app(fastapi_app, ui, path="/", head=HEAD, theme=gr.themes.Soft())
demo = app if USE_GRADIO_SERVER else ui


if __name__ == "__main__":
    # The default UI runs the model IN THE BROWSER (wllama). The Python llama.cpp path
    # stays as a lazy fallback (only loads if /persona/generate/stream is hit), so we
    # don't pre-download it here.
    if USE_GRADIO_SERVER:
        app.launch(
            server_name="0.0.0.0",
            server_port=int(os.environ.get("PORT", "7860")),
            head=HEAD,
            theme=gr.themes.Soft(),
        )
    else:
        # proxy_headers + trusting forwarded IPs lets Gradio honour X-Forwarded-Proto
        # from HF's edge, so it generates https (not http) asset URLs behind the proxy.
        uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "7860")),
                    proxy_headers=True, forwarded_allow_ips="*")
