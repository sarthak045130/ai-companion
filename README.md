# AI Companion

A local-first desktop AI companion for macOS: persistent personality, long-term memory you can see and edit, saved conversations, voice in and out, and Ollama as the brain. Nothing leaves your computer unless you point it somewhere else.

## Quick start (your Mac)

```bash
cd ai-companion
./scripts/setup.sh          # creates .venv, installs dependencies, checks Ollama
./scripts/smoke_test.py     # checks YOUR Ollama, model, embeddings, memory, voice (recommended first run)
./scripts/run.sh            # opens the app window
```

Before the first run, in Terminal:

```bash
ollama pull qwen3:8b            # or any chat model you like; the app picks an installed one if this isn't
ollama pull nomic-embed-text    # enables meaning-based memory recall
```

If `pywebview` can't be installed, the app opens in your browser instead (`./scripts/run.sh --no-window` forces that).

## How it works

```
Window (pywebview) ── HTML/CSS/JS UI
        │  http://127.0.0.1 only, per-launch token
   Local API (standard library http.server, SSE streaming)
        │
   Companion pipeline (app/ai/orchestrator.py)
   message → history → recall memories → personality → Ollama (streamed) → save reply → [background] extract memories
        │
 ┌──────┴────────┬────────────────┬───────────────┐
 Ollama client   Memory (SQLite +   Voice            Config
 (stdlib)        vector cache)      Whisper + `say`  settings.json, personality.json
```

I chose a Python backend with a web-technology UI inside a native window because it gives a polished interface and keeps all AI logic in testable Python. The backend uses only the standard library plus numpy, which keeps installation small.

### Memory

- **Extraction** runs after each reply, in the background, so it never delays you. The chat model (or one you choose) is asked which facts are worth keeping, shown the most related existing memories, and can say which one a new fact replaces.
- **Filtering:** small talk and one-off questions are skipped, and anything rated below your importance threshold is dropped.
- **Updates:** "I don't like coffee" followed by "I've started liking coffee" replaces the old memory. The old one is kept (hidden by default, shown under "Show memories that were replaced") for history.
- **Duplicates** are merged instead of stored twice.
- **Recall:** each message is matched against your memories by meaning (Ollama embeddings), nudged by importance and recency. Very important memories (importance 0.9+, such as your name) are always eligible. Every reply shows "N memories used" so you can see what influenced it.
- **Fallback:** if the embedding model isn't installed, memory still works with simpler word matching, and re-indexes itself once the model is available.
- **Control:** Memories (sidebar) lets you search, filter, edit, add and delete. Settings → Memory has the thresholds.

### Personality

Edit `personality/personality.json` (or Settings → Personality) and press "Reload from file". Traits, speaking style, humor, interests, dislikes, emotional tendencies, vocabulary, phrases, boundaries and relationship are turned into the model's context. A fixed rule keeps the companion honest that it is an AI.

### Voice

- **Output:** macOS `say` (local). Choose voice and speed in Settings → Voice; replay or stop from any message.
- **Input:** the mic button records in the Python backend, then transcribes locally with faster-whisper (`base` by default; the first use downloads the model once). If macOS asks for microphone access, allow it for the app you launched from (Terminal or VS Code). If it never asks, check System Settings → Privacy & Security → Microphone.

### Privacy

- The server binds to `127.0.0.1`, checks Host and Origin headers, and requires a random token on every API call, so other websites and processes can't read your chats or memories.
- The interface loads no external fonts, scripts or images.
- The only network traffic is to your Ollama address (default `localhost:11434`) and, on first use only, the Whisper model download from Hugging Face.
- Data lives in `data/` (SQLite database + `settings.json`). `scripts/export_data.py` writes readable JSON backups.

## Files

```
app/
  ai/           ollama_client.py, orchestrator.py (the pipeline)
  memory/       store.py, extractor.py, embeddings.py
  voice/        stt.py (mic + Whisper), tts.py (say)
  database/     db.py, conversations.py
  config/       settings.py, personality.py
  backend/      server.py (API + static files)
  frontend/     index.html, style.css, app.js, render.js
  core.py       wires everything together    main.py  desktop launcher
personality/personality.json
data/           your database and settings (git-ignored)
tests/          python3 -m unittest discover -s tests -t .   and   node tests/render.test.js
scripts/        setup.sh, run.sh, smoke_test.py, export_data.py
```

## Testing

`python3 -m unittest discover -s tests -t .` runs 50 tests against a stand-in Ollama server: persistence across restarts, memory extraction/update/recall, the streaming pipeline, API security, voice paths (with a fake `say`, microphone and Whisper). `node tests/render.test.js` covers the Markdown renderer.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Ollama is offline" banner | Open the Ollama app or run `ollama serve`. |
| "Model isn't installed" | Settings → AI model, or `ollama pull <name>`. |
| Replies are slow to start | A thinking model may be reasoning first. Try a non-thinking model, or lower context length. |
| Memories never recalled | Run `ollama pull nomic-embed-text`; lower Settings → Memory → "Relevance needed for recall". |
| Nothing gets remembered | Lower the importance threshold, or set a larger "Model for saving memories". |
| Mic records silence | Allow microphone access (see Voice above) and pick the right input device. |
| Window won't open | `pip install pywebview`, or use `--no-window`. |

## Ideas for later

The structure leaves room for: other LLM providers (add a client beside `ollama_client.py`), multiple personalities (the store already takes a path), images, wake word, avatar, sync. A packaged `.app` bundle (PyInstaller or py2app) isn't included yet.
