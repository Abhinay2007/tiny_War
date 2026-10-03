"""Local Qwen3-TTS Voice Design server — the LeLab-style bridge.

Runs the OPEN WEIGHTS on YOUR machine's GPU; the hosted Tiny Army UI calls it via a
`?tts=` override, so voices are designed locally and off the grid (no DashScope key/cost).

Quick start (on a CUDA box; MPS/CPU work but are slow):

    pip install qwen-tts soundfile "fastapi[standard]" uvicorn torch
    python tts_server.py                      # serves http://localhost:8800/qwen-tts

Then open the app pointed at this server:

    http://localhost:7860/?tts=http://localhost:8800          # local UI + local TTS
    https://tinyarmy.noods.cc/?tts=http://localhost:8800      # hosted UI + your GPU
        (browsers block https→http://localhost by default; run Chrome with
         --unsafely-treat-insecure-origin-as-secure=http://localhost:8800 or serve TLS)

Smoke-test the bridge WITHOUT a GPU (returns a short tone instead of speech):

    QWEN_TTS_STUB=1 python tts_server.py

Env: PORT (8800), QWEN_TTS_MODEL (Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign), QWEN_TTS_STUB.
"""
import asyncio
import io
import math
import os
import struct

from fastapi import FastAPI, Request
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware

MODEL_ID = os.environ.get("QWEN_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign")
STUB = os.environ.get("QWEN_TTS_STUB", "") not in ("", "0", "false", "False")
PORT = int(os.environ.get("PORT", "8800"))

app = FastAPI()
# The hosted UI is a different origin — allow it (and any localhost dev port).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], allow_credentials=False,
)

_model = None
_load_lock = asyncio.Lock()


def _load_model():
    global _model
    if _model is not None:
        return _model
    import torch
    from qwen_tts import Qwen3TTSModel
    if torch.cuda.is_available():
        dev, dtype = "cuda:0", torch.bfloat16
    elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        dev, dtype = "mps", torch.float32
    else:
        dev, dtype = "cpu", torch.float32
    print(f"[tts] loading {MODEL_ID} on {dev} ({dtype})…", flush=True)
    _model = Qwen3TTSModel.from_pretrained(MODEL_ID, device_map=dev, dtype=dtype)
    print("[tts] model ready", flush=True)
    return _model


def _stub_wav(text, sr=24000):
    """A short A4 tone — proves the bridge end-to-end without loading the model."""
    secs = min(4.0, max(0.6, len(text) / 18.0))
    n = int(sr * secs)
    buf = io.BytesIO()
    data = b"".join(struct.pack("<h", int(0.25 * 32767 * math.sin(2 * math.pi * 440 * i / sr))) for i in range(n))
    buf.write(b"RIFF"); buf.write(struct.pack("<I", 36 + len(data))); buf.write(b"WAVE")
    buf.write(b"fmt "); buf.write(struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16))
    buf.write(b"data"); buf.write(struct.pack("<I", len(data))); buf.write(data)
    return buf.getvalue()


def _synth(text, instruct, language):
    if STUB:
        return _stub_wav(text)
    import soundfile as sf
    wavs, sr = _load_model().generate_voice_design(text=text, language=language, instruct=instruct)
    out = io.BytesIO(); sf.write(out, wavs[0], sr, format="WAV")
    return out.getvalue()


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_ID, "stub": STUB, "loaded": _model is not None}


@app.post("/qwen-tts")
async def qwen_tts(request: Request):
    body = await request.json()
    text = (body.get("text") or "").strip()
    instruct = (body.get("instruct") or "").strip() or "A clear, natural voice at a moderate pace."
    language = body.get("language") or "English"
    if not text:
        return Response("text required", status_code=400)
    if not STUB:
        async with _load_lock:  # one CPU/GPU model can't decode in parallel
            wav = await asyncio.to_thread(_synth, text, instruct, language)
    else:
        wav = _synth(text, instruct, language)
    return Response(wav, media_type="audio/wav", headers={"Cache-Control": "no-store"})


if __name__ == "__main__":
    import uvicorn
    print(f"[tts] http://localhost:{PORT}/qwen-tts  (stub={STUB}, model={MODEL_ID})", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=PORT)
