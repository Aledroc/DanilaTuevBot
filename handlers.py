import html
import base64
import time
import random
import threading
from pathlib import Path
from telebot import types
import config

from config import (
    bot, ARCHETYPES, chat_states, chat_histories, chat_goals, custom_prompts,
    DEFAULT_GOAL, ai_debug, LAST_AI_TRACE,
    voice_refs, voice_enabled
)
from chat_manager import (
    reset_chat_state, get_story_phase, init_chat_state,
    generate_random_archetype
)
import inventory as inventory_store
from voice_client import transcribe_audio


_AUDIO_EXTS = (".ogg", ".oga", ".mp3", ".wav", ".m4a", ".opus", ".flac", ".aac")
_VOICES_DIR = Path(__file__).resolve().parent / "voices"
_VOICE_CACHE = {}


def _extract_audio_obj(src):
    if src.voice:
        return src.voice
    if src.audio:
        return src.audio
    if src.document:
        fname = (src.document.file_name or "").lower()
        mime = (src.document.mime_type or "").lower()
        if mime.startswith("audio") or fname.endswith(_AUDIO_EXTS):
            return src.document
    return None


def _guess_mime(audio_obj, is_voice: bool) -> str:
    mime = getattr(audio_obj, "mime_type", None)
    if mime:
        return mime
    fname = (getattr(audio_obj, "file_name", None) or "").lower()
    ext_mime = {
        ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg",
        ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
        ".flac": "audio/flac", ".aac": "audio/aac",
    }
    for ext, v in ext_mime.items():
        if fname.endswith(ext):
            return v
    return "audio/ogg" if is_voice else "audio/mpeg"


def _download_audio(src):
    audio_obj = _extract_audio_obj(src) if src else None
    if not audio_obj:
        return None, None, None
    info = bot.get_file(audio_obj.file_id)
    data = bot.download_file(info.file_path)
    mime = _guess_mime(audio_obj, is_voice=bool(getattr(src, "voice", None)))
    return audio_obj, data, mime


def _do_setvoice(message, src):
    """src — сообщение, где реально лежит аудио: либо то, на которое ответили
    командой /setvoice, либо само сообщение, если /setvoice был подписью к аудио."""
    cid = message.chat.id
    audio_obj = _extract_audio_obj(src) if src else None
    if not audio_obj:
        bot.reply_to(
            message,
            "🎙 Ответь командой /setvoice на голосовое/аудио-сообщение с образцом твоего "
            "голоса (5-30 секунд чистой речи, без музыки и шума), либо пришли такое сообщение "
            "с подписью /setvoice.",
        )
        return
    try:
        _, data, mime = _download_audio(src)
    except Exception:
        bot.reply_to(message, "Не смог скачать аудио. Попробуй ещё раз.")
        return
    if len(data) > 12 * 1024 * 1024:
        bot.reply_to(message, "Файл слишком большой — нужен образец покороче (до ~12 МБ).")
        return
    transcript = (src.caption or "").strip()
    if transcript.lower().startswith("/setvoice"):
        transcript = transcript[len("/setvoice"):].strip()
    if not transcript:
        transcript = transcribe_audio(
            data,
            getattr(audio_obj, "file_name", None) or ("voice.ogg" if src.voice else "audio"),
            mime,
        ) or ""
    voice_refs[cid] = {
        "audio_b64": base64.b64encode(data).decode("ascii"),
        "mime": mime,
        "transcript": transcript or None,
    }
    try:
        inventory_store.save_chat_voice(
            cid,
            preset="custom",
            custom_audio_b64=voice_refs[cid]["audio_b64"],
            custom_mime=mime,
            custom_transcript=transcript or "",
        )
    except Exception:
        pass
    bot.reply_to(
        message,
        "🎙 Голос запомнен. Расшифровка: " + (html.escape(transcript) if transcript else "не получена") +
        "\nВключить озвучку: /voice Danila (или /voice on).",
        parse_mode="HTML",
    )


def _do_transcribe(message, src):
    try:
        audio_obj, data, mime = _download_audio(src)
    except Exception:
        bot.reply_to(message, "Не смог скачать аудио. Попробуй ещё раз.")
        return
    if not audio_obj:
        bot.reply_to(message, "Ответь командой /transcribe на голосовое или аудиофайл.")
        return
    if len(data) > 12 * 1024 * 1024:
        bot.reply_to(message, "Файл слишком большой для расшифровки (максимум 12 МБ).")
        return
    transcript = transcribe_audio(
        data,
        getattr(audio_obj, "file_name", None) or ("voice.ogg" if getattr(src, "voice", None) else "audio"),
        mime,
    )
    if not transcript:
        bot.reply_to(message, "Не удалось распознать речь. Проверь NORDROUTER_API_KEY и баланс NordRouter или попробуй аудио чище.")
        return
    bot.reply_to(message, html.escape(transcript), parse_mode="HTML")


@bot.message_handler(commands=['setvoice'])
def setvoice_cmd(message):
    # Если /setvoice написан как подпись к самому аудио, реплая нет —
    # тогда источник аудио — само это сообщение.
    _do_setvoice(message, message.reply_to_message or message)


@bot.message_handler(commands=['transcribe'])
def transcribe_cmd(message):
    _do_transcribe(message, message.reply_to_message or message)


def try_setvoice_from_caption(message) -> bool:
    """Telegram-команды в pyTelegramBotAPI распознаются только в message.text,
    а НЕ в подписи (caption) к файлу. Поэтому если кто-то прикрепил голосовое/аудио
    и написал "/setvoice" в подписи в ОДНОМ сообщении — обычный @commands-хендлер
    выше это не увидит. Эту функцию нужно дергать из хендлеров медиа/текста в
    DanilaTuev_Bot.py ДО обычной ролевой обработки. Возвращает True, если это
    был как раз такой случай (и он уже обработан), иначе False — тогда сообщение
    нужно обрабатывать как обычно.
    """
    cap = (message.caption or "").strip().lower()
    if not (cap == "/setvoice" or cap.startswith("/setvoice ") or cap.startswith("/setvoice@")):
        return False
    _do_setvoice(message, message)
    return True


def try_transcribe_from_caption(message) -> bool:
    cap = (message.caption or "").strip().lower()
    if not (cap == "/transcribe" or cap.startswith("/transcribe ") or cap.startswith("/transcribe@")):
        return False
    _do_transcribe(message, message)
    return True


