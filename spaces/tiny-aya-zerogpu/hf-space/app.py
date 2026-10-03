from __future__ import annotations

import os
import threading

os.environ.setdefault("OPENBLAS_NUM_THREADS", "4")
os.environ.setdefault("OMP_NUM_THREADS", "4")
os.environ.setdefault("MKL_NUM_THREADS", "4")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("GRADIO_SSR_MODE", "false")

# ZeroGPU patches torch's CUDA calls, so this import must precede torch and transformers.
import spaces
import gradio as gr
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer


MODEL_ID = os.environ.get("TINY_AYA_MODEL", "CohereLabs/tiny-aya-global")
DEFAULT_MAX_TOKENS = int(os.environ.get("TINY_AYA_MAX_TOKENS", "400"))
_HF_TOKEN = os.environ.get("HF_TOKEN") or None
# 4-bit by default to keep the model's ZeroGPU memory use low. Set TINY_AYA_QUANT=bf16
# in Space Variables to use the full-precision model instead.
QUANT = os.environ.get("TINY_AYA_QUANT", "4bit").strip().lower()

# This is only a guardrail on local CUDA; ZeroGPU may not implement this setting.
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


@spaces.GPU(duration=120)
def generate(system: str, user: str, max_tokens: int = DEFAULT_MAX_TOKENS, temperature: float = 0.8):
    """Generate one Tiny Aya response from a system prompt and user prompt."""
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


@spaces.GPU(duration=120)
def generate_stream(system: str, user: str, max_tokens: int = DEFAULT_MAX_TOKENS, temperature: float = 0.8):
    """Stream cumulative Tiny Aya response text for the Tiny Army API client."""
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


with gr.Blocks(title="Tiny Aya Global") as demo:
    gr.Markdown(
        "# Tiny Aya Global\n"
        "A multilingual text generation demo powered by "
        "[`CohereLabs/tiny-aya-global`](https://huggingface.co/CohereLabs/tiny-aya-global). "
        "Try one of the prompts below or enter your own."
    )
    with gr.Row():
        with gr.Column(scale=1):
            system = gr.Textbox(label="System prompt", lines=4, placeholder="Optional instructions")
            user = gr.Textbox(label="Your prompt", lines=5, placeholder="Ask a question in any supported language")
            max_tokens = gr.Slider(1, 1024, value=DEFAULT_MAX_TOKENS, step=1, label="Max new tokens")
            temperature = gr.Slider(0, 2, value=0.8, step=0.05, label="Temperature")
            btn = gr.Button("Generate", variant="primary")
        with gr.Column(scale=1):
            out = gr.Textbox(label="Tiny Aya response", lines=14)

    gr.Examples(
        examples=[
            ["", "Explica en español qué significa la palabra japonesa 'ikigai' y da un ejemplo práctico.", 300, 0.3],
            ["", "हिंदी में बताइए कि मधुमक्खियाँ फूलों की मदद कैसे करती हैं।", 300, 0.3],
            ["", "Translate 'The stars are bright tonight' into Swahili and explain the translation.", 300, 0.3],
        ],
        inputs=[system, user, max_tokens, temperature],
        outputs=out,
        fn=generate,
        cache_examples=True,
        cache_mode="lazy",
        label="Multilingual examples",
    )
    btn.click(generate, inputs=[system, user, max_tokens, temperature], outputs=out, api_name="generate")
    btn.click(generate_stream, inputs=[system, user, max_tokens, temperature], outputs=out, api_name="generate_stream")


if __name__ == "__main__":
    demo.queue().launch(
        server_name=os.environ.get("GRADIO_SERVER_NAME", "0.0.0.0"),
        server_port=int(os.environ.get("PORT", "7860")),
        show_error=True,
        mcp_server=True,
    )
