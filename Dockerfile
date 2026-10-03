# Tiny Army — HF Space (Docker SDK). FastAPI serves the custom frontend and mounts
# a Gradio app for the small-model barracks. llama.cpp gets added during the hack.
FROM python:3.11-slim

# HF Spaces run as a non-root user; keep caches writable.
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    GRADIO_SERVER_NAME=0.0.0.0 \
    GRADIO_SERVER_PORT=7860

RUN useradd -m -u 1000 user
USER user
WORKDIR /home/user/app

COPY --chown=user requirements.txt .
# The extra index serves prebuilt llama-cpp-python CPU wheels (no source compile).
RUN pip install --no-cache-dir --user -r requirements.txt \
      --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu

COPY --chown=user . .

EXPOSE 7860
CMD ["python", "app.py"]
