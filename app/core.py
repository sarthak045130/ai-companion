
"""Application context: wires every component together."""

from __future__ import annotations

import logging
import os
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .ai.ollama_client import OllamaClient, OllamaError
from .ai.orchestrator import Companion
from .config.personality import PersonalityStore
from .config.settings import DEFAULTS, SettingsStore
from .database.conversations import ConversationStore
from .database.db import Database
from .memory.embeddings import Embedder
from .memory.extractor import MemoryExtractor
from .memory.store import MemoryStore
from .voice.stt import SpeechToText
from .voice.tts import TTS

log = logging.getLogger("companion")

if getattr(sys, "frozen", False):
    ROOT = Path(sys._MEIPASS)
else:
    ROOT = Path(__file__).resolve().parents[1]

APP_SUPPORT = Path.home() / "Library" / "Application Support" / "Nova"


@dataclass
class AppContext:
    root: Path
    data_dir: Path
    settings: SettingsStore
    personality: PersonalityStore
    db: Database
    convs: ConversationStore
    client: OllamaClient
    embedder: Embedder
    memory: MemoryStore
    extractor: MemoryExtractor
    companion: Companion
    tts: TTS
    stt: SpeechToText

    def ensure_model(self) -> str | None:
        """Choose an installed chat model if the default is unavailable."""
        current = self.settings.value("ai", "model")
        try:
            names = [m["name"] for m in self.client.list_models()]
        except OllamaError:
            return None

        if not names or current in names or f"{current}:latest" in names:
            return None
        if current != DEFAULTS["ai"]["model"]:
            return None

        chat_models = [n for n in names if "embed" not in n.lower()]
        if not chat_models:
            return None

        for prefix in ("qwen3", "qwen", "llama", "gemma", "mistral", "phi"):
            for name in chat_models:
                if name.lower().startswith(prefix):
                    self.settings.update({"ai": {"model": name}})
                    return name

        self.settings.update({"ai": {"model": chat_models[0]}})
        return chat_models[0]

    def background_startup(self) -> None:
        def job() -> None:
            try:
                self.ensure_model()
                self.memory.reindex_stale()
            except Exception:
                log.exception("startup task failed")

        threading.Thread(target=job, name="startup", daemon=True).start()

    def close(self) -> None:
        self.tts.stop()
        try:
            self.extractor.shutdown()
        finally:
            self.db.close()


def create_context(
    data_dir: str | Path | None = None,
    personality_path: str | Path | None = None,
    stt: Any = None,
    tts: Any = None,
) -> AppContext:
    bundled_personality = ROOT / "personality" / "personality.json"

    if getattr(sys, "frozen", False):
        default_data_dir = APP_SUPPORT
    else:
        default_data_dir = ROOT / "data"

    data_dir = Path(
        data_dir or os.environ.get("COMPANION_DATA_DIR") or default_data_dir
    ).expanduser()

    personality_path = Path(
        personality_path
        or os.environ.get("COMPANION_PERSONALITY")
        or bundled_personality
    ).expanduser()

    for sub in ("database", "conversations", "memories"):
        (data_dir / sub).mkdir(parents=True, exist_ok=True)

    settings = SettingsStore(data_dir / "settings.json")
    personality = PersonalityStore(personality_path)
    db = Database(data_dir / "database" / "companion.db")
    convs = ConversationStore(db)
    client = OllamaClient(lambda: settings.value("ai", "base_url"))
    embedder = Embedder(client, lambda: settings.section("memory"))
    memory = MemoryStore(db, embedder)
    extractor = MemoryExtractor(
        memory,
        client,
        lambda: settings.section("memory"),
        lambda: settings.value("ai", "model"),
    )
    companion = Companion(
        convs, memory, extractor, personality, settings, client
    )

    return AppContext(
        root=ROOT,
        data_dir=data_dir,
        settings=settings,
        personality=personality,
        db=db,
        convs=convs,
        client=client,
        embedder=embedder,
        memory=memory,
        extractor=extractor,
        companion=companion,
        tts=tts or TTS(lambda: settings.section("voice")),
        stt=stt or SpeechToText(lambda: settings.section("voice")),
    )