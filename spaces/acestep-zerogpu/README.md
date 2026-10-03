---
title: Tiny Army ACE-Step
emoji: 🎵
sdk: gradio
app_file: app.py
---

# Tiny Army ACE-Step — local sidecar

Local sidecar wrapping [ACE-Step](https://github.com/ace-step/ACE-Step) for **music + sung-vocal**
generation, so the main app makes audio without burning HF quota. Mirrors the other sidecars'
Gradio API so `gradio_client` talks to it unchanged:

```
/generate(prompt, lyrics, audio_duration, infer_step, guidance_scale, seed) -> wav file
```

- **prompt** — tags / style, e.g. `epic orchestral, cinematic, heroic brass`
- **lyrics** — `[verse]/[chorus]` markers for sung vocals; blank or `[inst]` for an instrumental
- ACE-Step is a *music* model — its "voice" is singing, not speech. Keep **VoxCPM** for dialogue.

## Run

Runs in a **dedicated venv** (`.venv-acestep`, Python 3.12) because ACE-Step pins
`transformers==4.50` / `spacy==3.8.4`, which conflict with the aya/klein sidecars. Launch via:

```bash
./run_sidecars.sh acestep      # port 7866
```

Then point the main app at it (already in `.env`): `TINY_ACESTEP_SPACE=http://127.0.0.1:7866`.

### Env knobs
- `TINY_ACESTEP_OFFLOAD=0` — keep the model GPU-resident (faster) when the card is free; default
  `1` enables `cpu_offload` (~8 GB peak) to coexist with the shared text-encoder server.
- `TINY_ACESTEP_CKPT` — checkpoint dir (default `~/.cache/ace-step`, auto-downloaded first run).
- `TINY_ACESTEP_STEPS` / `_GUIDANCE` / `_DURATION` / `_MAX_DURATION` / `_DTYPE`.
