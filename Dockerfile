# Tiny Army's main app is Python-only. Model sidecars remain separate services.
# The build stage has native tools only so llama-cpp-python can use a CPU wheel or
# compile for the builder architecture; none of those tools enter the final image.
FROM python:3.11-slim AS dependencies

ENV VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    CMAKE_ARGS=-DGGML_NATIVE=OFF \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake ninja-build \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN python -m venv "$VIRTUAL_ENV"
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --prefer-binary -r requirements.txt

FROM python:3.11-slim AS runtime

ENV VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860 \
    TINY_DATA_DIR=/data

# libgomp is needed by CPU builds of llama-cpp-python. The app itself runs as an
# unprivileged user and writes durable media only under /data.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 tinyarmy \
    && useradd --uid 10001 --gid tinyarmy --create-home --shell /usr/sbin/nologin tinyarmy \
    && mkdir -p /data \
    && chown tinyarmy:tinyarmy /data

WORKDIR /app
COPY --from=dependencies /opt/venv /opt/venv
COPY --chown=tinyarmy:tinyarmy . .

USER tinyarmy:tinyarmy
EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7860/', timeout=4)" || exit 1

CMD ["python", "app.py"]
