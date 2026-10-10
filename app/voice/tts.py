"""Text-to-speech. macOS: the built-in `say` command (fully local). Linux: espeak(-ng) if present."""
from __future__ import annotations

import re
import shutil
import subprocess
import threading
from typing import Any, Callable

# Long names ("Eddy (English (US))") are separated from the language code by a single space.
_VOICE_LINE = re.compile(r"^(?P<name>.+?)\s+(?P<lang>[A-Za-z]{2,3}[_-][A-Za-z0-9]+)\s+#\s*(?P<sample>.*)$")
_EMOJI = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF\U0000FE0F\U0000200D]+", flags=re.UNICODE
)


def clean_for_speech(text: str) -> str:
    text = re.sub(r"```.*?```", " (code omitted) ", text, flags=re.S)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"https?://\S+", "link", text)
    text = re.sub(r"[*_#>~|]+", " ", text)
    text = re.sub(r"^\s*[-+]\s+", "", text, flags=re.M)
    text = _EMOJI.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()[:4000]


def parse_say_voices(output: str) -> list[dict[str, str]]:
    voices = []
    for line in output.splitlines():
        m = _VOICE_LINE.match(line.rstrip())
        if m:
            voices.append({"name": m.group("name").strip(), "lang": m.group("lang").replace("_", "-")})
    return voices


class TTS:
    def __init__(self, settings_getter: Callable[[], dict[str, Any]]):
        self._settings = settings_getter
        self._proc: subprocess.Popen | None = None
        self._lock = threading.Lock()
        self._voices: list[dict[str, str]] | None = None

    # ---- backend discovery --------------------------------------------------
    def _binary(self) -> tuple[str, str] | None:
        if shutil.which("say"):
            return "say", shutil.which("say")  # type: ignore[return-value]
        for name in ("espeak-ng", "espeak"):
            if shutil.which(name):
                return "espeak", shutil.which(name)  # type: ignore[return-value]
        return None

    @property
    def available(self) -> bool:
        return self._binary() is not None

    @property
    def backend(self) -> str:
        b = self._binary()
        return b[0] if b else "none"

    def voices(self) -> list[dict[str, str]]:
        if self._voices is None:
            b = self._binary()
            self._voices = []
            if b and b[0] == "say":
                try:
                    out = subprocess.run([b[1], "-v", "?"], capture_output=True, text=True, timeout=10).stdout
                    self._voices = parse_say_voices(out)
                except (OSError, subprocess.SubprocessError):
                    pass
        return list(self._voices)

    # ---- playback -----------------------------------------------------------
    @property
    def speaking(self) -> bool:
        with self._lock:
            return self._proc is not None and self._proc.poll() is None

    def speak(self, text: str, voice: str | None = None, rate: int | None = None) -> bool:
        b = self._binary()
        if not b:
            return False
        cleaned = clean_for_speech(text)
        if not cleaned:
            return False
        cfg = self._settings()
        voice = voice if voice is not None else cfg.get("tts_voice", "")
        rate = int(rate if rate is not None else cfg.get("tts_rate", 175))
        if b[0] == "say":
            cmd = [b[1]]
            if voice and voice in {v["name"] for v in self.voices()}:  # only known voices reach the command line
                cmd += ["-v", voice]
            cmd += ["-r", str(rate), "-f", "-"]
        else:
            cmd = [b[1], "-s", str(rate), "--stdin"]
        self.stop()
        with self._lock:
            self._proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            proc = self._proc

        def feed() -> None:
            try:
                assert proc.stdin is not None
                proc.stdin.write(cleaned.encode("utf-8"))
                proc.stdin.close()
            except (OSError, ValueError):
                pass

        threading.Thread(target=feed, daemon=True).start()
        return True

    def stop(self) -> None:
        with self._lock:
            proc, self._proc = self._proc, None
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
