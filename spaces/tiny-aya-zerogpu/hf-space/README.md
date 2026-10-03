---
title: Tiny Aya Global
emoji: 🌍
colorFrom: green
colorTo: blue
sdk: gradio
sdk_version: 6.15.2
app_file: app.py
python_version: "3.12.12"
suggested_hardware: zero-a10g
startup_duration_timeout: 1h
pinned: false
license: cc-by-nc-4.0
short_description: Multilingual Tiny Aya Global text generation demo
models:
  - CohereLabs/tiny-aya-global
---

# Tiny Aya Global

Try Cohere Labs' multilingual `CohereLabs/tiny-aya-global` model with sample prompts
or your own system and user prompts. The model weights download from Hugging Face
when the Space starts; they are not stored in this repository.

## Space setup

- This app uses Gradio on ZeroGPU. Hardware must be selected for the Space in its
  settings or when the Space is created; `suggested_hardware` is only a hint.
- Accept the model conditions for `CohereLabs/tiny-aya-global` with the Hugging
  Face account used to provide the model download token.
- Add a Space Secret named `HF_TOKEN` with a read token that can access the model.
  Never put the token in this repository.

## API

The demo exposes both endpoints below. They accept the same four inputs, in order:

1. `system` — string
2. `user` — string
3. `max_tokens` — integer
4. `temperature` — float

`/generate` returns the complete generated string. `/generate_stream` yields
cumulative string updates for streaming clients. The public demo also exposes
the prompt controls in its Gradio interface.

The model is licensed under CC-BY-NC-4.0 and is intended for non-commercial use.
