from __future__ import annotations

# LOCAL SIDECAR variant of the polats/tiny-army-tiny-aya-zerogpu Space.
#
# Same Gradio API contract as the hosted Space (so the main app's gradio_client talks to it
# unchanged):
#   /generate(system, user, max_tokens:int, temperature:float)        -> str
#   /generate_stream(system, user, max_tokens:int, temperature:float) -> str   # CUMULATIVE, streamed
#
# Differences from the hosted ZeroGPU app:
#   * No ZeroGPU. `@spaces.GPU` is replaced by a no-op passthrough (the locally-installed
#     `spaces` package has no `.GPU` off-platform), so generate() just runs on the local CUDA
#     device the model is already resident on.
#   * Loads a sibling/repo .env for HF_TOKEN (tiny-aya-global is a gated repo).
#   * Caps this process's VRAM so a spike can't grab the whole 3090 and crash the desktop.
import os
import threading

os.environ.setdefault("OPENBLAS_NUM_THREADS", "4")
os.environ.setdefault("OMP_NUM_THREADS", "4")
os.environ.setdefault("MKL_NUM_THREADS", "4")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("GRADIO_SSR_MODE", "false")

try:
    from dotenv import load_dotenv
    # repo root .env (two dirs up: spaces/tiny-aya-zerogpu/ -> repo root)
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
    load_dotenv()  # also any .env in CWD
except Exception:  # noqa: BLE001
    pass

import gradio as gr
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer


# Off ZeroGPU there's no spaces.GPU; make the decorator a no-op passthrough. The model is
# already on the local CUDA device, so the wrapped fn runs there directly.
def GPU(*dargs, **dkwargs):  # noqa: N802
    def wrap(fn):
        return fn
    if len(dargs) == 1 and callable(dargs[0]) and not dkwargs:
        return dargs[0]
    return wrap


MODEL_ID = os.environ.get("TINY_AYA_MODEL", "CohereLabs/tiny-aya-global")
DEFAULT_MAX_TOKENS = int(os.environ.get("TINY_AYA_MAX_TOKENS", "400"))
_HF_TOKEN = os.environ.get("HF_TOKEN") or None
# 4-bit by default: the 3090 is shared with a ~15 GB text-encoder server, so we NF4-quantize
# tiny-aya (~7 GB bf16 -> ~2.5 GB) to leave room. TINY_AYA_QUANT=bf16 disables it (best quality).
QUANT = os.environ.get("TINY_AYA_QUANT", "4bit").strip().lower()

# GUARDRAIL: the 3090 also drives the desktop. Cap THIS process's share of the card so an OOM
# errors out instead of taking down the display.
if torch.cuda.is_available():
    try:
        torch.cuda.set_per_process_memory_fraction(
            float(os.environ.get("TINY_AYA_VRAM_FRAC", "0.5")), 0
        )
    except Exception:  # noqa: BLE001
        pass

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, token=_HF_TOKEN)


def _load_model():
    if not torch.cuda.is_available():
        return AutoModelForCausalLM.from_pretrained(MODEL_ID, torch_dtype="auto", token=_HF_TOKEN)
    if QUANT == "bf16":
        m = AutoModelForCausalLM.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16, token=_HF_TOKEN)
        return m.to("cuda")
    # 4-bit NF4, loaded straight onto the GPU (bnb models can't be .to()'d afterwards).
    from transformers import BitsAndBytesConfig
    quant = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )
    return AutoModelForCausalLM.from_pretrained(
        MODEL_ID, quantization_config=quant, torch_dtype=torch.bfloat16,
        device_map="cuda", token=_HF_TOKEN,
    )


print(f"[tiny-aya] loading {MODEL_ID} quant={QUANT if torch.cuda.is_available() else 'cpu'}", flush=True)
model = _load_model()
model.eval()
print("[tiny-aya] model ready", flush=True)

_lock = threading.Lock()


def _messages(system: str, user: str):
    messages = []
    if system and system.strip():
        messages.append({"role": "system", "content": system.strip()})
    messages.append({"role": "user", "content": (user or "").strip()})
    return messages


@GPU(duration=120)
def generate(system: str, user: str, max_tokens: int = DEFAULT_MAX_TOKENS, temperature: float = 0.8):
    if not user or not user.strip():
        raise gr.Error("user prompt required")
    max_tokens = max(1, min(int(max_tokens or DEFAULT_MAX_TOKENS), 1024))
    temperature = max(0.0, min(float(temperature if temperature is not None else 0.8), 2.0))
    inputs = tokenizer.apply_chat_template(
        _messages(system, user),
        tokenize=True,
        add_generation_prompt=True,
        return_dict=True,
        return_tensors="pt",
    ).to(model.device)
    with _lock, torch.inference_mode():
        outputs = model.generate(
            **inputs,
            max_new_tokens=max_tokens,
            do_sample=temperature > 0,
            temperature=max(temperature, 1e-5),
            top_p=0.95,
            pad_token_id=tokenizer.eos_token_id,
        )
    return tokenizer.decode(outputs[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True).strip()


@GPU(duration=120)
def generate_stream(system: str, user: str, max_tokens: int = DEFAULT_MAX_TOKENS, temperature: float = 0.8):
    if not user or not user.strip():
        raise gr.Error("user prompt required")
    max_tokens = max(1, min(int(max_tokens or DEFAULT_MAX_TOKENS), 1024))
    temperature = max(0.0, min(float(temperature if temperature is not None else 0.8), 2.0))
    inputs = tokenizer.apply_chat_template(
        _messages(system, user),
        tokenize=True,
        add_generation_prompt=True,
        return_dict=True,
        return_tensors="pt",
    ).to(model.device)
    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)

    def run():
        with _lock, torch.inference_mode():
            model.generate(
                **inputs,
                max_new_tokens=max_tokens,
                do_sample=temperature > 0,
                temperature=max(temperature, 1e-5),
                top_p=0.95,
                pad_token_id=tokenizer.eos_token_id,
                streamer=streamer,
            )

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    acc = ""
    for token in streamer:
        acc += token
        yield acc
    thread.join(timeout=1)


with gr.Blocks(title="Tiny Army Tiny Aya (local)") as demo:
    gr.Markdown("# Tiny Army Tiny Aya — local sidecar")
    system = gr.Textbox(label="System", lines=5)
    user = gr.Textbox(label="User", lines=5)
    max_tokens = gr.Slider(1, 1024, value=DEFAULT_MAX_TOKENS, step=1, label="Max new tokens")
    temperature = gr.Slider(0, 2, value=0.8, step=0.05, label="Temperature")
    btn = gr.Button("Generate")
    out = gr.Textbox(label="Output", lines=10)
    btn.click(generate, inputs=[system, user, max_tokens, temperature], outputs=out, api_name="generate")
    btn.click(generate_stream, inputs=[system, user, max_tokens, temperature], outputs=out, api_name="generate_stream")


if __name__ == "__main__":
    demo.queue().launch(
        server_name=os.environ.get("GRADIO_SERVER_NAME", "127.0.0.1"),
        server_port=int(os.environ.get("PORT", "7864")),
        show_error=True,
    )
