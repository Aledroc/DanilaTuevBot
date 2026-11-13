import base64
import logging
import subprocess
import tempfile
import time
from pathlib import Path

import requests

from config import OPENROUTER_API_KEY, VOICE_ID, NORDROUTER_API_KEY, STT_API_URL, STT_MODEL

OPENROUTER_TTS_URL = "https://openrouter.ai/api/v1/audio/speech"
VOICE_MODEL = "fish-audio/s2.1-pro-free:free"
_last_tts_call = 0.0
_TTS_MIN_INTERVAL = 3.0


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


def synthesize_speech(text: str, ref_b64: str = "", ref_mime: str = "audio/ogg",
                      ref_transcript: str | None = None, timeout: int = 60) -> bytes | None:
    """Озвучивает текст голосом из образца через OpenRouter (voice cloning)."""
    text = (text or "").strip()
    if not text:
        logging.error("OpenRouter TTS unavailable: empty text")
        return None
    if not OPENROUTER_API_KEY or not ref_b64:
        logging.error("OpenRouter TTS unavailable: OPENROUTER_API_KEY=%s, ref_b64=%s",
                      bool(OPENROUTER_API_KEY), bool(ref_b64))
        return None

    # OpenRouter voice cloning: передаём образец голоса пользователя
    input_references = [
        {"type": "input_audio", "input_audio": {"data": f"data:{ref_mime};base64,{ref_b64}"}}
    ]
    if ref_transcript:
        input_references.append({"type": "text", "text": ref_transcript[:500]})

    try:
        _throttle_tts()
        response = requests.post(
            OPENROUTER_TTS_URL,
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}",
                     "Content-Type": "application/json"},
            json={
                "model": VOICE_MODEL,
                "input": text[:1500],
                "response_format": "mp3",
                "input_references": input_references,
                # настройки под «естественность»: меньше вариативности = меньше
                # «плывущего» акцента и ближе к тембру образца
                "temperature": 0.65,
                "top_p": 0.8,
                "chunk_length": 250,
                "normalize": True,
                "latency": "balanced",
            },
            timeout=timeout,
        )
        if response.status_code != 200 or not response.content:
            logging.error("OpenRouter TTS failed: HTTP %s %s", response.status_code, response.text[:300])
            return None

        mp3 = response.content
        logging.info("OpenRouter TTS returned %d MP3 bytes", len(mp3))
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp) / "input.mp3", Path(tmp) / "voice.ogg"
            source.write_bytes(mp3)
            subprocess.run(["ffmpeg", "-y", "-i", str(source), "-c:a", "libopus",
                            "-f", "ogg", str(target)], check=True, timeout=timeout,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            ogg = target.read_bytes()
        logging.info("Converted Telegram voice: %d OGG bytes", len(ogg))
        return ogg if ogg.startswith(b"OggS") else None
    except Exception:
        logging.exception("OpenRouter TTS or ffmpeg conversion failed")
        return None
