"""Speech-to-text: microphone capture (sounddevice) + local Whisper (faster-whisper).

Recording happens in the Python backend, so macOS asks for microphone access for the app/terminal
that launched it instead of depending on the embedded web view.
"""
from __future__ import annotations

import threading
from typing import Any, Callable

import numpy as np

SAMPLE_RATE = 16000
MAX_SECONDS = 120


class VoiceError(Exception):
    pass


class Recorder:
    def __init__(self) -> None:
        self._stream: Any = None
        self._chunks: list[np.ndarray] = []
        self._frames = 0
        self._lock = threading.Lock()
        self.level = 0.0

    @staticmethod
    def _sd() -> Any:
        try:
            import sounddevice as sd  # type: ignore
        except Exception as exc:  # ImportError or PortAudio OSError
            raise VoiceError(
                "Microphone support isn't installed. Run: pip install sounddevice  (then restart the app)."
            ) from exc
        return sd

    def devices(self) -> list[dict[str, Any]]:
        sd = self._sd()
        out = []
        for idx, dev in enumerate(sd.query_devices()):
            if dev.get("max_input_channels", 0) > 0:
                out.append({"index": idx, "name": dev["name"]})
        return out

    @property
    def recording(self) -> bool:
        return self._stream is not None

    def start(self, device: int | str | None = None) -> None:
        sd = self._sd()
        if self._stream is not None:
            raise VoiceError("Already recording.")
        self._chunks, self._frames, self.level = [], 0, 0.0

        def callback(indata: np.ndarray, frames: int, time_info: Any, status: Any) -> None:
            with self._lock:
                if self._frames < MAX_SECONDS * SAMPLE_RATE:
                    self._chunks.append(indata[:, 0].copy())
                    self._frames += frames
                    self.level = float(np.sqrt(np.mean(indata.astype(np.float32) ** 2)) / 32768.0)

        try:
            self._stream = sd.InputStream(
                samplerate=SAMPLE_RATE, channels=1, dtype="int16", device=device, callback=callback
            )
            self._stream.start()
        except Exception as exc:  # noqa: BLE001
            self._stream = None
            raise VoiceError(
                "Couldn't open the microphone. On macOS, allow microphone access for Terminal / VS Code / the "
                "app you launched this from (System Settings → Privacy & Security → Microphone), then try again. "
                f"({exc})"
            ) from exc

    def stop(self) -> np.ndarray:
        stream, self._stream = self._stream, None
        if stream is not None:
            try:
                stream.stop()
                stream.close()
            except Exception:  # noqa: BLE001
                pass
        with self._lock:
            audio = np.concatenate(self._chunks) if self._chunks else np.zeros(0, dtype=np.int16)
            self._chunks, self._frames = [], 0
        return audio

    def cancel(self) -> None:
        self.stop()


class Transcriber:
    """Lazy-loads faster-whisper on first use (downloads the model once, then works offline)."""

    def __init__(self, model_getter: Callable[[], str], language_getter: Callable[[], str]):
        self._model_name = model_getter
        self._language = language_getter
        self._model: Any = None
        self._loaded_name = ""
        self._lock = threading.Lock()

    @staticmethod
    def available() -> bool:
        try:
            import faster_whisper  # noqa: F401  # type: ignore
            return True
        except Exception:  # noqa: BLE001
            return False

    def transcribe(self, audio: np.ndarray) -> str:
        try:
            from faster_whisper import WhisperModel  # type: ignore
        except Exception as exc:  # noqa: BLE001
            raise VoiceError("Speech recognition isn't installed. Run: pip install faster-whisper") from exc
        name = self._model_name()
        with self._lock:
            if self._model is None or self._loaded_name != name:
                try:
                    self._model = WhisperModel(name, device="cpu", compute_type="int8")
                except Exception as exc:  # noqa: BLE001
                    raise VoiceError(
                        f"Couldn't load the Whisper model '{name}'. The first use needs internet to download it "
                        f"once (from Hugging Face). ({exc})"
                    ) from exc
                self._loaded_name = name
            model = self._model
        lang = self._language()
        segments, _info = model.transcribe(
            audio.astype(np.float32) / 32768.0,
            language=None if lang in ("", "auto") else lang,
            vad_filter=True,
            beam_size=5,
        )
        return " ".join(seg.text.strip() for seg in segments).strip()


class SpeechToText:
    def __init__(self, settings_getter: Callable[[], dict[str, Any]], recorder: Any = None, transcriber: Any = None):
        self._settings = settings_getter
        self.recorder = recorder or Recorder()
        self.transcriber = transcriber or Transcriber(
            lambda: self._settings().get("stt_model", "base"), lambda: self._settings().get("stt_language", "auto")
        )

    def status(self) -> dict[str, Any]:
        recorder_ok, reason = True, ""
        try:
            Recorder._sd()
        except VoiceError as exc:
            recorder_ok, reason = False, str(exc)
        return {
            "recording": self.recorder.recording,
            "microphone_available": recorder_ok,
            "transcription_available": getattr(self.transcriber, "available", lambda: True)(),
            "reason": reason,
        }

    def start(self) -> None:
        self.recorder.start(self._settings().get("input_device"))

    def cancel(self) -> None:
        self.recorder.cancel()

    def stop_and_transcribe(self) -> str:
        audio = self.recorder.stop()
        if audio.size < SAMPLE_RATE * 0.3:
            raise VoiceError("That was too short to transcribe. Hold the mic a bit longer and speak clearly.")
        if int(np.max(np.abs(audio))) < 30:
            raise VoiceError(
                "The microphone only captured silence. Check macOS microphone permission for the app you launched "
                "this from and the selected input device."
            )
        text = self.transcriber.transcribe(audio)
        if not text:
            raise VoiceError("I couldn't make out any speech. Try again a little closer to the microphone.")
        return text
