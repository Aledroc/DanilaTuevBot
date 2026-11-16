import base64
import logging
import subprocess
import tempfile
import time
from pathlib import Path

import requests

try:
    import msgpack
except ImportError:
    msgpack = None

from config import (
    FISH_AUDIO_API_KEY,
    FISH_AUDIO_TTS_URL,
    OPENROUTER_API_KEY,
    VOICE_ID,
    NORDROUTER_API_KEY,
    STT_API_URL,
    STT_MODEL,
)

OPENROUTER_TTS_URL = "https://openrouter.ai/api/v1/audio/speech"
OPENROUTER_VOICE_MODEL = "fish-audio/s2.1-pro-free:free"
_last_tts_call = 0.0
_TTS_MIN_INTERVAL = 0.5


def transcribe_audio(data: bytes, filename: str, mime: str, timeout: int = 60) -> str | None:
    """Transcribe audio with NordRouter's documented multimodal chat endpoint."""
    if not data or not NORDROUTER_API_KEY:
        return None

    audio_format = {
        "audio/ogg": "ogg",
        "audio/opus": "ogg",
        "audio/mpeg": "mp3",
        "audio/mp3": "mp3",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/mp4": "m4a",
        "audio/x-m4a": "m4a",
        "audio/flac": "flac",
        "audio/aac": "aac",
    }.get((mime or "").lower())
    if not audio_format:
        audio_format = Path(filename or "").suffix.lower().lstrip(".")
    if audio_format == "oga":
        audio_format = "ogg"
    if audio_format not in {"wav", "mp3", "ogg", "aac", "flac", "m4a"}:
        audio_format = "ogg"

    payload = {
        "model": STT_MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Дословно расшифруй речь в аудио. Автоматически определи язык. "
                        "Верни только текст речи, без пояснений и ответов на её содержание. "
                        "Если речи нет, верни пустой текст."
                    ),
                },
                {
                    "type": "input_audio",
                    "input_audio": {
                        "data": base64.b64encode(data).decode("ascii"),
                        "format": audio_format,
                    },
                },
            ],
        }],
        "temperature": 0,
        "max_tokens": 2048,
    }
    try:
        response = requests.post(
            STT_API_URL,
            headers={
                "Authorization": f"Bearer {NORDROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=timeout,
        )
        if response.status_code != 200:
            logging.warning("NordRouter transcription failed: HTTP %s %s", response.status_code, response.text[:300])
            return None

        message = response.json().get("choices", [{}])[0].get("message", {})
        content = message.get("content") or ""
        if isinstance(content, list):
            transcript = " ".join(
                part.get("text", "") for part in content if isinstance(part, dict)
            ).strip()
        else:
            transcript = str(content).strip()
        return transcript or None
    except Exception:
        logging.exception("NordRouter transcription request failed")
        return None


def _throttle_tts():
    global _last_tts_call
    wait = _TTS_MIN_INTERVAL - (time.time() - _last_tts_call)
    if wait > 0:
        time.sleep(wait)
    _last_tts_call = time.time()


def _convert_audio_to_ogg(audio_bytes: bytes, timeout: int = 60) -> bytes | None:
    """Конвертирует аудио (MP3/WAV/etc) в Telegram-совместимый OGG Opus через ffmpeg."""
    if not audio_bytes:
        return None
    if audio_bytes.startswith(b"OggS"):
        return audio_bytes
    try:
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp) / "input.bin", Path(tmp) / "voice.ogg"
            source.write_bytes(audio_bytes)
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(source), "-c:a", "libopus", "-f", "ogg", str(target)],
                check=True,
                timeout=timeout,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            ogg = target.read_bytes()
            return ogg if ogg.startswith(b"OggS") else None
    except Exception:
        logging.exception("ffmpeg conversion to ogg failed")
        return None


