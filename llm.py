"""Configurable llama.cpp runtime for Tiny Army's persona + war-diary.

Two modes, env-selected, behind ONE uniform `stream_chat()` generator so callers are
runtime-agnostic:

  • External (TINY_LLM_BASE_URL set): stream from any OpenAI-compatible llama.cpp
    server — your local `llama-server`, or an HF-hosted GGUF endpoint. This mirrors
    woid's LOCAL_LLM_BASE_URL switch (reused, not reinvented).
  • In-Space (default): llama-cpp-python loads a GGUF — a local file
    (TINY_LLM_MODEL_PATH) or one pulled from Hugging Face (TINY_LLM_HF_REPO +
    TINY_LLM_HF_FILE).

Generation is synchronous and CPU-bound, so it's serialized by a lock (one CPU model
can't decode in parallel) — async callers (the SSE endpoint) run `stream_chat` in a
threadpool. If no backend can load, `stream_chat` raises LlmUnavailable and callers
fall back to a stub so the Space still works.
"""
import json
import os
import threading
import urllib.request

BASE_URL = os.environ.get("TINY_LLM_BASE_URL", "").rstrip("/")
API_KEY = os.environ.get("TINY_LLM_API_KEY", "")
MODEL_PATH = os.environ.get("TINY_LLM_MODEL_PATH", "")
HF_REPO = os.environ.get("TINY_LLM_HF_REPO", "Qwen/Qwen2.5-0.5B-Instruct-GGUF")
HF_FILE = os.environ.get("TINY_LLM_HF_FILE", "*q4_k_m.gguf")
N_CTX = int(os.environ.get("TINY_LLM_N_CTX", "2048"))
# DEFAULT 2, not os.cpu_count(): in a container cpu_count() reports the HOST's cores
# (often 16-32), but an HF free Space only has ~2 vCPU. Over-subscribing threads makes
# llama.cpp thrash and run ~50x too slow. Override with TINY_LLM_N_THREADS on bigger HW.
N_THREADS = int(os.environ.get("TINY_LLM_N_THREADS") or 2)

# A label for the `model` SSE event / UI — not used to route requests.
MODEL_ID = (
    os.environ.get("TINY_LLM_MODEL")
    or ("external" if BASE_URL else "")
    or (os.path.basename(MODEL_PATH) if MODEL_PATH else "")
    or HF_REPO.split("/")[-1]
)

_lock = threading.Lock()        # serializes GENERATION (one CPU model at a time)
_load_lock = threading.Lock()   # serializes the one-time model LOAD (the slow download)
_llm = None
_load_error = None


class LlmUnavailable(RuntimeError):
    """No backend could be reached/loaded — callers should fall back to a stub."""


def model_id():
    return MODEL_ID or "tiny-llm"


def status():
    """Diagnostics for the persona backend (model load state + thread/CPU info)."""
    return {
        "mode": "external" if BASE_URL else "in-space",
        "model": model_id(),
        "loaded": _llm is not None,
        "load_error": _load_error,
        "n_threads": N_THREADS,
        "n_ctx": N_CTX,
        "cpu_count": os.cpu_count(),
        "base_url": BASE_URL or None,
    }


def _get_local():
    """Load the GGUF once. Uses its OWN lock (not the generation lock) so the slow
    first-time download doesn't make concurrent requests time out — they just wait
    here until the model is ready."""
    global _llm, _load_error
    if _llm is not None:
        return _llm
    if _load_error is not None:
        raise LlmUnavailable(_load_error)
    with _load_lock:
        if _llm is not None:
            return _llm
        if _load_error is not None:
            raise LlmUnavailable(_load_error)
        try:
            from llama_cpp import Llama
            common = dict(n_ctx=N_CTX, n_threads=N_THREADS, verbose=False)
            if MODEL_PATH:
                _llm = Llama(model_path=MODEL_PATH, **common)
            else:  # pulls + caches the GGUF from Hugging Face on first use
                _llm = Llama.from_pretrained(repo_id=HF_REPO, filename=HF_FILE, **common)
            return _llm
        except Exception as e:  # import / download / OOM / bad file
            _load_error = f"{type(e).__name__}: {e}"
            raise LlmUnavailable(_load_error)


def prewarm():
    """Kick off the model load in the background so the app starts immediately and the
    download happens before the first user request (best-effort)."""
    if BASE_URL:
        return  # external endpoint — nothing to load locally

    def _bg():
        try:
            _get_local()
        except Exception:
            pass  # _load_error is recorded; callers fall back to the stub
    threading.Thread(target=_bg, daemon=True).start()


def _stream_external(system, user, max_tokens, temperature):
    body = json.dumps({
        "model": os.environ.get("TINY_LLM_MODEL", "local"),
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": temperature, "max_tokens": max_tokens, "stream": True,
    }).encode()
    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
    req = urllib.request.Request(f"{BASE_URL}/chat/completions", data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            for raw in resp:
                line = raw.decode("utf-8").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    delta = json.loads(data)["choices"][0]["delta"].get("content")
                except Exception:
                    continue
                if delta:
                    yield delta
    except Exception as e:
        raise LlmUnavailable(f"external endpoint: {type(e).__name__}: {e}")


def _stream_local(system, user, max_tokens, temperature):
    llm = _get_local()
    for chunk in llm.create_chat_completion(
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=max_tokens, temperature=temperature, stream=True,
    ):
        delta = chunk["choices"][0]["delta"].get("content")
        if delta:
            yield delta


def stream_chat(system, user, max_tokens=400, temperature=0.8, should_stop=None):
    """Yield text chunks from the configured backend. Serialized by a module lock so
    one CPU model never decodes two requests at once. `should_stop()` is polled each
    chunk so an abandoned request (client gone) stops promptly and frees the lock.
    Raises LlmUnavailable if no backend is available or the model is busy."""
    # Ensure the model is loaded FIRST (its own lock; the slow download must not count
    # against the short generation-lock timeout below).
    if not BASE_URL:
        _get_local()
    if not _lock.acquire(timeout=2):
        raise LlmUnavailable("the model is busy with another request — try again in a moment")
    try:
        gen = _stream_external if BASE_URL else _stream_local
        for chunk in gen(system, user, max_tokens, temperature):
            if should_stop and should_stop():
                break
            yield chunk
    finally:
        _lock.release()
