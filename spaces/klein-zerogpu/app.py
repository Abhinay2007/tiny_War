from __future__ import annotations

# LOCAL SIDECAR variant of the polats/tiny-army-klein-zerogpu Space.
#
# Same Gradio API contract as the hosted Space (so the main app's gradio_client talks to it
# unchanged):
#   /generate(prompt, seed:int, lora:str) -> image   # returns a PIL image / file path
#
# Differences from the hosted ZeroGPU app:
#   * No ZeroGPU. `@spaces.GPU` is a no-op passthrough.
#   * FLUX.2-klein is ~16 GB (transformer + text_encoder) and won't fit on the 3090, which is
#     ALSO shared with a ~15 GB text-encoder server. We load in bf16 on CPU and stream to the GPU
#     with `enable_sequential_cpu_offload()` (submodule granularity), so peak VRAM is only ~1-2 GB
#     and the model never lands on the GPU all at once. (4-bit quantization was tried but its
#     load-time GPU "warmup" allocation spikes above the ~5 GB of free headroom and OOMs; sequential
#     offload sidesteps that AND keeps full bf16 quality. TINY_KLEIN_OFFLOAD=model uses the faster
#     component-granularity offload instead — only safe when the card is mostly free.)
#   * The weiner LoRA (polats/weiner-klein-lora) is loaded by DEFAULT and pre-applied at startup,
#     so the main app's /generate calls (which don't pass a lora) get weiner portraits.
#   * Loads the repo .env for HF_TOKEN.
import os
import random
import threading
import time

# Reduce CUDA fragmentation under the shared-card memory pressure (the offload churn allocates
# and frees repeatedly). Must be set before torch initializes CUDA.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
    load_dotenv()
except Exception:  # noqa: BLE001
    pass


# Off ZeroGPU there's no spaces.GPU; make the decorator a no-op passthrough.
def GPU(*dargs, **dkwargs):  # noqa: N802
    def wrap(fn):
        return fn
    if len(dargs) == 1 and callable(dargs[0]) and not dkwargs:
        return dargs[0]
    return wrap


import gradio as gr
import torch
from diffusers import Flux2KleinPipeline
from PIL import Image

MODEL_ID = os.environ.get("TINY_KLEIN_MODEL", "black-forest-labs/FLUX.2-klein-4B")
STEPS = int(os.environ.get("TINY_KLEIN_STEPS", "4"))
GUIDANCE = float(os.environ.get("TINY_KLEIN_GUIDANCE", "1.0"))
MAX_SEED = 2_147_483_647
_HF_TOKEN = os.environ.get("HF_TOKEN") or None
# Offload strategy. "sequential" (default) streams submodules → ~1-2 GB peak, fits alongside the
# shared text-encoder server, slower. "model" streams whole components → ~8 GB peak, faster, only
# safe when the card is mostly free.
OFFLOAD = os.environ.get("TINY_KLEIN_OFFLOAD", "sequential").strip().lower()

# Optional character/style LoRAs, loadable per-request via the `lora` argument.
# Trained on klein-base; serving on the distilled model is the documented fast path.
LORA_REPO = os.environ.get("KLEIN_LORA_REPO", "polats/weiner-klein-lora")
LORAS = {
    "weiner": "weiner_klein_4b_v1.safetensors",          # step 1000 (final)
    "weiner750": "weiner_klein_4b_v1_000000750.safetensors",
    "weiner500": "weiner_klein_4b_v1_000000500.safetensors",
    "weiner250": "weiner_klein_4b_v1_000000250.safetensors",
}
# Default LoRA applied at startup (and the component default so no-arg /generate calls use it).
DEFAULT_LORA = os.environ.get("KLEIN_LORA_DEFAULT", "weiner").strip()

print(f"[klein] loading {MODEL_ID} (bf16, offload={OFFLOAD if torch.cuda.is_available() else 'cpu'})", flush=True)
_t0 = time.time()
# bf16 on CPU — no GPU allocation at load time, so it never contends with the shared card.
pipe = Flux2KleinPipeline.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16, token=_HF_TOKEN)
print(f"[klein] loaded in {time.time() - _t0:.1f}s", flush=True)

