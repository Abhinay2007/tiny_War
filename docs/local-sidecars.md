# Local model sidecars (no HuggingFace quota)

Two of the hosted ZeroGPU Spaces now run **locally on the 3090** so the main app doesn't burn
HF quota. They mirror each hosted Space's Gradio API exactly, so the main app's `gradio_client`
talks to them unchanged — only the `*_SPACE` env var changes from a Space ID to a local URL.

| Sidecar    | Source dir                  | Port | Model                          | `.env` var        |
|------------|-----------------------------|------|--------------------------------|-------------------|
| Tiny Aya   | `spaces/tiny-aya-zerogpu/`  | 7864 | `CohereLabs/tiny-aya-global`   | `TINY_AYA_SPACE`  |
| Klein      | `spaces/klein-zerogpu/`     | 7865 | `black-forest-labs/FLUX.2-klein-4B` + `polats/weiner-klein-lora` | `TINY_KLEIN_SPACE` |
| ACE-Step   | `spaces/acestep-zerogpu/`   | 7866 | [ACE-Step](https://github.com/ace-step/ACE-Step) — music + sung vocals | `TINY_ACESTEP_SPACE` |

**ACE-Step is the odd one out:** it's a *music* model (not text/image), and it pins
`transformers==4.50`/`spacy==3.8.4` which clash with the aya/klein venv — so it runs in its **own**
`.venv-acestep` (Python 3.12; spacy has no 3.13 wheel) and also needs `torchcodec` for audio I/O.
Start it on demand with `./run_sidecars.sh acestep` (it's intentionally **not** in the `all`
default — heavier on the shared card). API:
`/generate(prompt, lyrics, duration, infer_step, guidance_scale, seed) -> wav`; the main app
exposes it at `POST /api/music` (`{prompt, lyrics?, duration?, steps?, guidance?, seed?}` → WAV).
"Vocals" = lyrics SUNG inside a track (blank or `[inst]` = instrumental); **VoxCPM** remains the
path for spoken dialogue/TTS. `cpu_offload` keeps it ~0.7 GB idle / ~8 GB peak; the first call
auto-downloads checkpoints to `~/.cache/ace-step`.

Mirrors of `polats/tiny-army-tiny-aya-zerogpu` and `polats/tiny-army-klein-zerogpu`, adapted for
local hardware (no ZeroGPU). The hosted `app.py`s are unchanged in spirit; the local diffs are
documented in each file's header.

## Run

```bash
./run_sidecars.sh          # start aya + klein, wait until ready (logs in logs/)
./run_sidecars.sh aya      # just tiny-aya
./run_sidecars.sh klein    # just klein
./run_sidecars.sh acestep  # just ACE-Step (music; own venv, on demand)
./run_sidecars.sh stop     # stop all three
```

`.env` already points `TINY_AYA_SPACE` / `TINY_KLEIN_SPACE` / `TINY_ACESTEP_SPACE` at local URLs.

### Network access

The sidecars bind to `0.0.0.0` by default, so they're reachable from the **local network** at this
host's LAN IP (currently `10.0.0.36`, also the tailnet `100.88.3.43`):

- Tiny Aya:  `http://10.0.0.36:7864`
- Klein:     `http://10.0.0.36:7865`

The main app talks to them over loopback (`127.0.0.1`) for speed regardless. Set `BIND=127.0.0.1`
before `./run_sidecars.sh` to restrict them to this machine only. (They are NOT on the public
cloudflared/nginx path that exposes kimodo — LAN/tailnet only.) To go back to the
hosted ZeroGPU Spaces, comment those two lines back to the `polats/...` Space IDs.

## Why these settings (shared-GPU constraints)

The 3090 also drives the desktop **and** is shared with a separate ~15 GB text-encoder server
(`kimodo`), leaving only ~5 GB free. So:

- **Tiny Aya** loads in **4-bit NF4** (~7 GB → ~3.5 GB resident). `TINY_AYA_QUANT=bf16` for full
  precision when the card is free.
- **Klein** loads in **bf16 with `enable_sequential_cpu_offload()`** — the pipeline stays on CPU
  and streams to the GPU submodule-by-submodule, so **peak VRAM is only ~2.5 GB** and it never
  contends with the shared card at load time. (4-bit quant was tried but its load-time GPU warmup
  allocation OOMs against the tight free headroom; sequential offload sidesteps that and keeps full
  bf16 quality.) ~11 s/image at 1024². `TINY_KLEIN_OFFLOAD=model` uses the faster
  whole-component offload (~8 GB peak) when the card is free.
- The **weiner LoRA** is pre-applied at startup and is the default for the `lora` input, so the
  main app's `/generate(prompt, seed)` calls (which don't pass a LoRA) get weiner portraits.
  Other checkpoints: `weiner750`, `weiner500`, `weiner250`.

## Verify

```bash
# both endpoints, via the main app (which must be running on :7860)
curl -s -X POST localhost:7860/portrait -H 'content-type: application/json' \
  -d '{"prompt":"portrait of a knight","engine":"klein"}' -o /tmp/p.webp
curl -sN -X POST localhost:7860/text/generate/stream -H 'content-type: application/json' \
  -d '{"model":"tiny-aya-global-zerogpu","user":"hi","max_tokens":20}'
```
