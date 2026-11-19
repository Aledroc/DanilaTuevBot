import base64
import logging
import re
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


_CHUNK_MAX_CHARS = 1000

# Precomputed Ogg CRC32 table
_OGG_CRC_LOOKUP = []
for _i in range(256):
    _r = _i << 24
    for _ in range(8):
        if _r & 0x80000000:
            _r = ((_r << 1) ^ 0x04C11DB7) & 0xFFFFFFFF
        else:
            _r = (_r << 1) & 0xFFFFFFFF
    _OGG_CRC_LOOKUP.append(_r)


def _ogg_crc(page_bytes: bytearray | bytes) -> int:
    crc = 0
    for b in page_bytes:
        crc = ((crc << 8) & 0xFFFFFFFF) ^ _OGG_CRC_LOOKUP[((crc >> 24) & 0xFF) ^ b]
    return crc


def _parse_ogg_pages(data: bytes) -> list[dict]:
    import struct
    pos = 0
    pages = []
    while pos < len(data):
        if data[pos:pos+4] != b"OggS":
            break
        header_type = data[pos+5]
        granule = struct.unpack("<q", data[pos+6:pos+14])[0]
        serial = struct.unpack("<I", data[pos+14:pos+18])[0]
        seq = struct.unpack("<I", data[pos+18:pos+22])[0]
        n_segs = data[pos+26]
        seg_table = data[pos+27:pos+27+n_segs]
        body_len = sum(seg_table)
        total_page_len = 27 + n_segs + body_len
        pages.append({
            "type": header_type,
            "granule": granule,
            "serial": serial,
            "seq": seq,
            "n_segs": n_segs,
            "seg_table": seg_table,
            "body": data[pos+27+n_segs:pos+total_page_len],
        })
        pos += total_page_len
    return pages


def _stitch_ogg_opus_streams(chunks: list[bytes]) -> bytes:
    """Бесшовно объединяет несколько OGG Opus аудиопотоков в один валидный аудиофайл."""
    import struct
    if not chunks:
        return b""
    valid = [c for c in chunks if c and c.startswith(b"OggS")]
    if not valid:
        return b"".join(chunks)
    if len(valid) == 1:
        return valid[0]

    all_stream_pages = [_parse_ogg_pages(c) for c in valid]
    all_stream_pages = [p for p in all_stream_pages if p]
    if not all_stream_pages:
        return b"".join(valid)

    serial = all_stream_pages[0][0]["serial"]
    out_pages = []
    current_seq = 0
    granule_offset = 0

    for stream_idx, pages in enumerate(all_stream_pages):
        last_page_idx = len(pages) - 1
        # В первом потоке берем OpusHead (0) и OpusTags (1).
        # Во всех последующих потоках пропускаем эти заголовки.
        start_p = 0 if stream_idx == 0 else 2

        for p_idx in range(start_p, len(pages)):
            p = pages[p_idx]
            is_last_overall = (stream_idx == len(all_stream_pages) - 1) and (p_idx == last_page_idx)

            if stream_idx == 0 and p_idx == 0:
                new_type = 2  # BOS (Beginning of Stream)
            elif is_last_overall:
                new_type = 4  # EOS (End of Stream)
            else:
                new_type = 0  # Regular stream page

            new_granule = p["granule"] + granule_offset if p["granule"] != -1 else -1

            header = bytearray()
            header.extend(b"OggS\x00")
            header.append(new_type)
            header.extend(struct.pack("<q", new_granule))
            header.extend(struct.pack("<I", serial))
            header.extend(struct.pack("<I", current_seq))
            header.extend(b"\x00\x00\x00\x00")  # Checksum field zeroed for calculation
            header.append(p["n_segs"])
            header.extend(p["seg_table"])

            page_data = bytearray(header + p["body"])
            calc_crc = _ogg_crc(page_data)
            page_data[22:26] = struct.pack("<I", calc_crc)

            out_pages.append(bytes(page_data))
            current_seq += 1

        granule_offset += pages[-1]["granule"]

    return b"".join(out_pages)