def _load_voice_transcript(audio_path: Path) -> str:
    """Prefer a sibling .txt transcript; fall back to NordRouter STT."""
    transcript_path = audio_path.with_suffix(".txt")
    if transcript_path.is_file():
        try:
            raw = transcript_path.read_bytes()
            for encoding in ("utf-8-sig", "cp1251"):
                try:
                    transcript = raw.decode(encoding).strip()
                    if transcript:
                        return transcript[:500], "txt"
                    break
                except UnicodeDecodeError:
                    continue
        except OSError:
            pass

    try:
        data = audio_path.read_bytes()
        mime = _guess_mime(type("AudioFile", (), {"file_name": audio_path.name})(), is_voice=False)
        transcript = transcribe_audio(data, audio_path.name, mime) or ""
        return transcript, "stt" if transcript else None
    except OSError:
        return "", None


def _find_voice_path(name: str):
    """Find a preset by name, with or without its audio extension.

    Match case-insensitively so a command such as ``/voice Valentin`` also
    works when the bot runs on a case-sensitive filesystem.
    """
    name = str(name or "").strip()
    if not name or "/" in name or "\\" in name or Path(name).name != name:
        return None

    requested = Path(name)
    suffix = requested.suffix.lower()
    if suffix and suffix not in _AUDIO_EXTS:
        return None
    stem = requested.stem if suffix else name
    if not stem:
        return None

    # Keep the historical precedence for a file beside the bot, then search
    # the voices/ directory. Resolve against actual directory entries instead
    # of relying on case-sensitive path lookup.
    roots = (Path(__file__).resolve().parent, _VOICES_DIR)
    ext_order = {ext: index for index, ext in enumerate(_AUDIO_EXTS)}
    for directory in roots:
        try:
            matches = [
                path for path in directory.iterdir()
                if path.is_file()
                and path.stem.casefold() == stem.casefold()
                and path.suffix.lower() in _AUDIO_EXTS
                and (not suffix or path.suffix.lower() == suffix)
            ]
        except OSError:
            continue
        if matches:
            matches.sort(key=lambda path: (
                path.stem != stem,
                ext_order[path.suffix.lower()],
                path.name.casefold(),
            ))
            return matches[0]
    return None


def _load_voice_file(filename):
    """Load/cache an audio reference from voices/, transcribing it only once."""
    path = _find_voice_path(filename)
    if path is None:
        return None
    cache_key = str(path.resolve()).casefold()
    if cache_key in _VOICE_CACHE:
        voice_ref = _VOICE_CACHE[cache_key]
        # Allow adding the sidecar after the audio was already cached/selected.
        if not voice_ref.get("transcript"):
            transcript_path = path.with_suffix(".txt")
            if transcript_path.is_file():
                transcript, source = _load_voice_transcript(path)
                if transcript:
                    voice_ref["transcript"] = transcript
                    voice_ref["transcript_source"] = source
        return voice_ref
    data = path.read_bytes()
    if not data or len(data) > 12 * 1024 * 1024:
        return None
    mime = _guess_mime(type("AudioFile", (), {"file_name": path.name})(), is_voice=False)
    transcript_path = path.with_suffix(".txt")
    transcript, transcript_source = _load_voice_transcript(path)
    voice_ref = {
        "audio_b64": base64.b64encode(data).decode("ascii"),
        "mime": mime,
        "transcript": transcript or None,
        "preset": path.stem,
        "transcript_source": transcript_source,
    }
    _VOICE_CACHE[cache_key] = voice_ref
    return voice_ref


@bot.message_handler(commands=['voice'])
def voice_toggle_cmd(message):
    cid = message.chat.id
    # Не полагаемся на внутренний helper ai_client: он здесь не импортируется,
    # из-за чего команда раньше падала с NameError до обработки on/off.
    parts = (message.text or "").split(maxsplit=1)
    arg = parts[1].strip() if len(parts) > 1 else ""
    action = arg.lower()
    if action in ("on", "вкл", "1", "вкл."):
        if not config.FISH_AUDIO_API_KEY and not config.OPENROUTER_API_KEY:
            bot.reply_to(message, "TTS не настроен: укажите FISH_AUDIO_API_KEY в окружении или config.py бота.")
            return
        if cid not in voice_refs:
            # Пытаемся восстановить из БД
            saved = None
            try:
                saved = inventory_store.load_chat_voice(cid)
            except Exception:
                pass
            if saved and saved.get("preset"):
                p_name = saved["preset"]
                if p_name == "custom" and saved.get("custom_audio_b64"):
                    voice_refs[cid] = {
                        "audio_b64": saved["custom_audio_b64"],
                        "mime": saved.get("custom_mime", "audio/ogg"),
                        "transcript": saved.get("custom_transcript") or None,
                    }
                else:
                    loaded = _load_voice_file(p_name)
                    if loaded:
                        voice_refs[cid] = loaded
            # Если пресет всё еще не выбран — по умолчанию берем Danila
            if cid not in voice_refs:
                default_ref = _load_voice_file("danila")
                if default_ref:
                    voice_refs[cid] = default_ref
                    try:
                        inventory_store.save_chat_voice(cid, preset="danila", enabled=True)
                    except Exception:
                        pass
        if cid not in voice_refs:
            bot.reply_to(
                message,
                "Сначала выбери пресет: /voice Danila — или пришли образец через /setvoice.",
            )
            return
        voice_enabled[cid] = True
        try:
            inventory_store.save_chat_voice(cid, enabled=True)
        except Exception:
            pass
        preset_name = voice_refs[cid].get("preset", "пользовательский")
        bot.reply_to(message, f"🔊 Озвучка ответов включена (голос «{html.escape(preset_name)}»).")
    elif action in ("off", "выкл", "0", "выкл."):
        voice_enabled[cid] = False
        try:
            inventory_store.save_chat_voice(cid, enabled=False)
        except Exception:
            pass
        bot.reply_to(message, "🔇 Озвучка ответов выключена.")
    elif arg:
        if not config.FISH_AUDIO_API_KEY and not config.OPENROUTER_API_KEY:
            bot.reply_to(message, "TTS не настроен: укажите FISH_AUDIO_API_KEY в окружении или config.py бота.")
            return
        filename = "danila" if action in ("danila", "данила") else arg
        try:
            voice_ref = _load_voice_file(filename)
        except OSError:
            voice_ref = None
        if not voice_ref:
            bot.reply_to(message, "Не найден или не подходит аудиофайл. Положи файл (до 12 МБ) рядом с ботом или в папку voices/ и укажи имя пресета без расширения, например: /voice Danila")
            return
        voice_refs[cid] = voice_ref
        voice_enabled[cid] = True
        try:
            inventory_store.save_chat_voice(cid, preset=voice_ref["preset"], enabled=True)
        except Exception:
            pass
        if voice_ref.get("transcript_source") == "txt":
            transcript_status = "расшифровка загружена из .txt"
        elif voice_ref.get("transcript"):
            transcript_status = "транскрипция получена"
        else:
            transcript_status = f"транскрипция не получена — добавь {html.escape(Path(filename).stem)}.txt рядом с аудио"
        bot.reply_to(message, f"🔊 Включён голосовой пресет «{html.escape(voice_ref['preset'])}» ({transcript_status}).")
    else:
        # Проверяем БД если нет в памяти
        if cid not in voice_refs:
            try:
                saved = inventory_store.load_chat_voice(cid)
                if saved and saved.get("preset"):
                    p_name = saved["preset"]
                    if p_name == "custom" and saved.get("custom_audio_b64"):
                        voice_refs[cid] = {
                            "audio_b64": saved["custom_audio_b64"],
                            "mime": saved.get("custom_mime", "audio/ogg"),
                            "transcript": saved.get("custom_transcript") or None,
                        }
                    else:
                        loaded = _load_voice_file(p_name)
                        if loaded:
                            voice_refs[cid] = loaded
                    if saved.get("enabled"):
                        voice_enabled[cid] = True
            except Exception:
                pass
        status = "включена" if voice_enabled.get(cid) else "выключена"
        ref_info = voice_refs[cid].get("preset", "пользовательский") if cid in voice_refs else "нет"
        bot.reply_to(
            message,
            f"🔊 Озвучка: {status}. Образец голоса: {ref_info}.\n"
            "Использование: <code>/voice Danila</code>, <code>/voice on</code> или <code>/voice off</code>",
            parse_mode="HTML",
        )


