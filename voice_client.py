import base64
import io
import logging
import re
import subprocess
import tempfile
import time
import wave
from pathlib import Path

import requests

try:
    from gradio_client import Client, handle_file
except ImportError:
    Client, handle_file = None, None

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
    HUGGINGFACE_TOKEN,
)

F5_TTS_SPACE = "hugging-apps/f5-tts-russian-emotional"
_f5_client = None
_f5_client_init_failed = False
OPENROUTER_TTS_URL = "https://openrouter.ai/api/v1/audio/speech"
OPENROUTER_VOICE_MODEL = "fish-audio/s2.1-pro-free:free"
_last_tts_call = 0.0
_TTS_MIN_INTERVAL = 0.5


def _get_f5_client():
    """Возвращает инициализированный синглтон gradio_client для f5-tts-russian-emotional."""
    global _f5_client, _f5_client_init_failed
    if Client is None:
        return None
    if _f5_client is not None:
        return _f5_client
    if _f5_client_init_failed:
        return None
    try:
        logging.info("Инициализация Gradio Client для F5-TTS (%s)...", F5_TTS_SPACE)
        hf_tok = HUGGINGFACE_TOKEN or None
        if hf_tok:
            _f5_client = Client(F5_TTS_SPACE, token=hf_tok)
        else:
            _f5_client = Client(F5_TTS_SPACE)
        return _f5_client
    except Exception as exc:
        logging.error("Не удалось подключиться к F5-TTS Hugging Face Space: %s", exc)
        _f5_client_init_failed = True
        return None


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


def _stitch_audio_streams(chunks: list[bytes]) -> bytes:
    """Объединяет несколько аудиопотоков (WAV или OGG Opus)."""
    if not chunks:
        return b""
    valid = [c for c in chunks if c]
    if not valid:
        return b""
    if len(valid) == 1:
        return valid[0]

    # Если это WAV файлы:
    if valid[0].startswith(b"RIFF"):
        try:
            out_io = io.BytesIO()
            with wave.open(io.BytesIO(valid[0]), "rb") as w_first:
                params = w_first.getparams()
                with wave.open(out_io, "wb") as w_out:
                    w_out.setparams(params)
                    w_out.writeframes(w_first.readframes(w_first.getnframes()))
                    for b in valid[1:]:
                        if b.startswith(b"RIFF"):
                            with wave.open(io.BytesIO(b), "rb") as w_next:
                                w_out.writeframes(w_next.readframes(w_next.getnframes()))
            return out_io.getvalue()
        except Exception:
            logging.exception("Failed to stitch WAV files, falling back to concatenation")
            return valid[0]

    # Если это OGG Opus:
    if valid[0].startswith(b"OggS"):
        return _stitch_ogg_opus_streams(valid)

    return b"".join(valid)


def _prepare_reference_for_f5(ref_b64: str = "", ref_mime: str = "audio/ogg",
                              ref_transcript: str | None = None) -> tuple[str | None, str, bool]:
    """
    Возвращает (ref_audio_path, ref_text, is_temp_file).
    Если передан ref_b64, декодирует во временный файл.
    Если не передан, использует локальный эталон voices/danila.ogg и voices/danila.txt.
    """
    local_danila_ogg = Path("voices/danila.ogg")
    local_danila_txt = Path("voices/danila.txt")

    if ref_b64:
        try:
            data = base64.b64decode(ref_b64)
            ext = ".ogg"
            if "wav" in (ref_mime or "").lower() or data.startswith(b"RIFF"):
                ext = ".wav"
            elif "mp3" in (ref_mime or "").lower() or data.startswith(b"ID3"):
                ext = ".mp3"
            tfile = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
            tfile.write(data)
            tfile.flush()
            tfile.close()

            transcript = (ref_transcript or "").strip()
            if not transcript and local_danila_txt.exists():
                transcript = local_danila_txt.read_text(encoding="utf-8").strip()
            return tfile.name, transcript, True
        except Exception as exc:
            logging.warning("Не удалось подготовить временный ref файл из base64: %s", exc)

    if local_danila_ogg.exists():
        transcript = ""
        if local_danila_txt.exists():
            try:
                transcript = local_danila_txt.read_text(encoding="utf-8").strip()
            except Exception:
                pass
        return str(local_danila_ogg.resolve()), transcript, False

    return None, "", False


