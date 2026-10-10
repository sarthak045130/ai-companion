"""User settings: defaults, validation and atomic persistence to JSON."""
from __future__ import annotations

import copy
import json
import os
import threading
from pathlib import Path
from typing import Any

DEFAULTS: dict[str, dict[str, Any]] = {
    "ai": {
        "provider": "ollama",
        "base_url": "http://localhost:11434",
        "model": "qwen3:8b",
        "temperature": 0.8,
        "top_p": 0.9,
        "context_length": 8192,
        "max_tokens": 1024,
        "history_messages": 24,
        "system_prompt_extra": "",
    },
    "memory": {
        "enabled": True,
        "retrieval_limit": 6,
        "importance_threshold": 0.4,
        "min_similarity": 0.35,
        "use_ollama_embeddings": True,
        "embedding_model": "nomic-embed-text",
        "extraction_model": "",
    },
    "voice": {
        "tts_enabled": False,
        "tts_voice": "",
        "tts_rate": 175,
        "stt_model": "base",
        "stt_language": "auto",
        "input_device": None,
        "auto_send_voice": True,
    },
    "appearance": {
        "theme": "dark",
        "font_size": 15,
    },
}

# (min, max) numeric clamps
_RANGES: dict[tuple[str, str], tuple[float, float]] = {
    ("ai", "temperature"): (0.0, 2.0),
    ("ai", "top_p"): (0.0, 1.0),
    ("ai", "context_length"): (512, 131072),
    ("ai", "max_tokens"): (16, 32768),
    ("ai", "history_messages"): (2, 200),
    ("memory", "retrieval_limit"): (0, 20),
    ("memory", "importance_threshold"): (0.0, 1.0),
    ("memory", "min_similarity"): (0.0, 1.0),
    ("voice", "tts_rate"): (80, 400),
    ("appearance", "font_size"): (12, 22),
}

_ENUMS: dict[tuple[str, str], set[str]] = {
    ("appearance", "theme"): {"dark", "light", "system"},
    ("ai", "provider"): {"ollama"},
}


class SettingsError(ValueError):
    pass


def _coerce(section: str, key: str, default: Any, value: Any) -> Any:
    if key == "input_device":
        if value in (None, "", "default"):
            return None
        if isinstance(value, bool):
            raise SettingsError("voice.input_device must be a device index, name or null")
        if isinstance(value, (int, str)):
            return value
        raise SettingsError("voice.input_device must be a device index, name or null")
    if isinstance(default, bool):
        if isinstance(value, bool):
            return value
        if isinstance(value, str) and value.lower() in ("true", "false"):
            return value.lower() == "true"
        raise SettingsError(f"{section}.{key} must be true or false")
    if isinstance(default, (int, float)):
        if isinstance(value, bool):
            raise SettingsError(f"{section}.{key} must be a number")
        try:
            num = float(value)
        except (TypeError, ValueError):
            raise SettingsError(f"{section}.{key} must be a number") from None
        lo, hi = _RANGES.get((section, key), (float("-inf"), float("inf")))
        num = max(lo, min(hi, num))
        return int(round(num)) if isinstance(default, int) else num
    if isinstance(default, str):
        if not isinstance(value, str):
            raise SettingsError(f"{section}.{key} must be text")
        value = value.strip() if key != "system_prompt_extra" else value
        allowed = _ENUMS.get((section, key))
        if allowed and value not in allowed:
            raise SettingsError(f"{section}.{key} must be one of {sorted(allowed)}")
        if key == "base_url":
            value = value.rstrip("/")
            if not value.startswith(("http://", "https://")):
                raise SettingsError("ai.base_url must start with http:// or https://")
        return value
    return value


class SettingsStore:
    """Thread-safe, cached settings with atomic writes."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        self._data = copy.deepcopy(DEFAULTS)
        self.load_error: str | None = None
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            self._save()
            return
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                raise ValueError("settings file must contain a JSON object")
        except (OSError, ValueError) as exc:
            self.load_error = f"Could not read settings ({exc}); using defaults."
            return
        for section, defaults in DEFAULTS.items():
            stored = raw.get(section)
            if not isinstance(stored, dict):
                continue
            for key, default in defaults.items():
                if key in stored:
                    try:
                        self._data[section][key] = _coerce(section, key, default, stored[key])
                    except SettingsError:
                        pass  # keep default for a corrupt value

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._data, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)

    def get(self) -> dict[str, dict[str, Any]]:
        with self._lock:
            return copy.deepcopy(self._data)

    def section(self, name: str) -> dict[str, Any]:
        with self._lock:
            return dict(self._data[name])

    def value(self, section: str, key: str) -> Any:
        with self._lock:
            return self._data[section][key]

    def update(self, patch: dict[str, Any]) -> dict[str, dict[str, Any]]:
        """Apply {section: {key: value}}. All-or-nothing; unknown keys are rejected."""
        if not isinstance(patch, dict):
            raise SettingsError("settings patch must be an object")
        staged = copy.deepcopy(self._data)
        for section, values in patch.items():
            if section not in DEFAULTS:
                raise SettingsError(f"unknown settings section: {section}")
            if not isinstance(values, dict):
                raise SettingsError(f"settings section {section} must be an object")
            for key, value in values.items():
                if key not in DEFAULTS[section]:
                    raise SettingsError(f"unknown setting: {section}.{key}")
                staged[section][key] = _coerce(section, key, DEFAULTS[section][key], value)
        with self._lock:
            self._data = staged
            self._save()
            return copy.deepcopy(self._data)