@bot.message_handler(commands=['reset'])
def reset_cmd(message):
    cid = message.chat.id
    custom_prompts.pop(cid, None)
    inventory_store.save_chat_style(cid, "")
    chat_histories.pop(cid, None)
    chat_states.pop(cid, None)
    chat_goals.pop(cid, None)

    bot.send_chat_action(cid, 'typing')

    try:
        random_desc = generate_random_archetype()
        reset_chat_state(cid, random_desc)
        new_name = chat_states[cid]['full_name']

        bot.send_message(
            cid,
            f"🔄 Сброс выполнен. Новый абсолютно случайный персонаж:\n"
            f"<b>{html.escape(new_name)}</b>\n"
            f"📋 {html.escape(random_desc)}",
            parse_mode='HTML',
        )
    except Exception as e:
        bot.send_message(cid, f"Ошибка при сбросе: {str(e)[:300]}")


@bot.message_handler(commands=['prompt', 'promt'])
def set_custom_p(message):
    args = message.text.split(maxsplit=1)
    cid = message.chat.id
    if len(args) < 2:
        bot.send_message(cid, "📝 Использование: /prompt <описание персонажа и пожелания к стилю>")
        return
    desc = args[1].strip()
    custom_prompts[cid] = desc
    reset_chat_state(cid, desc)
    # Style wishes ("заканчивай фразу историей из жизни") must stay a style
    # instruction instead of drowning in the character description.
    chat_states[cid]['style_prompt'] = desc
    inventory_store.save_chat_style(cid, desc)
    bot.send_message(
        cid,
        f"⚙️ Кастомная личность создана: <b>{chat_states[cid]['full_name']}</b>.\n"
        f"📋 Описание: {html.escape(desc)}",
        parse_mode='HTML',
    )


@bot.message_handler(commands=['keys'])
def keys_cmd(message):
    cid = message.chat.id
    try:
        lines = []
        for key, val in ARCHETYPES.items():
            name = val[0] if isinstance(val, (list, tuple)) else key.capitalize()
            lines.append(f"🔹 /set {html.escape(str(key))} — {html.escape(str(name))}")

        # Пользовательские архетипы от игроков
        custom_list = inventory_store.get_custom_archetypes()
        if custom_list:
            lines.append("\n🌟 <b>Пользовательские архетипы:</b>")
            for ca in custom_list:
                author_str = f" (автор: {html.escape(ca.get('created_by_name') or 'Игрок')})" if ca.get('created_by_name') else ""
                lines.append(f"🔸 /set {html.escape(ca['key'])} — {html.escape(ca['title'])}{author_str}")

        all_text = "🎭 Доступные архетипы:\n" + "\n".join(lines)
        if len(all_text) <= 4096:
            bot.send_message(cid, all_text, parse_mode='HTML')
        else:
            mid = len(lines) // 2
            bot.send_message(cid, "🎭 Доступные архетипы (1/2):\n" + "\n".join(lines[:mid]), parse_mode='HTML')
            bot.send_message(cid, "🎭 Доступные архетипы (2/2):\n" + "\n".join(lines[mid:]), parse_mode='HTML')
    except Exception as e:
        bot.send_message(cid, f"Ошибка /keys: {e}")


@bot.message_handler(commands=['set'])
def set_theme(message):
    args = message.text.split(maxsplit=1)
    cid = message.chat.id
    if len(args) < 2:
        bot.send_message(cid, "❌ Неизвестный архетип. Введи /keys чтобы посмотреть доступные.")
        return
    key = args[1].strip()

    # Сначала проверяем базовые системные архетипы
    if key.lower() in ARCHETYPES:
        key = key.lower()
        custom_prompts.pop(cid, None)
        _, desc = ARCHETYPES[key]
        reset_chat_state(cid, desc)
        if message.from_user:
            try:
                inventory_store.record_archetype_use(message.from_user.id, key)
            except Exception:
                pass
        bot.send_message(
            cid,
            f"🎭 Архетип принят. Теперь я <b>{chat_states[cid]['full_name']}</b>.",
            parse_mode='HTML',
        )
        return

    # Затем проверяем пользовательские кастомные архетипы
    custom_list = inventory_store.get_custom_archetypes()
    found_custom = next((ca for ca in custom_list if ca["key"] == key), None)
    if found_custom:
        custom_prompts.pop(cid, None)
        desc = found_custom["prompt"]
        reset_chat_state(cid, desc)
        if message.from_user:
            try:
                inventory_store.record_archetype_use(message.from_user.id, key)
            except Exception:
                pass
        author = f" от <i>{html.escape(found_custom.get('created_by_name') or 'Игрока')}</i>" if found_custom.get('created_by_name') else ""
        bot.send_message(
            cid,
            f"🎭 Принят пользовательский архетип <b>{html.escape(found_custom['title'])}</b>{author}!\n"
            f"Теперь я <b>{chat_states[cid]['full_name']}</b>.",
            parse_mode='HTML',
        )
        return

    bot.send_message(cid, "❌ Неизвестный архетип. Введи /keys чтобы посмотреть доступные.")