def _fish_audio_tts(text: str, ref_b64: str = "", ref_mime: str = "audio/ogg",
                    ref_transcript: str | None = None, reference_id: str | None = None,
                    timeout: int = 60) -> bytes | None:
    """Синтезирует речь через официальный API Fish Audio (https://api.fish.audio/v1/tts)."""
    if not FISH_AUDIO_API_KEY:
        logging.warning("Fish Audio TTS skipped: FISH_AUDIO_API_KEY is not configured")
        return None

    headers = {
        "Authorization": f"Bearer {FISH_AUDIO_API_KEY}",
        "model": "s2.1-pro-free",
    }

    # Если есть бинарный образец голоса и установлен msgpack, используем zero-shot voice cloning через msgpack
    raw_audio_bytes = None
    if ref_b64:
        try:
            raw_audio_bytes = base64.b64decode(ref_b64)
        except Exception:
            logging.exception("Failed to decode ref_b64 for Fish Audio")

    try:
        _throttle_tts()
        if raw_audio_bytes and msgpack is not None:
            # Zero-shot voice cloning с бинарным образцом через msgpack в полном соответствии с docs.fish.audio
            headers["Content-Type"] = "application/msgpack"
            ref_item = {"audio": raw_audio_bytes}
            if ref_transcript:
                ref_item["text"] = ref_transcript[:500]

            payload = {
                "text": text[:1500],
                "format": "opus",
                "references": [ref_item],
                "temperature": 0.65,
                "top_p": 0.8,
                "latency": "balanced",
                "normalize": True,
                "chunk_length": 200,
            }
            if reference_id:
                payload["reference_id"] = reference_id

            packed_body = msgpack.packb(payload, use_bin_type=True)
            response = requests.post(
                FISH_AUDIO_TTS_URL,
                headers=headers,
                data=packed_body,
                timeout=timeout,
            )
        else:
            # Обычный синтез через JSON (с reference_id или дефолтным голосом Fish Audio)
            headers["Content-Type"] = "application/json"
            payload = {
                "text": text[:1500],
                "format": "opus",
            }
            if reference_id:
                payload["reference_id"] = reference_id

            response = requests.post(
                FISH_AUDIO_TTS_URL,
                headers=headers,
                json=payload,
                timeout=timeout,
            )

        if response.status_code == 200 and response.content:
            data = response.content
            logging.info("Fish Audio TTS returned %d bytes", len(data))
            if data.startswith(b"OggS"):
                return data
            converted = _convert_audio_to_ogg(data, timeout=timeout)
            return converted or data

        logging.error("Fish Audio TTS failed: HTTP %s %s", response.status_code, response.text[:300])
        return None
    except Exception:
        logging.exception("Fish Audio TTS request failed")
        return None


def _openrouter_tts(text: str, ref_b64: str = "", ref_mime: str = "audio/ogg",
                    ref_transcript: str | None = None, timeout: int = 60) -> bytes | None:
    """Fallback синтез речи через OpenRouter."""
    if not OPENROUTER_API_KEY:
        logging.warning("OpenRouter TTS skipped: OPENROUTER_API_KEY is not configured")
        return None

    input_references = []
    if ref_b64:
        input_references.append({
            "type": "input_audio",
            "input_audio": {"data": f"data:{ref_mime};base64,{ref_b64}"}
        })
    if ref_transcript:
        input_references.append({"type": "text", "text": ref_transcript[:500]})

    try:
        _throttle_tts()
        payload = {
            "model": OPENROUTER_VOICE_MODEL,
            "input": text[:1500],
            "response_format": "mp3",
            "temperature": 0.65,
            "top_p": 0.8,
            "chunk_length": 250,
            "normalize": True,
            "latency": "balanced",
        }
        if input_references:
            payload["input_references"] = input_references

        response = requests.post(
            OPENROUTER_TTS_URL,
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=timeout,
        )
        if response.status_code != 200 or not response.content:
            logging.error("OpenRouter TTS failed: HTTP %s %s", response.status_code, response.text[:300])
            return None

        mp3 = response.content
        logging.info("OpenRouter TTS returned %d MP3 bytes", len(mp3))
        converted = _convert_audio_to_ogg(mp3, timeout=timeout)
        return converted
    except Exception:
        logging.exception("OpenRouter TTS request failed")
        return None


def synthesize_speech(text: str, ref_b64: str = "", ref_mime: str = "audio/ogg",
                      ref_transcript: str | None = None, reference_id: str | None = None,
                      timeout: int = 60) -> bytes | None:
    """
    Озвучивает текст голосом.
    Приоритет:
    1. Прямой вызов Fish Audio API (https://api.fish.audio/v1/tts) с поддержкой образца голоса и fallback.
    2. Fallback на OpenRouter TTS при наличии настроенного OPENROUTER_API_KEY.
    """
    text = (text or "").strip()
    if not text:
        logging.error("TTS unavailable: empty text")
        return None

    # 1. Пробуем прямой вызов Fish Audio
    if FISH_AUDIO_API_KEY:
        audio = _fish_audio_tts(
            text=text,
            ref_b64=ref_b64,
            ref_mime=ref_mime,
            ref_transcript=ref_transcript,
            reference_id=reference_id,
            timeout=timeout,
        )
        if audio:
            return audio
        logging.warning("Direct Fish Audio TTS did not produce audio, attempting fallback if available")

    # 2. Пробуем OpenRouter как резервный вариант
    if OPENROUTER_API_KEY:
        audio = _openrouter_tts(
            text=text,
            ref_b64=ref_b64,
            ref_mime=ref_mime,
            ref_transcript=ref_transcript,
            timeout=timeout,
        )
        if audio:
            return audio

    if not FISH_AUDIO_API_KEY and not OPENROUTER_API_KEY:
        logging.error("TTS unavailable: neither FISH_AUDIO_API_KEY nor OPENROUTER_API_KEY is configured")
    else:
        logging.error("TTS failed across all configured providers")

    return None
