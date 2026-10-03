from __future__ import annotations

# LOCAL SIDECAR for ACE-Step (https://github.com/ace-step/ACE-Step) — music + sung-vocal
# generation, run on the local 3090 instead of a hosted Space so the main app burns no HF quota.
#
# Gradio API contract (so the main app's gradio_client talks to it the same way it talks to the
# other sidecars):
#   /generate(prompt, lyrics, audio_duration:float, infer_step:int, guidance_scale:float, seed:int)
#       -> audio file path (wav)
#
# Notes:
#   * ACE-Step is a *music* model. "Vocals" = lyrics SUNG inside a track (give it tags + lyrics
#     with [verse]/[chorus] markers). It is NOT speech TTS — VoxCPM stays the tool for dialogue.
#     Leave `lyrics` blank (or "[inst]") for an instrumental.
#   * ACE-Step pins transformers==4.50 / accelerate==1.6 which conflict with the aya/klein
#     sidecars' transformers>=5.4 — so this sidecar runs in its OWN venv (.venv-acestep). The
#     run_sidecars.sh `acestep` case launches it with that interpreter.
#   * cpu_offload=True keeps peak VRAM ~8 GB so it coexists with the shared text-encoder server
#     (same philosophy as klein's sequential offload). Set TINY_ACESTEP_OFFLOAD=0 when the card
#     is free for full-speed GPU-resident inference.
#   * First run downloads ~3.5B-param checkpoints to ~/.cache/ace-step (a few GB); subsequent
#     starts are fast. Override the location with TINY_ACESTEP_CKPT.
import os
import random
import threading
import time

# Reduce CUDA fragmentation under shared-card memory pressure. Must precede CUDA init.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
    load_dotenv()
except Exception:  # noqa: BLE001
    pass

import gradio as gr
import torch
from acestep.pipeline_ace_step import ACEStepPipeline

CKPT_DIR = os.environ.get("TINY_ACESTEP_CKPT") or None  # None -> default ~/.cache/ace-step
DTYPE = os.environ.get("TINY_ACESTEP_DTYPE", "bfloat16").strip()
# Offload on by default: the 3090 is shared (desktop + text-encoder server). "0"/"false" = keep
# the model GPU-resident for full speed when the card is free.
OFFLOAD = os.environ.get("TINY_ACESTEP_OFFLOAD", "1").strip().lower() not in ("0", "false", "no")
DEFAULT_STEPS = int(os.environ.get("TINY_ACESTEP_STEPS", "60"))
DEFAULT_GUIDANCE = float(os.environ.get("TINY_ACESTEP_GUIDANCE", "15.0"))
DEFAULT_DURATION = float(os.environ.get("TINY_ACESTEP_DURATION", "30.0"))
MAX_DURATION = float(os.environ.get("TINY_ACESTEP_MAX_DURATION", "240.0"))
MAX_SEED = 2_147_483_647

print(f"[acestep] loading pipeline (dtype={DTYPE}, cpu_offload={OFFLOAD and torch.cuda.is_available()})", flush=True)
_t0 = time.time()
pipe = ACEStepPipeline(
    checkpoint_dir=CKPT_DIR,
    dtype=DTYPE,
    cpu_offload=OFFLOAD and torch.cuda.is_available(),
    overlapped_decode=True,
    torch_compile=False,
)
print(f"[acestep] pipeline constructed in {time.time() - _t0:.1f}s (weights load lazily on first call)", flush=True)

# The pipeline is process-global and shared by every caller; serialize generations so concurrent
# requests don't trample each other's state (same guard as the other sidecars).
_gen_lock = threading.Lock()


def _first_audio(out):
    """ACE-Step's __call__ returns a list of audio paths, sometimes paired with a params dict
    ((paths, params)). Dig out the first audio file path robustly."""
    seen = out
    # Unwrap a (result, params) tuple/list whose 2nd element is the metadata dict.
    if isinstance(seen, (list, tuple)) and len(seen) == 2 and isinstance(seen[1], dict):
        seen = seen[0]
    if isinstance(seen, (list, tuple)):
        seen = seen[0] if seen else None
    if seen is None:
        raise gr.Error("ACE-Step returned no audio")
    return os.fspath(seen)


def generate(prompt: str, lyrics: str = "", audio_duration: float = DEFAULT_DURATION,
             infer_step: int = DEFAULT_STEPS, guidance_scale: float = DEFAULT_GUIDANCE,
             seed: int = -1):
    if not prompt or not prompt.strip():
        raise gr.Error("prompt (tags / style) required, e.g. 'lofi hip hop, mellow, rainy'")
    dur = float(audio_duration or DEFAULT_DURATION)
    dur = max(1.0, min(dur, MAX_DURATION))
    steps = max(1, min(int(infer_step or DEFAULT_STEPS), 200))
    guidance = float(guidance_scale if guidance_scale is not None else DEFAULT_GUIDANCE)
    if seed is None or int(seed) < 0:
        seed = random.randint(0, MAX_SEED)
    with _gen_lock:
        out = pipe(
            format="wav",
            audio_duration=dur,
            prompt=prompt.strip(),
            lyrics=(lyrics or "").strip(),
            infer_step=steps,
            guidance_scale=guidance,
            manual_seeds=[int(seed)],
        )
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    return _first_audio(out)


demo = gr.Interface(
    fn=generate,
    inputs=[
        gr.Textbox(label="Prompt (tags / style)", lines=2,
                   placeholder="e.g. epic orchestral, cinematic, heroic brass"),
        gr.Textbox(label="Lyrics (blank or [inst] = instrumental)", lines=6,
                   placeholder="[verse]\n...\n[chorus]\n..."),
        gr.Number(label="Duration (s)", value=DEFAULT_DURATION),
        gr.Number(label="Inference steps", value=DEFAULT_STEPS, precision=0),
        gr.Number(label="Guidance scale", value=DEFAULT_GUIDANCE),
        gr.Number(label="Seed (-1 = random)", value=-1, precision=0),
    ],
    outputs=gr.Audio(type="filepath", label="Generated audio"),
    api_name="generate",
    title="Tiny Army ACE-Step — local sidecar",
    description="Text-to-music + sung vocals. Leave lyrics blank for instrumental.",
)

if __name__ == "__main__":
    demo.queue().launch(
        server_name=os.environ.get("GRADIO_SERVER_NAME", "127.0.0.1"),
        server_port=int(os.environ.get("PORT", "7866")),
        show_error=True,
    )