@bot.message_handler(commands=['addarchetype', 'newarchetype'])
def add_archetype_cmd(message):
    """
    Добавление своего архетипа:
    /addarchetype Название | Описание | Первое действие (*...*)
    или
    /addarchetype Название | Описание
    """
    cid = message.chat.id
    user = message.from_user
    if not user:
        bot.send_message(cid, "Не удалось определить автора команды.")
        return

    args = message.text.split(maxsplit=1)
    if len(args) < 2 or "|" not in args[1]:
        bot.send_message(
            cid,
            "📝 <b>Формат добавления архетипа:</b>\n"
            "<code>/addarchetype Название | Описание персонажа | Первое действие</code>\n\n"
            "<i>Пример:</i>\n"
            "<code>/addarchetype Сварщик дядя Гена | Опытный сварщик в прожжённой робе, философствует под шипение дуги | *поправляет сварочную маску и чиркает электродом*</code>",
            parse_mode='HTML',
        )
        return

    parts = [p.strip() for p in args[1].split("|")]
    title = parts[0]
    desc = parts[1] if len(parts) > 1 else ""
    action = parts[2] if len(parts) > 2 else ""

    if len(title) < 2 or len(title) > 80:
        bot.send_message(cid, "⚠️ Название должно быть длиной от 2 до 80 символов.")
        return
    if len(desc) < 5 or len(desc) > 3000:
        bot.send_message(cid, "⚠️ Описание должно быть длиной от 5 до 3000 символов.")
        return
    if len(action) > 500:
        bot.send_message(cid, "⚠️ Первое действие не должно превышать 500 символов.")
        return

    u_name = user.first_name or user.username or f"Игрок {user.id}"
    try:
        archetype = inventory_store.add_custom_archetype(
            user_id=user.id,
            user_name=u_name,
            title=title,
            desc=desc,
            action=action,
        )
        try:
            inventory_store.record_archetype_use(user.id, archetype["key"])
        except Exception:
            pass
        bot.send_message(
            cid,
            f"✅ <b>Пользовательский архетип успешно создан!</b>\n\n"
            f"🎭 <b>Название:</b> {html.escape(archetype['title'])}\n"
            f"🔑 <b>Ключ:</b> <code>{archetype['key']}</code>\n"
            f"👤 <b>Автор:</b> {html.escape(u_name)}\n"
            f"💬 <b>Описание:</b> {html.escape(archetype['desc'])}\n"
            + (f"🎬 <b>Действие:</b> <i>{html.escape(archetype['action'])}</i>\n" if archetype['action'] else "")
            + f"\n👉 Применить в чате: <code>/set {archetype['key']}</code>\n"
            f"🗑 Удалить: <code>/delarchetype {archetype['key']}</code>",
            parse_mode='HTML',
        )
    except Exception as e:
        bot.send_message(cid, f"❌ Ошибка добавления архетипа: {e}")


@bot.message_handler(commands=['myarchetypes'])
def my_archetypes_cmd(message):
    """Просмотр созданных пользователем архетипов."""
    cid = message.chat.id
    user = message.from_user
    if not user:
        bot.send_message(cid, "Не удалось определить пользователя.")
        return

    customs = inventory_store.get_custom_archetypes()
    my_list = [ca for ca in customs if ca.get("created_by_user_id") == user.id]

    if not my_list:
        bot.send_message(
            cid,
            "У тебя пока нет созданных архетипов.\n"
            "Создай свой командой <code>/addarchetype Название | Описание | Действие</code> или в Mini App!",
            parse_mode='HTML',
        )
        return

    lines = ["📋 <b>Твои созданные архетипы:</b>\n"]
    for idx, ca in enumerate(my_list, 1):
        lines.append(
            f"{idx}. <b>{html.escape(ca['title'])}</b>\n"
            f"   Ключ: <code>{ca['key']}</code>\n"
            f"   Выбрать: <code>/set {ca['key']}</code> | Удалить: <code>/delarchetype {ca['key']}</code>\n"
        )
    bot.send_message(cid, "\n".join(lines), parse_mode='HTML')


@bot.message_handler(commands=['delarchetype'])
def del_archetype_cmd(message):
    """Удаление своего кастомного архетипа по ключу."""
    cid = message.chat.id
    user = message.from_user
    if not user:
        bot.send_message(cid, "Не удалось определить пользователя.")
        return

    args = message.text.split(maxsplit=1)
    if len(args) < 2:
        bot.send_message(cid, "Использование: <code>/delarchetype &lt;ключ_архетипа&gt;</code>\nПосмотреть свои: <code>/myarchetypes</code>", parse_mode='HTML')
        return

    key = args[1].strip()
    if key.lower() in ARCHETYPES:
        bot.send_message(cid, "❌ Запрещено удалять стандартные системные архетипы.")
        return

    success = inventory_store.delete_custom_archetype(key, user_id=user.id)
    if success:
        bot.send_message(cid, f"🗑 Архетип <code>{html.escape(key)}</code> успешно удалён.", parse_mode='HTML')
    else:
        bot.send_message(
            cid,
            "❌ Не удалось удалить архетип. Убедитесь, что ключ указан верно и архетип был создан вами.",
        )


@bot.message_handler(commands=['goal'])
def set_goal(message):
    args = message.text.split(maxsplit=1)
    if len(args) < 2:
        bot.send_message(message.chat.id, "🎯 Использование: /goal <новая цель>")
        return
    cid = message.chat.id
    chat_goals[cid] = args[1].strip()
    if cid in chat_states:
        chat_states[cid]['story_turn'] = 0
    bot.send_message(cid, f"🎯 Новая цель: <b>{html.escape(chat_goals[cid])}</b>", parse_mode='HTML')


