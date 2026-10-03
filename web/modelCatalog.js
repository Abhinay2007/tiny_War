// Curated small instruct models for the IN-BROWSER (wllama / llama.cpp WASM) path.
// Constraints that shaped this list (verified June 2026 via the HF API):
//   • Ungated — wllama fetches the GGUF anonymously; gated repos (official Llama/
//     Gemma) won't load, so we use ungated mirrors (bartowski, unsloth, Qwen, SmolLM).
//   • ≤ ~2 GB single file — the browser's ArrayBuffer cap is 2 GB (bigger needs split
//     GGUFs). That's why Gemma 4 E2B (3.1 GB) and Qwen3-4B (2.5 GB) are server-only,
//     and big ones like Qwen3.5-9B / MiniMax don't fit in-browser at all.
//   • Q4_K_M quant (good size/quality), CPU-WASM friendly.
// Sizes are the real download bytes. The hackathon's "≤32B" is the *runtime* cap; the
// browser is far smaller, so this list is sub-3B.
export const MODELS = [
  { id: 'smollm2-360m', label: 'SmolLM2 360M', params: '360M', bytes: 386e6,
    repo: 'HuggingFaceTB/SmolLM2-360M-Instruct-GGUF', file: 'smollm2-360m-instruct-q8_0.gguf',
    note: 'tiniest — fastest, roughest' },
  { id: 'qwen3-0.6b', label: 'Qwen3 0.6B', params: '0.6B', bytes: 397e6, thinks: true,
    repo: 'unsloth/Qwen3-0.6B-GGUF', file: 'Qwen3-0.6B-Q4_K_M.gguf',
    note: 'newest tiny — strong, has a thinking mode' },
  { id: 'qwen2.5-0.5b', label: 'Qwen2.5 0.5B', params: '0.5B', bytes: 491e6,
    repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF', file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    note: 'default — fast, clean JSON, no thinking overhead' },
  { id: 'llama3.2-1b', label: 'Llama 3.2 1B', params: '1B', bytes: 808e6,
    repo: 'bartowski/Llama-3.2-1B-Instruct-GGUF', file: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    note: 'solid 1B all-rounder' },
  { id: 'smollm2-1.7b', label: 'SmolLM2 1.7B', params: '1.7B', bytes: 1056e6,
    repo: 'HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF', file: 'smollm2-1.7b-instruct-q4_k_m.gguf',
    note: 'strong tiny model' },
  { id: 'qwen3-1.7b', label: 'Qwen3 1.7B', params: '1.7B', bytes: 1107e6,
    repo: 'unsloth/Qwen3-1.7B-GGUF', file: 'Qwen3-1.7B-Q4_K_M.gguf',
    note: 'newer Qwen3 — has a thinking mode' },
  { id: 'qwen2.5-1.5b', label: 'Qwen2.5 1.5B', params: '1.5B', bytes: 1117e6,
    repo: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF', file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    note: 'reliable, clean JSON' },
  { id: 'llama3.2-3b', label: 'Llama 3.2 3B', params: '3B', bytes: 2019e6,
    repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF', file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    note: 'bigger/better, slower in-browser' },
  { id: 'qwen2.5-3b', label: 'Qwen2.5 3B', params: '3B', bytes: 2105e6,
    repo: 'Qwen/Qwen2.5-3B-Instruct-GGUF', file: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    note: 'best quality here; near the 2 GB browser limit' },
]

export const DEFAULT_MODEL = 'qwen2.5-0.5b'

export const getModel = (id) => MODELS.find((m) => m.id === id) || MODELS.find((m) => m.id === DEFAULT_MODEL)

export const fmtBytes = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB')