def _f5_russian_tts(text: str, ref_b64: str = "", ref_mime: str = "audio/ogg",
                    ref_transcript: str | None = None, timeout: int = 90) -> bytes | None:
    """
    Синтезирует речь через hugging-apps/f5-tts-russian-emotional (Gradio Client).
    Возвращает байты сгенерированного аудио (.wav).
    """
    client = _get_f5_client()
    if client is None:
        logging.warning("F5-TTS client недоступен")
        return None

    ref_audio_path, ref_text, is_temp = _prepare_reference_for_f5(ref_b64, ref_mime, ref_transcript)
    if not ref_audio_path:
        logging.warning("F5-TTS: нет эталонного аудио (voices/danila.ogg не найден и ref_b64 пуст)")
        return None

    try:
        _throttle_tts()
        clean_text = _normalize_text_for_f5(text)
        if not clean_text:
            return None

        logging.info("F5-TTS синтез (%d симв.): '%s'", len(clean_text), clean_text[:60])
        # predict(ref_audio, ref_text, gen_text, speed=1.0, nfe_steps=32, api_name='/generate') -> (generated_speech_path, status)
        res = client.predict(
            handle_file(ref_audio_path),
            ref_text,
            clean_text,
            1.0,
            32,
            api_name="/generate"
        )
        if isinstance(res, (list, tuple)) and len(res) > 0:
            result_path = res[0]
            if result_path and Path(result_path).exists():
                wav_bytes = Path(result_path).read_bytes()
                logging.info("F5-TTS успешно синтезировал %d байт аудио", len(wav_bytes))
                return wav_bytes
            else:
                logging.error("F5-TTS вернул пустой путь к аудио: %s", res)
        else:
            logging.error("F5-TTS неожиданный ответ: %s", res)
        return None
    except Exception as exc:
        logging.exception("F5-TTS запрос завершился ошибкой: %s", exc)
        return None
    finally:
        if is_temp and ref_audio_path:
            try:
                Path(ref_audio_path).unlink(missing_ok=True)
            except Exception:
                pass


def _normalize_text_for_f5(text: str) -> str:
    """
    Нормализует русский текст перед отправкой в F5-TTS:
    - очищает markdown, теги, действия
    - нормализует пробелы, раскрывает частые сокращения
    - оставляет естественный русский текст без искусственных ударений
    """
    if not text:
        return ""
    text = _clean_speech_text(text)

    # Раскрываем частые сокращения для естественного чтения
    abbreviations = [
        (r"\bруб\b\.?", "рублей"),
        (r"\bкоп\b\.?", "копеек"),
        (r"\bтыс\b\.?", "тысяч"),
        (r"\bмлн\b\.?", "миллионов"),
        (r"\bмлрд\b\.?", "миллиардов"),
        (r"\bг\b\.?", "года"),
        (r"\bгг\b\.?", "годов"),
        (r"\bсм\b\.?", "сантиметров"),
        (r"\bкм\b\.?", "километров"),
        (r"\bкг\b\.?", "килограмм"),
        (r"\bул\b\.?", "улица"),
        (r"\bд\b\.?\s*(\d+)", r"дом \1"),
        (r"\bкв\b\.?\s*(\d+)", r"квартира \1"),
        (r"\bт\.?е\.?\b", "то есть"),
        (r"\bт\.?д\.?\b", "так далее"),
        (r"\bт\.?п\.?\b", "тому подобное"),
        (r"\bи\.?т\.?д\.?\b", "и так далее"),
        (r"\bи\.?т\.?п\.?\b", "и тому подобное"),
        (r"\bдр\.?\b", "другие"),
        (r"\bпр\.?\b", "прочее"),
    ]
    for pattern, repl in abbreviations:
        text = re.sub(pattern, repl, text, flags=re.IGNORECASE)

    # Убираем дублирование пробелов и лишние знаки
    text = re.sub(r"\s+", " ", text).strip()
    return text


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
                      timeout: int = 90) -> bytes | None:
    """
    Озвучивает текст голосом.
    Основной движок: бесплатный f5-tts-russian-emotional (Hugging Face Gradio).
    Резервные движки: Fish Audio и OpenRouter.
    Если текст длинный, разбивает его на смысловые предложения/куски,
    озвучивает каждый кусок и склеивает аудиопоток.
    """
    text = _normalize_text_for_f5(text)
    if not text:
        logging.error("TTS unavailable: empty text after cleaning")
        return None

    chunks = split_text_into_chunks(text, max_chars=400)
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
            continue
        audio_parts.append(audio_chunk)

    if not audio_parts:
        logging.error("TTS failed across all chunks and configured providers")
        return None

    if len(audio_parts) == 1:
        return audio_parts[0]

    return _stitch_audio_streams(audio_parts)


def _synthesize_single_chunk(text: str, ref_b64: str = "", ref_mime: str = "audio/ogg",
                             ref_transcript: str | None = None, reference_id: str | None = None,
                             timeout: int = 90) -> bytes | None:
    # 1. Основной бесплатный движок: F5-TTS Russian Emotional
    try:
        audio = _f5_russian_tts(
            text=text,
            ref_b64=ref_b64,
            ref_mime=ref_mime,
            ref_transcript=ref_transcript,
            timeout=timeout,
        )
        if audio:
            return audio
        logging.warning("F5-TTS Russian Emotional did not produce audio, attempting fallback")
    except Exception as f5_err:
        logging.warning("F5-TTS execution error: %s, attempting fallback", f5_err)

    # 2. Резервный вызов Fish Audio (если настроен ключ)
    if FISH_AUDIO_API_KEY:
        try:
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
            logging.warning("Fallback Fish Audio TTS did not produce audio")
        except Exception as fish_err:
            logging.warning("Fish Audio error: %s", fish_err)

    # 3. Резервный вызов OpenRouter (если настроен ключ)
    if OPENROUTER_API_KEY:
        try:
            audio = _openrouter_tts(
                text=text,
                ref_b64=ref_b64,
                ref_mime=ref_mime,
                ref_transcript=ref_transcript,
                timeout=timeout,
            )
            if audio:
                return audio
        except Exception as or_err:
            logging.warning("OpenRouter TTS error: %s", or_err)

    return None