@bot.message_handler(commands=['who'])
def whoami_cmd(message):
    cid = message.chat.id
    if cid not in chat_states:
        return
    state = chat_states[cid]
    goal = chat_goals.get(cid, DEFAULT_GOAL)
    bot.send_message(
        cid,
        f"👤 <b>Моя личность:</b>\n"
        f"Имя: <b>{state['full_name']}</b>\n"
        f"Роль: {state['desc']}\n"
        f"🎯 Цель: {goal}\n"
        f"📍 Стадия: {get_story_phase(state['story_turn'])}",
        parse_mode='HTML',
    )


@bot.message_handler(commands=['err'])
def err_cmd(message):
    cid = message.chat.id
    info = ai_debug.get(cid) or LAST_AI_TRACE
    bot.send_message(
        cid,
        "🔍 <b>Последняя ошибка нейронки:</b>\n"
        f"<code>{html.escape(str(info)[:3500])}</code>",
        parse_mode='HTML',
    )


@bot.message_handler(commands=['inv'])
def inventory_cmd(message):
    user = message.from_user
    if user is None:
        bot.reply_to(message, "Не смог определить владельца инвентаря.")
        return
    inventory_store.remember_member(
        message.chat.id, user.id, user.first_name, getattr(user, 'username', None),
        chat_title=getattr(message.chat, 'title', None),
        chat_username=getattr(message.chat, 'username', None),
        is_private=message.chat.type == 'private',
    )
    args = (message.text or "").split(maxsplit=1)
    if len(args) > 1:
        target = inventory_store.resolve_member(message.chat.id, args[1].strip())
        if not target:
            bot.reply_to(message, "Не нашёл участника по этому имени. Он должен написать боту в этом чате хотя бы один раз.")
            return
        items = inventory_store.get_items_anywhere(target[0])
        title = f"🎒 Инвентарь {html.escape(target[1])}:"
        if not items:
            bot.reply_to(message, title + " пуст.", parse_mode='HTML')
            return
        lines = [
            f"• {html.escape(entry['name'])}" + (f" ×{entry['quantity']}" if entry['quantity'] > 1 else "")
            for entry in items
        ]
        bot.reply_to(message, title + "\n" + "\n".join(lines), parse_mode='HTML')
        return
    items = inventory_store.get_items_anywhere(user.id)
    if not items:
        bot.reply_to(
            message,
            "🎒 Инвентарь пуст. Попроси персонажа найти что-нибудь в ходе сюжета.\n"
            "Все вещи — в Mini App: /app\n"
            "Использовать предмет: <code>/use предмет действие</code>",
            parse_mode='HTML',
        )
        return

    lines = [
        f"• {html.escape(item['name'])}"
        + (f" ×{item['quantity']}" if item['quantity'] > 1 else "")
        for item in items
    ]
    bot.reply_to(
        message,
        "🎒 <b>Твой инвентарь:</b>\n" + "\n".join(lines)
        + f"\n\nВсего предметов: {sum(item['quantity'] for item in items)}. Профиль и вещи: /app"
        + "\nИспользовать: <code>/use предмет действие</code>",
        parse_mode='HTML',
    )


@bot.message_handler(commands=['giveitem', 'additem'])
def give_item_cmd(message):
    user = message.from_user
    if user is None:
        bot.reply_to(message, "Не смог определить отправителя предмета.")
        return
    inventory_store.remember_member(
        message.chat.id, user.id, user.first_name, getattr(user, 'username', None),
        chat_title=getattr(message.chat, 'title', None),
        chat_username=getattr(message.chat, 'username', None),
        is_private=message.chat.type == 'private',
    )
    args = (message.text or "").split(maxsplit=2)
    if len(args) < 2:
        bot.reply_to(message, "Формат: <code>/giveitem имя_игрока | предмет</code>", parse_mode='HTML')
        return
    recipient_ref, separator, item_name = args[1].partition('|')
    if not separator and len(args) == 3:
        recipient_ref, item_name = args[1], args[2]
        separator = " "
    if not separator:
        bot.reply_to(message, "Формат: <code>/giveitem имя_игрока | предмет</code>", parse_mode='HTML')
        return
    recipient = inventory_store.resolve_member(message.chat.id, recipient_ref.strip())
    if not recipient:
        bot.reply_to(message, "Не нашёл участника. Он должен написать боту в этом чате хотя бы один раз.")
        return
    if recipient[0] == user.id:
        bot.reply_to(message, "Нельзя передать предмет самому себе.")
        return
    result = inventory_store.give_item(message.chat.id, user.id, recipient[0], item_name.strip())
    if not result:
        bot.reply_to(message, "Предмет не передан: проверь свой инвентарь и свободное место у получателя.")
        return
    bot.reply_to(message, f"🎒 Предмет «{html.escape(result)}» передан {html.escape(recipient[1])}.", parse_mode='HTML')


