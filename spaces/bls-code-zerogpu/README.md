---
title: Tiny Army BLS Mini-Code ZeroGPU
emoji: 🪖
colorFrom: indigo
colorTo: green
sdk: gradio
sdk_version: 6.15.2
app_file: app.py
pinned: false
suggested_hardware: zero-a10g
---

# Tiny Army — BLS Mini-Code 1.0 (ZeroGPU coding sidecar)

A ZeroGPU sidecar that serves [`CohereLabs/BLS-Mini-Code-1.0`](https://huggingface.co/CohereLabs/BLS-Mini-Code-1.0)
(30B MoE coding model) to the Tiny Army app via the same Gradio API the Mellum2 / Tiny Aya
sidecars expose.

## API contract (consumed by the main app's `gradio_client`)

- `POST /generate_stream` — args `(system, user, max_tokens:int, temperature:float)`, streams
  **cumulative** decoded text (the app diffs successive frames into deltas).
- `POST /generate` — same args, returns the final text in one shot.

## Config (Space → Settings → Variables)

| Var | Default | Notes |
|-----|---------|-------|
| `TINY_BLS_MODEL` | `CohereLabs/BLS-Mini-Code-1.0` | source repo |
| `TINY_BLS_QUANT` | `4bit` | `4bit` (~18GB) / `8bit` (~32GB) / `bf16` (~60GB, tight) — no FP8 weight exists upstream, so we quantize at load |
| `TINY_BLS_GPU_DURATION` | `120` | ZeroGPU seconds per call |

> **Hardware:** set the Space to a ZeroGPU tier with enough VRAM. 30B at 4-bit fits an A10G/H200
> ZeroGPU slice; `bf16`/`8bit` need the larger H200 slice. Adjust the `hardware:` field above to
> the ZeroGPU flavor you provision.

## Wiring into the main app (later step)

Once this Space is live and the two endpoints respond, set `TINY_BLS_CODE_SPACE=<owner>/<space>`
in the main app and add the routing branch + `web/codingModel.js` entry (mirrors Mellum2).
