# Tiny Army — BLS Mini-Code 1.0 ZeroGPU coding sidecar.
#
# Exposes the SAME Gradio contract as the Mellum2 / Tiny Aya sidecars so the main app's
# gradio_client can talk to it unchanged (see app.py:_space_text_stream / _space_text_generate):
#   /generate_stream(system, user, max_tokens:int, temperature:float) -> str   # CUMULATIVE text, streamed
#   /generate(system, user, max_tokens:int, temperature:float)        -> str   # final text, one shot
#
# Model: CohereLabs/BLS-Mini-Code-1.0 — 30B MoE (cohere2_moe), BF16 only upstream (no FP8
# weight published as of 2026-06), so we quantize AT LOAD via bitsandbytes to fit the ZeroGPU
# H200 slice. TINY_BLS_QUANT selects 4bit (default, ~18GB) / 8bit (~32GB) / bf16 (~60GB, tight).
#
# REASONING: BLS-Mini-Code is a Cohere reasoning model. Its chat template, with
# add_generation_prompt=True, force-opens <|START_RESPONSE|> (non-reasoning mode) — which makes
# the model dump its reasoning as prose into the answer. Instead we open a <|START_THINKING|>
# block so it reasons in a dedicated section we DISCARD, and we stream only the clean code from
# <|START_RESPONSE|>…<|END_RESPONSE|>. TINY_BLS_THINK_BUDGET extra tokens are reserved for the
# (discarded) thinking so the requested max_tokens still applies to the visible code.
import os
import threading

import gradio as gr
import spaces
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer

MODEL_ID = os.environ.get("TINY_BLS_MODEL", "CohereLabs/BLS-Mini-Code-1.0")
QUANT = os.environ.get("TINY_BLS_QUANT", "4bit").strip().lower()
GPU_DURATION = int(os.environ.get("TINY_BLS_GPU_DURATION", "120"))
THINK_BUDGET = int(os.environ.get("TINY_BLS_THINK_BUDGET", "1024"))

START_THINK, END_THINK = "<|START_THINKING|>", "<|END_THINKING|>"
START_RESP, END_RESP = "<|START_RESPONSE|>", "<|END_RESPONSE|>"
_STRIP = (START_THINK, END_THINK, START_RESP, END_RESP,
          "<|START_TEXT|>", "<|END_TEXT|>", "<|END_OF_TURN_TOKEN|>")

print(f"[bls-code] loading {MODEL_ID} quant={QUANT}", flush=True)

_tok = AutoTokenizer.from_pretrained(MODEL_ID)


def _load_kwargs():
    kw = {"torch_dtype": torch.bfloat16, "device_map": "cuda"}
    if QUANT == "bf16":
        return kw
    from transformers import BitsAndBytesConfig

    if QUANT == "8bit":
        kw["quantization_config"] = BitsAndBytesConfig(load_in_8bit=True)
    else:  # 4bit (default)
        kw["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
        )
    return kw


_model = AutoModelForCausalLM.from_pretrained(MODEL_ID, **_load_kwargs())
_model.eval()
print("[bls-code] model ready", flush=True)


def _build_inputs(system, user):
    messages = []
    if system and system.strip():
        messages.append({"role": "system", "content": system.strip()})
    messages.append({"role": "user", "content": (user or "").strip()})
    text = _tok.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)
    # The template force-opens <|START_RESPONSE|> (non-reasoning). Swap it for a thinking block
    # so the model reasons where we can discard it, leaving clean code in the response section.
    t = text.rstrip()
    if t.endswith(START_RESP):
        text = t[: -len(START_RESP)] + START_THINK
    enc = _tok(text, return_tensors="pt", add_special_tokens=False)
    return {k: v.to(_model.device) for k, v in enc.items()}


def _clean(s):
    for mark in _STRIP:
        s = s.replace(mark, "")
    return s


def _split(raw):
    """Split a (possibly partial) raw decode into (thinking, response, response_started):
    everything before <|START_RESPONSE|> (or <|END_THINKING|>) is reasoning; the rest, up to
    <|END_RESPONSE|>, is the answer."""
    resp_i = raw.find(START_RESP)
    if resp_i != -1:
        think_part, resp, started = raw[:resp_i], raw[resp_i + len(START_RESP):], True
    else:
        end_t = raw.find(END_THINK)
        if end_t != -1:
            think_part, resp, started = raw[:end_t], raw[end_t + len(END_THINK):], True
        else:
            think_part, resp, started = raw, "", False
    k = resp.find(END_RESP)
    if k != -1:
        resp = resp[:k]
    return _clean(think_part).strip(), _clean(resp).strip(), started