@bot.message_handler(commands=['use'])
def use_item_cmd(message):
    user = message.from_user
    if user is None:
        bot.reply_to(message, "Не смог определить владельца инвентаря.")
        return
    inventory_store.remember_member(
        message.chat.id, user.id, user.first_name, getattr(user, 'username', None),
        chat_title=getattr(message.chat, 'title', None),
        chat_username=getattr(message.chat, 'username', None),
        is_private=message.chat.type == 'private',
    )

    args = (message.text or "").split(maxsplit=1)
    if len(args) < 2:
        bot.reply_to(message, "Использование: <code>/use предмет действие</code>", parse_mode='HTML')
        return

    rest = args[1].strip()
    item = None
    action = ""

    def match_item(reference):
        """Match the used item anywhere: the player's bag is one bag."""
        reference = reference.strip()
        folded = reference.casefold()
        if not folded:
            return None, ""
        candidates = sorted(
            inventory_store.get_items_anywhere(user.id),
            key=lambda entry: len(entry["name"]),
            reverse=True,
        )
        for candidate in candidates:
            prefix = candidate["name"].casefold()
            if folded == prefix:
                return candidate, ""
            if folded.startswith(prefix + " "):
                # Формат без разделителя: /use медный ключ открой дверь.
                return candidate, reference[len(candidate["name"]):].strip()
        return None, ""

    if "|" in rest:
        item_arg, _, given_action = rest.partition('|')
        item, _ = match_item(item_arg)
        action = given_action.strip()
    else:
        item, action = match_item(rest)

    # The Mini App can be opened from the bot's private chat while the item and
    # the scene live in the friends' group. Use the last group chat then.
    cid = message.chat.id
    if item and not inventory_store.find_item(cid, user.id, item["name"]):
        if message.chat.type == 'private':
            found_chat = inventory_store.find_item_chat(user.id, item["name"])
            if found_chat is not None:
                cid = found_chat
    if not item:
        bot.reply_to(message, "Такого предмета у тебя нет. Посмотреть вещи: /inv")
        return

    user_name = user.first_name or "Игрок"
    action = action.strip()
    user_action = action or "использовать его подходящим образом в этой ситуации"

    # Delayed imports avoid a circular import: the bot entry point imports handlers.
    from chat_manager import _generate_and_send, _prepare_turn, get_system_prompt

    init_chat_state(cid)
    state, goal = _prepare_turn(cid)
    system_prompt = get_system_prompt(state, goal, get_story_phase(state['story_turn']), user_name)
    chat_histories.setdefault(cid, []).append({
        "role": "user",
        "content": f"[{user_name} использует предмет «{item['name']}»]: {user_action}",
    })
    if len(chat_histories[cid]) > config.HISTORY_LIMIT:
        chat_histories[cid].pop(0)

    bot.send_chat_action(cid, 'typing')
    if not _generate_and_send(
        cid, system_prompt, chat_histories[cid],
        reply_to=message if cid == message.chat.id else None, state=state,
        inventory_user_id=user.id, inventory_user_name=user_name,
        inventory_used_item=item['name'],
    ):
        error_text = "⚙️ Не получилось обработать действие. Предмет остался у тебя."
        if cid == message.chat.id:
            bot.reply_to(message, error_text)
        else:
            bot.send_message(cid, error_text)


@bot.message_handler(commands=['hall', 'fame', 'top'])
def hall_of_fame_cmd(message):
    cid = message.chat.id
    entries = inventory_store.get_hall_of_fame(cid)
    if not entries:
        bot.send_message(
            cid,
            "🏛️ <b>Зал славы чата</b> пока пуст.\nОбщайтесь, собирайте предметы и сражайтесь, чтобы попасть в летописи!",
            parse_mode='HTML',
        )
        return

    medals = ["🥇", "🥈", "🥉"]
    lines = ["🏛️ <b>Зал славы чата:</b>\n"]
    for i, entry in enumerate(entries[:10], start=1):
        medal = medals[i - 1] if i <= 3 else f"<b>{i}.</b>"
        name = html.escape(entry["display_name"])
        title = f" «<i>{html.escape(entry['title'])}</i>»" if entry.get("title") else ""
        wins_str = f" | 🏆 Побед: {entry.get('game_wins', 0)}" if entry.get("game_wins") else ""
        lines.append(
            f"{medal} <b>{name}</b>{title}\n"
            f"   💬 Сообщений: {entry['messages_count']} | 🎒 Предметов: {entry['items_collected']} | ⚔️ Добиваний: {entry['lethal_strikes']}{wins_str}"
        )

    bot.send_message(cid, "\n".join(lines), parse_mode='HTML')


@bot.message_handler(commands=['granttitle', 'settitle'])
def grant_title_cmd(message):
    """Назначить звание участнику: /granttitle @username Название звания или ответом на сообщение: /granttitle Название звания"""
    cid = message.chat.id
    sender = message.from_user
    granted_by = sender.first_name if sender else "Персонаж"

    target_id = None
    target_name = ""
    title_text = ""

    if message.reply_to_message and message.reply_to_message.from_user:
        target_user = message.reply_to_message.from_user
        target_id = target_user.id
        target_name = target_user.first_name
        parts = message.text.split(maxsplit=1)
        if len(parts) >= 2:
            title_text = parts[1].strip()
    else:
        parts = message.text.split(maxsplit=2)
        if len(parts) >= 3:
            target_ref = parts[1].strip()
            title_text = parts[2].strip()
            resolved = inventory_store.resolve_member(cid, target_ref)
            if resolved:
                target_id, target_name = resolved

    if not target_id or not title_text:
        bot.reply_to(
            message,
            "Использование: ответьте на сообщение участника командой <code>/granttitle Звание</code>\n"
            "или укажите ник: <code>/granttitle @username Звание</code>",
            parse_mode='HTML',
        )
        return

    inventory_store.grant_user_title(cid, target_id, title_text, granted_by)
    bot.send_message(
        cid,
        f"🎖️ Участнику <b>{html.escape(target_name)}</b> присвоено почетное звание: "
        f"«<b>{html.escape(title_text)}</b>»!",
        parse_mode='HTML',
    )


@bot.message_handler(commands=['coins', 'balance', 'daily'])
def economy_coins_cmd(message):
    """Показывает баланс монет и забирает ежедневную награду (daily streak)."""
    user = message.from_user
    if not user:
        return
    cid = message.chat.id
    # Забираем или проверяем ежедневную награду
    daily_res = inventory_store.claim_daily_streak(user.id)
    coins = inventory_store.get_user_coins(user.id)
    perks = inventory_store.get_user_perks(user.id, chat_id=cid)
    
    vip_str = ""
    if perks.get("vip"):
        days_left = perks.get("vip_days_left", 7)
        vip_str = f" 👑 [VIP еще {days_left} дн.]"
    text = (
        f"💰 <b>Кошелек игрока {html.escape(user.first_name)}</b>{vip_str}:\n"
        f"🪙 Баланс: <b>{coins}</b> монет\n"
        f"🔥 Ежедневный стрик: <b>{daily_res.get('streak', 1)}</b> дн.\n\n"
    )
    if daily_res.get("claimed"):
        text += f"🎁 <i>{html.escape(daily_res.get('message', ''))}</i>\n"
    else:
        text += f"ℹ️ <i>{html.escape(daily_res.get('message', ''))}</i>\n"

    if perks.get("titles"):
        text += f"\n🎖️ Ваши титулы: {', '.join(html.escape(t) for t in perks['titles'])}\n"
    text += "\n🛒 Напишите /shop чтобы посмотреть товары Магазина или /cup чтобы узнать турнирный кубок!"
    bot.reply_to(message, text, parse_mode='HTML')