_lora_active: str | None = None
_offload_enabled = False
# Serialize LoRA-state + generation: the pipe and its loaded LoRA are process-global and shared
# by every caller, so without this a concurrent no-LoRA request could render while another has
# weiner attached (and vice-versa). See the hosted Space fix for the same leak.
_gen_lock = threading.Lock()


def _load_lora(name: str) -> None:
    pipe.load_lora_weights(LORA_REPO, weight_name=LORAS[name], token=_HF_TOKEN)


def _ensure_lora(name: str) -> None:
    global _lora_active
    name = (name or "").strip()
    if name == (_lora_active or ""):
        return
    if _lora_active:
        pipe.unload_lora_weights()
        _lora_active = None
    if name:
        if name not in LORAS:
            raise gr.Error(f"unknown lora '{name}' (have: {', '.join(LORAS)})")
        _load_lora(name)
        _lora_active = name


# Pre-apply the default LoRA, THEN install the offload hooks (load_lora before offload is the
# reliable order). After this the pipe manages its own device placement — never call .to(cuda).
if DEFAULT_LORA:
    try:
        _load_lora(DEFAULT_LORA)
        _lora_active = DEFAULT_LORA
        print(f"[klein] applied default LoRA: {DEFAULT_LORA}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[klein] WARN: could not preload default LoRA {DEFAULT_LORA!r}: {e}", flush=True)

if torch.cuda.is_available():
    if OFFLOAD == "model":
        pipe.enable_model_cpu_offload()  # whole-component granularity, ~8 GB peak, faster
        print("[klein] enabled model CPU offload (peak ~ one component)", flush=True)
    else:
        pipe.enable_sequential_cpu_offload()  # submodule granularity, ~1-2 GB peak, slower
        print("[klein] enabled sequential CPU offload (peak ~1-2 GB)", flush=True)
    _offload_enabled = True


def _to_img(x):
    if x is None:
        return None
    img = x if isinstance(x, Image.Image) else Image.open(x)
    return img.convert("RGB").resize((1024, 1024))


@GPU(duration=60)
def generate(prompt: str, seed: int = 42, lora: str = DEFAULT_LORA, ref_image=None, ref_image2=None):
    if not prompt or not prompt.strip():
        raise gr.Error("prompt required")
    # With offload enabled the pipeline places its own modules; the generator must live on the
    # device the latents end up on (cuda when offloading, else cpu).
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    if seed is None or int(seed) < 0:
        seed = random.randint(0, MAX_SEED)
    # FLUX.2 native multi-image conditioning: pass [pose anchor, identity ref] as a LIST so the
    # composition follows one reference (e.g. a mannequin/depth render of a kimodo pose) while
    # character identity comes from the other. One image -> passed alone (proven single-ref path).
    refs = [r for r in (_to_img(ref_image), _to_img(ref_image2)) if r is not None]
    # Exclusive ownership of the shared pipe for the whole LoRA-set + generate (no adapter leak).
    with _gen_lock:
        _ensure_lora(lora)
        kwargs = dict(
            prompt=prompt.strip(),
            width=1024,
            height=1024,
            num_inference_steps=STEPS,
            guidance_scale=GUIDANCE,
            generator=torch.Generator(device=dev).manual_seed(int(seed)),
        )
        if len(refs) == 1:
            kwargs["image"] = refs[0]
        elif refs:
            kwargs["image"] = refs
        img = pipe(**kwargs).images[0]
        if dev == "cuda":
            torch.cuda.empty_cache()
    return img


demo = gr.Interface(
    fn=generate,
    inputs=[
        gr.Textbox(label="Prompt", lines=4),
        gr.Number(label="Seed", value=42, precision=0),
        gr.Textbox(label="LoRA", value=DEFAULT_LORA,
                   placeholder="blank = none; weiner / weiner750 / weiner500 / weiner250"),
        gr.Image(label="Pose reference (optional)", type="pil"),
        gr.Image(label="Identity reference (optional)", type="pil"),
    ],
    outputs=gr.Image(type="pil", label="Portrait"),
    api_name="generate",
    title="Tiny Army Klein — local sidecar",
)

if __name__ == "__main__":
    demo.queue().launch(
        server_name=os.environ.get("GRADIO_SERVER_NAME", "127.0.0.1"),
        server_port=int(os.environ.get("PORT", "7865")),
        show_error=True,
    )