def _render(raw, think):
    """Cumulative output string. think=False → clean answer only (reasoning discarded).
    think=True → reasoning wrapped in <think>…</think> ahead of the answer; the main app
    strips it for the clean view but shows it in a debug panel (same convention the persona
    models use), so the user can watch the model reason."""
    thinking, resp, started = _split(raw)
    if not think:
        return resp
    if started:
        return f"<think>\n{thinking}\n</think>\n{resp}".strip()
    return f"<think>\n{thinking}".strip()


def _gen_kwargs(inputs, max_tokens, temperature):
    temp = float(temperature if temperature is not None else 0.6)
    kw = dict(
        **inputs,
        # Reserve THINK_BUDGET on top so the discarded reasoning doesn't eat the code budget.
        max_new_tokens=int(max_tokens or 512) + THINK_BUDGET,
        do_sample=temp > 0,
        pad_token_id=_tok.pad_token_id or _tok.eos_token_id,
    )
    if temp > 0:
        kw.update(temperature=temp, top_p=0.95)
    return kw


@spaces.GPU(duration=GPU_DURATION)
def generate_stream(system, user, max_tokens, temperature, think=False):
    """Stream CUMULATIVE output. think=False suppresses reasoning (clean code only); think=True
    streams the reasoning live wrapped in <think>…</think>. The main app diffs successive yields
    into deltas. On failure, yield the traceback so it isn't a silent empty stream."""
    try:
        inputs = _build_inputs(system, user)
        # skip_special_tokens=False so we can SEE the thinking/response markers and split on them.
        streamer = TextIteratorStreamer(_tok, skip_prompt=True, skip_special_tokens=False)
        kw = _gen_kwargs(inputs, max_tokens, temperature)
        kw["streamer"] = streamer
        err = {}

        def _run():
            try:
                _model.generate(**kw)
            except Exception:  # noqa: BLE001
                import traceback
                err["tb"] = traceback.format_exc()
                streamer.end()

        thread = threading.Thread(target=_run)
        thread.start()
        acc, emitted = "", False
        for piece in streamer:
            acc += piece
            # When hiding thinking, emit nothing until the response block opens.
            if not think and not _split(acc)[2]:
                continue
            emitted = True
            yield _render(acc, think)
        thread.join()
        if err:
            yield (_render(acc, think) + "\n[GENERATE ERROR]\n" + err["tb"])
        elif not emitted:
            yield _render(acc, think) or "[EMPTY OUTPUT — no response block produced]"
    except Exception:  # noqa: BLE001
        import traceback
        yield "[SETUP ERROR]\n" + traceback.format_exc()


@spaces.GPU(duration=GPU_DURATION)
def generate(system, user, max_tokens, temperature, think=False):
    try:
        inputs = _build_inputs(system, user)
        out = _model.generate(**_gen_kwargs(inputs, max_tokens, temperature))
        raw = _tok.decode(out[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=False)
        return _render(raw, think) or "[EMPTY OUTPUT]"
    except Exception:  # noqa: BLE001
        import traceback
        return "[ERROR]\n" + traceback.format_exc()


# Minimal UI; the named API endpoints are what the main app consumes.
with gr.Blocks(title="BLS Mini-Code 1.0 — Tiny Army sidecar") as demo:
    gr.Markdown("## BLS Mini-Code 1.0 — ZeroGPU coding sidecar")
    sys_in = gr.Textbox(label="system", lines=2)
    usr_in = gr.Textbox(label="user", lines=6)
    mt_in = gr.Slider(16, 2048, value=512, step=16, label="max_tokens")
    temp_in = gr.Slider(0.0, 1.5, value=0.6, step=0.05, label="temperature")
    # 5th input — defaults False so existing 4-arg API callers keep getting clean code.
    think_in = gr.Checkbox(value=False, label="show thinking (wrap reasoning in <think>…</think>)")
    out = gr.Textbox(label="output", lines=12)
    with gr.Row():
        stream_btn = gr.Button("Stream", variant="primary")
        once_btn = gr.Button("Generate")
    stream_btn.click(
        generate_stream, [sys_in, usr_in, mt_in, temp_in, think_in], out, api_name="generate_stream"
    )
    once_btn.click(generate, [sys_in, usr_in, mt_in, temp_in, think_in], out, api_name="generate")

if __name__ == "__main__":
    demo.queue().launch()
