#!/usr/bin/env bash
# Run the Tiny Army model sidecars LOCALLY on the 3090 instead of on ZeroGPU Spaces,
# so the main app doesn't burn HuggingFace quota.
#
# These mirror the hosted Spaces' Gradio API exactly, so the main app talks to them via
# gradio_client unchanged — just point TINY_AYA_SPACE / TINY_KLEIN_SPACE at the local URLs
# (already done in .env):
#   TINY_AYA_SPACE=http://127.0.0.1:7864
#   TINY_KLEIN_SPACE=http://127.0.0.1:7865
#
# Usage:
#   ./run_sidecars.sh          # start aya + klein, stream logs to logs/, wait until ready
#   ./run_sidecars.sh aya      # just tiny-aya
#   ./run_sidecars.sh klein    # just klein
#   ./run_sidecars.sh acestep  # just ACE-Step music sidecar (own .venv-acestep, started on demand)
#   ./run_sidecars.sh stop     # stop all three
set -euo pipefail
cd "$(dirname "$0")"

PY="${PY:-.venv/bin/python}"
# ACE-Step pins transformers==4.50 / spacy==3.8 that conflict with the aya/klein venv, so it runs
# in its own Python 3.12 venv. Override with ACESTEP_PY if you put it elsewhere.
ACESTEP_PY="${ACESTEP_PY:-.venv-acestep/bin/python}"
AYA_PORT="${AYA_PORT:-7864}"
KLEIN_PORT="${KLEIN_PORT:-7865}"
ACESTEP_PORT="${ACESTEP_PORT:-7866}"
# Bind address. 0.0.0.0 = reachable from the LAN (other machines on the network) at this host's
# IP:PORT. Set BIND=127.0.0.1 to restrict to localhost (main app on the same box only).
BIND="${BIND:-0.0.0.0}"
mkdir -p logs

start_one() {
  local name="$1" dir="$2" port="$3" py="${4:-$PY}"
  if [ -f "logs/$name.pid" ] && kill -0 "$(cat "logs/$name.pid")" 2>/dev/null; then
    echo "[$name] already running (pid $(cat "logs/$name.pid")) on :$port"
    return
  fi
  echo "[$name] starting on $BIND:$port (logs/$name.log)"
  PORT="$port" GRADIO_SERVER_NAME="$BIND" nohup "$py" "spaces/$dir/app.py" \
    > "logs/$name.log" 2>&1 &
  echo $! > "logs/$name.pid"
}

wait_ready() {
  local name="$1" port="$2"
  echo -n "[$name] loading model"
  for _ in $(seq 1 600); do  # up to ~10 min (cold model download/load)
    if curl -fsS "http://127.0.0.1:$port/config" >/dev/null 2>&1; then
      echo " — ready at http://127.0.0.1:$port"
      return 0
    fi
    if [ -f "logs/$name.pid" ] && ! kill -0 "$(cat "logs/$name.pid")" 2>/dev/null; then
      echo " — DIED, tail of logs/$name.log:"; tail -n 30 "logs/$name.log"; return 1
    fi
    echo -n "."; sleep 1
  done
  echo " — timed out"; return 1
}

stop_one() {
  local name="$1"
  if [ -f "logs/$name.pid" ]; then
    kill "$(cat "logs/$name.pid")" 2>/dev/null || true
    rm -f "logs/$name.pid"
    echo "[$name] stopped"
  fi
}

case "${1:-all}" in
  stop)  stop_one aya; stop_one klein; stop_one acestep ;;
  aya)   start_one aya  tiny-aya-zerogpu "$AYA_PORT";   wait_ready aya  "$AYA_PORT" ;;
  klein) start_one klein klein-zerogpu   "$KLEIN_PORT"; wait_ready klein "$KLEIN_PORT" ;;
  # ACE-Step (music + sung vocals) — its own venv; not in `all` since it's heavier on the
  # shared card. Start it on demand: ./run_sidecars.sh acestep
  acestep) start_one acestep acestep-zerogpu "$ACESTEP_PORT" "$ACESTEP_PY"; wait_ready acestep "$ACESTEP_PORT" ;;
  all|*)
    start_one aya  tiny-aya-zerogpu "$AYA_PORT"
    start_one klein klein-zerogpu   "$KLEIN_PORT"
    wait_ready aya  "$AYA_PORT"
    wait_ready klein "$KLEIN_PORT"
    echo "both sidecars up. point the main app at them (already set in .env)."
    ;;
esac
