#!/usr/bin/env python3
"""Checks the app's real integrations on YOUR machine: Ollama, your model, embeddings, memory, TTS, mic.

Run after setup:   ./scripts/smoke_test.py          (or: .venv/bin/python scripts/smoke_test.py)
Uses a throwaway data folder, so it never touches your real memories or chats.
"""
from __future__ import annotations

import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import create_context  # noqa: E402

results: list[tuple[str, str, str]] = []


def check(name: str, fn):
    t0 = time.time()
    try:
        detail = fn() or ""
        results.append(("PASS", name, f"{detail} ({time.time() - t0:.1f}s)".strip()))
        return True
    except Exception as exc:  # noqa: BLE001
        results.append(("FAIL", name, str(exc)))
        return False


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="companion-smoke-"))
    ctx = create_context(tmp / "data", tmp / "personality.json")
    try:
        def ollama():
            h = ctx.client.health()
            if not h["ok"]:
                raise RuntimeError(h["error"])
            return f"Ollama {h['version']} at {ctx.client.base_url}"

        if not check("Ollama is running", ollama):
            return report()

        names: list[str] = []

        def models():
            nonlocal names
            names = [m["name"] for m in ctx.client.list_models()]
            if not names:
                raise RuntimeError("no models installed. Try: ollama pull qwen3:8b")
            return ", ".join(names)

        check("Models installed", models)
        chosen = ctx.ensure_model() or ctx.settings.value("ai", "model")

        def chat():
            if chosen not in names and f"{chosen}:latest" not in names:
                raise RuntimeError(f"model '{chosen}' isn't installed. Pick one in Settings or run: ollama pull {chosen}")
            events = list(ctx.companion.stream_reply(None, "Reply with one short friendly sentence."))
            if events[-1]["type"] != "done":
                raise RuntimeError(events[-1].get("message", "no reply"))
            first_token = next(i for i, e in enumerate(events) if e["type"] == "token")
            return f"{chosen} replied: {events[-1]['message']['content'][:70]!r} ({first_token} events before first token)"

        check("Streaming chat with your model", chat)

        def embed():
            if ctx.embedder.kind == "hash":
                raise RuntimeError("embedding model unavailable, memory falls back to word matching. Run: ollama pull nomic-embed-text")
            kind, vecs = ctx.embedder.embed(["hello"])
            return f"{kind}, {vecs.shape[1]} dimensions"

        check("Embedding model (meaning-based recall)", embed)

        def memory():
            ctx.memory.add("User enjoys walking around Marine Drive at night.", "preference", 0.7)
            ctx.memory.add("User likes pizza with extra cheese.", "preference", 0.5)
            ctx.memory.add("User wants to visit Japan.", "goal", 0.6)
            hits = ctx.memory.search("I'm thinking about going somewhere tonight", limit=3, min_similarity=0.0)
            top = ", ".join(f"{h['text'][:32]}… ({h['similarity']:.2f})" for h in hits)
            if not hits or "Marine Drive" not in hits[0]["text"]:
                raise RuntimeError(f"expected the Marine Drive memory first. Got: {top}. Tune Settings → Memory → relevance.")
            return f"top: {top}"

        check("Memory recall ('going somewhere tonight' → Marine Drive)", memory)

        def extraction():
            conv = ctx.convs.create()
            acts = ctx.extractor.process(conv["id"], "I started learning the violin last month and I really love it.", "That's great!")
            if not acts:
                raise RuntimeError(f"nothing extracted (last error: {ctx.extractor.last_error}). Try a larger chat model.")
            return "; ".join(f"{a['action']}: {a.get('memory', {}).get('text', a.get('text', ''))}" for a in acts)

        check("LLM memory extraction", extraction)

        def tts():
            if not ctx.tts.available:
                raise RuntimeError("no text-to-speech engine found (macOS has `say` built in)")
            voices = ctx.tts.voices()
            return f"{ctx.tts.backend}, {len(voices)} voices"

        check("Text-to-speech", tts)

        def mic():
            st = ctx.stt.status()
            if not st["microphone_available"]:
                raise RuntimeError(st["reason"])
            if not st["transcription_available"]:
                raise RuntimeError("faster-whisper not installed (pip install faster-whisper)")
            return f"{len(ctx.stt.recorder.devices())} input devices; Whisper installed"

        check("Voice input libraries", mic)
    finally:
        ctx.extractor.wait_idle(5)
        ctx.close()
        shutil.rmtree(tmp, ignore_errors=True)
    return report()


def report() -> int:
    width = max(len(n) for _, n, _ in results)
    for status, name, detail in results:
        print(f"[{status}] {name.ljust(width)}  {detail}")
    failed = sum(1 for s, _, _ in results if s == "FAIL")
    print(f"\n{len(results) - failed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