def split_text_into_chunks(text: str, max_chars: int = _CHUNK_MAX_CHARS) -> list[str]:
    """
    Разбивает длинный текст на логические предложения / части (не более max_chars),
    чтобы TTS не обрезал реплику, не тайм-аутился и выдавал стабильную интонацию.
    """
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    # Делим по границам предложений (. ! ? … \n)
    sentences = re.split(r'(?<=[.!?…\n])\s+', text)
    chunks = []
    current_chunk = ""

    for s in sentences:
        s = s.strip()
        if not s:
            continue
        if len(current_chunk) + len(s) + 1 <= max_chars:
            current_chunk = f"{current_chunk} {s}".strip() if current_chunk else s
        else:
            if current_chunk:
                chunks.append(current_chunk)
                current_chunk = ""
            if len(s) <= max_chars:
                current_chunk = s
            else:
                # Если отдельное предложение длиннее лимита, делим по словам
                words = s.split(" ")
                sub_chunk = ""
                for w in words:
                    if len(sub_chunk) + len(w) + 1 <= max_chars:
                        sub_chunk = f"{sub_chunk} {w}".strip() if sub_chunk else w
                    else:
                        if sub_chunk:
                            chunks.append(sub_chunk)
                        sub_chunk = w
                if sub_chunk:
                    current_chunk = sub_chunk

    if current_chunk:
        chunks.append(current_chunk)

    return chunks


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
                stream=True,
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
                stream=True,
                timeout=timeout,
            )

        chunks = []
        for chunk in response.iter_content(chunk_size=16384):
            if chunk:
                chunks.append(chunk)
        data = b"".join(chunks)

        if response.status_code == 200 and data:
            logging.info("Fish Audio TTS returned %d bytes", len(data))
            if data.startswith(b"OggS"):
                return data
            converted = _convert_audio_to_ogg(data, timeout=timeout)
            return converted or data

        logging.error("Fish Audio TTS failed: HTTP %s %s", response.status_code, data[:300].decode("utf-8", errors="replace"))
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


def _clean_speech_text(text: str) -> str:
    """Очищает текст от markdown, ссылок и тегов для стабильного синтеза TTS."""
    if not text:
        return ""
    # Убираем HTML
    text = re.sub(r"(?is)<.*?>", "", text)
    # Убираем блоки кода и инлайн код
    text = re.sub(r"```[\s\S]*?```", "", text)
    text = re.sub(r"`[^`]*`", "", text)
    # Убираем действия в звёздочках (*вздыхает*) и тильдах (~зевает~)
    text = re.sub(r"\*[^*]*\*", " ", text)
    text = re.sub(r"~[^~]*~", " ", text)
    # Убираем ссылки markdown [текст](url) -> текст
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    # Убираем прямые URL ссылки
    text = re.sub(r"https?://\S+", "", text)
    # Убираем символы заголовков, цитат и маркеров списков в начале строк
    text = re.sub(r"(?m)^[\s*#>\-]+", "", text)
    # Очищаем спецсимволы markdown разметки, оставляя обычную пунктуацию
    text = re.sub(r"[_*~`#><|]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def synthesize_speech(text: str, ref_b64: str = "", ref_mime: str = "audio/ogg",
                      ref_transcript: str | None = None, reference_id: str | None = None,
                      timeout: int = 60) -> bytes | None:
    """
    Озвучивает текст голосом.
    Если текст длинный, разбивает его на смысловые предложения/куски (до ~450 символов),
    озвучивает каждый кусок и склеивает аудиопоток.
    """
    text = _clean_speech_text(text)
    if not text:
        logging.error("TTS unavailable: empty text after cleaning")
        return None

    chunks = split_text_into_chunks(text, max_chars=_CHUNK_MAX_CHARS)
    if not chunks:
        return None

    audio_parts = []
    for idx, chunk in enumerate(chunks):
        audio_chunk = _synthesize_single_chunk(
            text=chunk,
            ref_b64=ref_b64,
            ref_mime=ref_mime,
            ref_transcript=ref_transcript,
            reference_id=reference_id,
            timeout=timeout,
        )
        if not audio_chunk:
            logging.warning("TTS failed on chunk %d/%d: '%s'", idx + 1, len(chunks), chunk[:40])
            # Если хотя бы часть уже синтезирована, не теряем всё, но логируем предупреждение
            continue
        audio_parts.append(audio_chunk)

    if not audio_parts:
        logging.error("TTS failed across all chunks and configured providers")
        return None

    if len(audio_parts) == 1:
        return audio_parts[0]

    return _stitch_ogg_opus_streams(audio_parts)


def _synthesize_single_chunk(text: str, ref_b64: str = "", ref_mime: str = "audio/ogg",
                             ref_transcript: str | None = None, reference_id: str | None = None,
                             timeout: int = 60) -> bytes | None:
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

    return None