@bot.message_handler(commands=['shop'])
def shop_catalog_cmd(message):
    """Каталог товаров Магазина и покупка."""
    items = inventory_store.get_shop_items()
    user = message.from_user
    coins = inventory_store.get_user_coins(user.id) if user else 0
    perks = inventory_store.get_user_perks(user.id, chat_id=message.chat.id) if user else {}
    vip_status_line = ""
    if perks.get("vip"):
        days_left = perks.get("vip_days_left", 7)
        vip_status_line = f"👑 Ваш VIP активен еще <b>{days_left}</b> дн.\n"

    lines = [f"🛒 <b>Магазин чата</b> (Ваш баланс: <b>{coins}</b> 🪙)\n{vip_status_line}"]
    for it in items:
        lines.append(
            f"{it['icon']} <b>{html.escape(it['name'])}</b> — <code>{it['price']}</code> 🪙\n"
            f"   <i>{html.escape(it['description'])}</i>\n"
            f"   👉 Команда: <code>/buy {it['item_id']}</code>\n"
        )
    lines.append("💡 Для покупки титула: <code>/buy custom_title Ваш Титул</code>")
    lines.append("💡 Для смены настроения: <code>/buy mood_override Вайб</code>")
    lines.append("💡 Для подкола: ответьте <code>/buy custom_roast</code> на сообщение друга (или укажите ник)")
    lines.append("💡 Для комплимента: ответьте <code>/buy compliment_bomb</code> на сообщение друга")
    lines.append("💡 Для фейкового бана: ответьте <code>/buy fake_ban Причина</code> на сообщение друга")
    lines.append("💡 Для гачи-выхлопа: <code>/buy golden_fart</code> | Дискотека: <code>/buy dungeon_party</code> | Тишина: <code>/buy silent_muter</code>")
    bot.reply_to(message, "\n".join(lines), parse_mode='HTML')


@bot.message_handler(commands=['buy'])
def shop_buy_cmd(message):
    """Покупка предмета в магазине: /buy item_id [параметры]."""
    user = message.from_user
    if not user:
        return
    cid = message.chat.id
    parts = message.text.split(maxsplit=2)
    if len(parts) < 2:
        bot.reply_to(message, "Использование: <code>/buy item_id</code>. Список товаров: /shop", parse_mode='HTML')
        return

    item_id = parts[1].strip()
    extra_arg = parts[2].strip() if len(parts) >= 3 else ""
    extra_data = {}

    if item_id == "custom_title":
        extra_data = {"title": extra_arg}
    elif item_id == "mood_override":
        extra_data = {"mood": extra_arg}
    elif item_id == "shout_announcement":
        extra_data = {"text": extra_arg}
    elif item_id in ("custom_roast", "compliment_bomb", "fake_ban", "slap_friend"):
        target_id = None
        target_name = ""
        if message.reply_to_message and message.reply_to_message.from_user:
            tu = message.reply_to_message.from_user
            target_id = tu.id
            target_name = tu.first_name
        elif extra_arg:
            target_token = extra_arg.split()[0]
            resolved = inventory_store.resolve_member(cid, target_token)
            if resolved:
                target_id, target_name = resolved
                # остаток аргумента после ника может быть причиной/наводкой
                rem_parts = extra_arg.split(maxsplit=1)
                extra_arg = rem_parts[1] if len(rem_parts) > 1 else ""
        if not target_id:
            bot.reply_to(
                message,
                f"⚠️ Для покупки «{item_id}» ответьте на сообщение друга или укажите его ник/имя!",
                parse_mode='HTML'
            )
            return
        if item_id == "custom_roast":
            extra_data = {"target_user_id": target_id, "target_name": target_name, "hint": extra_arg or "подкол от друга"}
        elif item_id == "compliment_bomb":
            extra_data = {"target_user_id": target_id, "target_name": target_name, "compliment": extra_arg}
        elif item_id == "fake_ban":
            extra_data = {"target_user_id": target_id, "target_name": target_name, "reason": extra_arg or "слишком мощная форма"}
        elif item_id == "slap_friend":
            extra_data = {"target_user_id": target_id, "target_name": target_name, "reason": extra_arg or "для профилактики"}

    res = inventory_store.buy_shop_item(user.id, item_id, chat_id=cid, extra_data=extra_data)
    if not res.get("success"):
        bot.reply_to(message, f"❌ {res.get('message', 'Ошибка покупки')}")
    else:
        bot.reply_to(
            message,
            f"✅ {res.get('message')}\n🪙 Оставшийся баланс: <b>{res.get('balance', 0)}</b> монет.",
            parse_mode='HTML'
        )
        # Если куплен golden_fart, сразу выдаем смачную реплику
        if item_id == "golden_fart":
            import random
            fart_phrases = [
                "💨 *БР-Р-Р-БА-А-АХ!* 💥 В раздевалке задрожали шкафчики! Кто-то зарядил протеиновый выхлоп на все 500 лошадей!",
                "💨 *Ф-Ф-Ф-ПУУУУК!* 🔊 Эхо разнеслось по всему подземелью! «Three hundred bucks за проветривание зала!»",
                "💨 *БА-БАХ!* ⚡ Стены качалки содрогнулись! Это был легендарный Золотой Залп Boss of the Gym!",
            ]
            bot.send_message(cid, random.choice(fart_phrases))
        elif item_id == "silent_muter":
            bot.send_message(cid, "🤐 <b>Режим Тишины (15 минут) активирован!</b> Бот замолк и ушел на восстановительный перерыв в качалке (ответит только если позвать лично).", parse_mode='HTML')
        elif item_id == "dungeon_party":
            bot.send_message(cid, "🎉 <b>PARTY HARD В КАЧАЛКЕ НА 30 МИНУТ!</b> 🕺 Врубаем бас, достаем ремиксы! Let's celebrate and party!", parse_mode='HTML')


@bot.message_handler(commands=['cup', 'tournament'])
def tournament_cup_cmd(message):
    """Информация о текущем еженедельном кубке чата и турнирный лидерборд."""
    cid = message.chat.id
    info = inventory_store.get_current_tournament(chat_id=cid)
    leaderboard = info.get("leaderboard", [])

    lines = [
        f"🏆 <b>Еженедельный Кубок Чата (Неделя №{info.get('week_number', 1)})</b>",
        f"📅 Период: <code>{info.get('start_date')}</code> — <code>{info.get('end_date')}</code>\n",
        "Турнирные очки начисляются за участие и рекорды в мини-играх!\n"
    ]
    if not leaderboard:
        lines.append("<i>В этой лиге пока нет сыгранных матчей. Сыграйте в мини-игры, чтобы открыть счёт!</i>")
    else:
        lines.append("<b>🏅 Топ игроков недели:</b>")
        for p in leaderboard:
            lines.append(f"{p['badge']} <b>{html.escape(p['user_name'])}</b>: <code>{p['points']}</code> очков")

    lines.append("\n🎁 Награды призерам недели: 🥇 500 🪙 + Титул Чемпиона | 🥈 300 🪙 | 🥉 150 🪙")
    bot.send_message(cid, "\n".join(lines), parse_mode='HTML')


@bot.message_handler(commands=['achievements', 'ach', 'badges'])
def achievements_cmd(message):
    """Просмотр личных достижений, прогресса и наград."""
    user = message.from_user
    if not user:
        return
    cid = message.chat.id

    try:
        inventory_store.check_user_achievements(user.id)
    except Exception:
        pass

    achievements = inventory_store.get_user_achievements(user.id)
    if not achievements:
        bot.reply_to(message, "🏅 В подземелье пока нет зарегистрированных достижений.")
        return

    unlocked = [a for a in achievements if a.get("unlocked")]
    claimed = [a for a in achievements if a.get("claimed")]
    total = len(achievements)
    unclaimed = [a for a in unlocked if not a.get("claimed")]

    text_parts = [
        f"🏅 <b>Зал Достижений бойца {html.escape(user.first_name)}</b>",
        f"Разблокировано: <b>{len(unlocked)} / {total}</b> | Получено наград: <b>{len(claimed)}</b>\n"
    ]

    if unlocked:
        text_parts.append("<b>🏆 Твои открытые ремни и трофеи:</b>")
        for a in unlocked[:8]:
            status = "✅" if a.get("claimed") else "🎁 <i>(можно забрать)</i>"
            text_parts.append(f"{a['icon']} <b>{html.escape(a['name'])}</b> (+{a['reward']} 🪙) — {status}")
        if len(unlocked) > 8:
            text_parts.append(f"<i>...и ещё {len(unlocked) - 8} наград в приложении!</i>")
        text_parts.append("")

    # Показываем ближайшие к разблокировке
    locked = [a for a in achievements if not a.get("unlocked")]
    if locked:
        text_parts.append("<b>🎯 Ближайшие цели:</b>")
        for a in locked[:4]:
            req = a.get("req_progress", 1)
            curr = min(a.get("current_progress", 0), req)
            text_parts.append(f"{a['icon']} <b>{html.escape(a['name'])}</b>: {curr}/{req} — <i>{html.escape(a['desc'])}</i>")
        text_parts.append("")

    if unclaimed:
        text_parts.append(
            f"🎉 <b>У тебя есть {len(unclaimed)} незабранных наград!</b>\n"
            f"Забери их прямо сейчас: <code>/claimach</code> или в /app (вкладка «Достижения»)"
        )
    else:
        text_parts.append("💡 Полный список достижений и фильтры доступны в <b>/app</b> во вкладке «🏅 Достижения».")

    bot.reply_to(message, "\n".join(text_parts), parse_mode='HTML')


@bot.message_handler(commands=['claimach', 'claimachievements', 'claim_ach'])
def claim_achievements_cmd(message):
    """Забрать все доступные награды за разблокированные достижения."""
    user = message.from_user
    if not user:
        return
    res = inventory_store.claim_all_achievement_rewards(user.id)
    if not res.get("success"):
        bot.reply_to(message, f"ℹ️ {res.get('message', 'Нет доступных наград.')}")
        return

    bot.reply_to(
        message,
        f"{res.get('message')}\n💰 Текущий баланс: <b>{res.get('balance', 0)}</b> 🪙",
        parse_mode='HTML'
    )


@bot.message_handler(commands=['records', 'game_top', 'scores'])
def game_records_cmd(message):
    """Показать рекорды по мини-играм чата."""
    parts = (message.text or "").split(maxsplit=1)
    game_arg = parts[1].strip().lower() if len(parts) > 1 else ""
    game_map = {
        "tower": "tower_stack", "башня": "tower_stack", "башенка": "tower_stack", "стек": "tower_stack",
        "timber": "timberjack", "лесоруб": "timberjack", "дерево": "timberjack",
        "knife": "knife_hit", "нож": "knife_hit", "тир": "knife_hit",
        "basketball": "swipe_basketball", "баскетбол": "swipe_basketball", "кольцо": "swipe_basketball",
        "bricks": "brick_breaker", "дробилка": "brick_breaker", "арканоид": "brick_breaker", "кирпичи": "brick_breaker",
        "colorswitch": "colorswitch", "флекс": "colorswitch", "цвет": "colorswitch",
        "airhockey": "air_hockey", "хоккей": "air_hockey",
        "whack": "whack_mole", "крот": "whack_mole",
        "2048": "game_2048",
    }
    target_game = game_map.get(game_arg, game_arg or None)
    scores = inventory_store.get_top_game_scores(game_name=target_game, chat_id=None, limit=10)

    if not scores:
        bot.reply_to(message, "🕹 В мини-играх пока нет зарегистрированных рекордов. Сыграйте через /app!")
        return

    medals = ["🥇", "🥈", "🥉"]
    lines = [f"🕹 <b>Таблица рекордов в мини-играх{' (' + target_game + ')' if target_game else ''}:</b>\n"]
    for i, s in enumerate(scores, start=1):
        medal = medals[i - 1] if i <= 3 else f"<b>{i}.</b>"
        uname = html.escape(s.get("user_name") or f"Игрок {s.get('user_id')}")
        gname = html.escape(s.get("game_name") or "")
        lines.append(f"{medal} <b>{uname}</b> — <code>{s.get('score')}</code> очков ({gname})")

    lines.append("\n💡 Полные таблицы и личные рекорды смотри в /app во вкладке «🎮 Игры»!")
    bot.reply_to(message, "\n".join(lines), parse_mode='HTML')



