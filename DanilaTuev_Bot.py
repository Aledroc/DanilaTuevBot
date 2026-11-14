import re
import base64
import os
import time
import random
import html
import urllib.parse
import logging

from config import (
    bot, BOT_ID, BOT_USERNAME, HISTORY_LIMIT,
    chat_states, chat_histories, TELEGRAM_TOKEN
)
from chat_manager import (
    init_chat_state, _prepare_turn, get_system_prompt,
    get_story_phase, _generate_and_send, detect_lethal_action, DEATH_INSTRUCTION, is_called_by_name,
    record_message, start_midnight_reset_thread, start_proactive_loop_thread,
)
from ai_client import get_ai_response

import handlers
import inventory as inventory_store
import mini_app

# Метка сборки — печатается при старте, чтобы в логах Pterodactyl сразу было видно,
# какая версия файлов реально запущена (полезно, когда правки заливаются по одному файлу).
BOT_BUILD = "2026-11-13-proactive"

_IMAGE_MODEL_CHAIN = ("seedream5", "zimage", "nanobanana", "flux")


def _generate_image(prompt_en: str) -> bytes | None:
    encoded = urllib.parse.quote(prompt_en)
    seed = random.randint(1, 1_000_000)
    import requests
    for model in _IMAGE_MODEL_CHAIN:
        try:
            url = (
                f"https://image.pollinations.ai/prompt/{encoded}"
                f"?seed={seed}&nologo=true&model={model}&width=1024&height=1024&enhance=true"
            )
            res = requests.get(url, timeout=90)
            if res.status_code == 200 and len(res.content) > 5000:
                return res.content
        except Exception:
            continue
    return None


@bot.message_handler(commands=['img'])
def generate_image_cmd(message):
    args = message.text.split(maxsplit=1)
    cid = message.chat.id
    if len(args) < 2:
        bot.send_message(cid, "🎨 Напиши, что нарисовать. Пример: `/img киберпанк кот в очках`", parse_mode='Markdown')
        return
    user_prompt = args[1].strip()
    bot.send_chat_action(cid, 'upload_photo')
    bot.reply_to(message, "<i>*прищурился, достал холст и начал что-то кропотливо вырисовывать...*</i>", parse_mode='HTML')
    en_prompt = get_ai_response(
        "You are an expert image prompt engineer. Translate the user's Russian description "
        "into a highly detailed, comma-separated English prompt for a text-to-image AI. "
        "Output ONLY the English prompt, no other words.",
        [{"role": "user", "content": user_prompt}],
        max_tokens=150,
    ) or user_prompt
    image_data = _generate_image(en_prompt)
    if image_data:
        bot.send_photo(cid, image_data, caption=f"🎨 <b>Твоя идея:</b> {html.escape(user_prompt)}", parse_mode='HTML')
    else:
        bot.send_message(cid, "<i>*в сердцах порвал холст*</i> Тьфу, краска кончилась! Ошибка генерации.", parse_mode='HTML')



@bot.message_handler(commands=['start', 'help', 'app'])
def remember_command_member(message):
    user = message.from_user
    if user:
        inventory_store.remember_member(
            message.chat.id, user.id, user.first_name, getattr(user, 'username', None),
            chat_title=getattr(message.chat, 'title', None),
            chat_username=getattr(message.chat, 'username', None),
            is_private=message.chat.type == 'private',
        )
    command = message.text.split()[0].split('@')[0] if message.text else ''
    if command == '/help':
        bot.send_message(
            message.chat.id,
            "📖 <b>Команды бота</b>\n"
            "🎒 /app — открыть профиль и инвентарь\n"
            "🎒 /inv — посмотреть свои вещи\n"
            "🪄 <code>/use предмет | действие</code> — использовать предмет\n"
            "🎭 <code>/set ключ_архетипа</code> — выбрать архетип (ключ смотрите во вкладке «Архетипы» в /app)\n"
            "📝 <code>/prompt описание и стиль</code> — задать образ персонажа и пожелания к ответам\n"
            "🎯 <code>/goal цель</code> — задать цель; <code>/who</code> — посмотреть образ\n"
            "🔊 <code>/voice Valentin</code> — выбрать голос; <code>/voice on</code> / <code>/voice off</code> — озвучка\n"
            "🔄 <code>/reset</code> — начать нового персонажа\n"
            "🎨 <code>/img описание</code> — создать изображение\n\n"
            "Нажмите /app, чтобы открыть Mini App. Примеры команд можно нажимать "
            "во вкладке «Справка» — они откроются в чате как черновик.",
            parse_mode='HTML',
        )
        return
    if command in {'/start', '/app'}:
        from telebot.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
        # BotFather's Mini App URL is separate from this runtime setting.
        # Keep a working default so /app still replies when the host variable
        # has not been configured.
        app_url = os.getenv('MINIAPP_URL', 'https://danilatuev.wispbyte.app').strip()
        if app_url.startswith('https://'):
            # A group-launched /start deep link preserves that group's context
            # when the Mini App has to open in a private chat.
            start_arg = message.text.split(maxsplit=1)[1].strip() if message.text and len(message.text.split(maxsplit=1)) > 1 else ''
            group_match = re.fullmatch(r'app_(-\d{1,15})(?:_([A-Za-z0-9_]{1,32}))?', start_arg)
            if group_match:
                context = {'chat_id': group_match.group(1)}
                if group_match.group(2):
                    context['chat_username'] = group_match.group(2)
                if user:
                    # The user came here from the friends' group: remember it so
                    # the Mini App drafts /use back into that group.
                    inventory_store.remember_chat(
                        int(group_match.group(1)), user.id, "", group_match.group(2) or "",
                    )
                separator = '&' if '?' in app_url else '?'
                app_url = f'{app_url}{separator}{urllib.parse.urlencode(context)}'

            if message.chat.type in {'group', 'supergroup'}:
                # Telegram only allows Web App buttons in a private chat with the bot.
                # Route group users to the bot's private chat first.
                group_username = getattr(message.chat, 'username', None) or ''
                if not group_username:
                    group_username = os.getenv('MINIAPP_GROUP_USERNAME', '').strip().lstrip('@')
                bot_url = (
                    f'https://t.me/{BOT_USERNAME}?start=app_{message.chat.id}'
                    + (f'_{group_username}' if group_username else '')
                )
                keyboard = InlineKeyboardMarkup()
                keyboard.add(InlineKeyboardButton('🎒 Открыть в личном чате', url=bot_url))
                bot.send_message(
                    message.chat.id,
                    'Telegram не позволяет запускать Mini App прямо из группы. '
                    'Нажмите кнопку — бот откроется в личном чате, где можно запустить приложение.',
                    reply_markup=keyboard,
                )
                return

            # In private chat also offer a direct t.me deep link: it opens the same
            # Mini App even when the "app" menu button in BotFather points at
            # another (older) URL.
            deep_link = f'https://t.me/{BOT_USERNAME}?startapp=' + urllib.parse.quote(
                urllib.parse.urlencode({'chat_id': group_match.group(1)}) if group_match else 'inventory',
                safe='',
            )
            keyboard = InlineKeyboardMarkup()
            keyboard.add(InlineKeyboardButton('🎒 Открыть профиль игрока', web_app=WebAppInfo(url=app_url)))
            keyboard.add(InlineKeyboardButton('↗ Открыть в новой вкладке', url=deep_link))
            bot.send_message(
                message.chat.id,
                'Инвентарь и архетипы персонажа. Если кнопка не открывает приложение, '
                'используйте вторую — она ведёт на ту же страницу:',
                reply_markup=keyboard,
            )
        else:
            bot.send_message(message.chat.id, 'Mini App не настроен: укажите HTTPS-адрес в MINIAPP_URL.')


def _remember_context_users(message, cid: int) -> None:
    """Remember participants referenced by a reply or an inline mention.

    Telegram gives no way to list group members, so the bot only learns an id
    when the person writes, is replied to, or is mentioned with a link. The
    last two cases must be captured, otherwise a handover addressed to a
    nickname fails even though the nickname is decoded in
    ``_GROUP_MEMBER_ALIASES``.
    """
    chat = message.chat
    candidates = [
        getattr(getattr(message, "reply_to_message", None), "from_user", None)
    ]
    for entity in getattr(message, "entities", None) or []:
        candidates.append(getattr(entity, "user", None))
    for user in candidates:
        if not user or getattr(user, "is_bot", False):
            continue
        try:
            inventory_store.remember_member(
                cid, user.id,
                getattr(user, "first_name", "") or getattr(user, "username", ""),
                getattr(user, "username", None),
                chat_title=getattr(chat, "title", None),
                chat_username=getattr(chat, "username", None),
                is_private=chat.type == 'private',
            )
        except Exception:
            continue


@bot.message_handler(content_types=['photo', 'video', 'video_note', 'document'])
def handle_media(message):
    cid = message.chat.id
    caption = message.caption or ""

    if message.from_user:
        inventory_store.remember_member(
            cid, message.from_user.id, message.from_user.first_name,
            getattr(message.from_user, 'username', None),
            chat_title=getattr(message.chat, 'title', None),
            chat_username=getattr(message.chat, 'username', None),
            is_private=message.chat.type == 'private',
        )
    _remember_context_users(message, cid)

    if message.document:
        if handlers.try_setvoice_from_caption(message) or handlers.try_transcribe_from_caption(message):
            return

    init_chat_state(cid)
    record_message(cid)
    state = chat_states[cid]
    user_name = message.from_user.first_name
    media_type = (
        "Фото" if message.photo
        else "Видео" if message.video
        else "Видеокружок" if getattr(message, 'video_note', None)
        else "Документ" if message.document
        else "Медиафайл"
    )

    if message.chat.type in ('group', 'supergroup'):
        chat_histories[cid].append({"role": "user", "content": f"[{user_name} показывает {media_type}]: {caption}"})
    else:
        chat_histories[cid].append({"role": "user", "content": f"{user_name} показывает {media_type}. Подпись: {caption}"})

    if len(chat_histories[cid]) > HISTORY_LIMIT:
        chat_histories[cid].pop(0)

    is_private = message.chat.type == 'private'
    is_reply = message.reply_to_message and message.reply_to_message.from_user.id == BOT_ID
    addressed = bool(
        is_private or is_reply
        or f"@{BOT_USERNAME}".lower() in caption.lower()
        or is_called_by_name(caption, state)
    )
    if not addressed and message.reply_to_message and message.reply_to_message.from_user:
        return  # медиа в ответ другому человеку
    is_video = bool(message.video or getattr(message, 'video_note', None))
    if is_video:
        state['video_count'] = state.get('video_count', 0) + 1
        target_video = state.setdefault('target_video_count', random.randint(1, 3))
        if not (addressed or state['video_count'] >= target_video):
            return
        state['video_count'] = 0
        state['target_video_count'] = random.randint(1, 3)
    else:
        state['photo_count'] = state.get('photo_count', 0) + 1
        target_photo = state.setdefault('target_photo_count', random.randint(1, 3))
        if not (addressed or state['photo_count'] >= target_photo):
            return
        state['photo_count'] = 0
        state['target_photo_count'] = random.randint(1, 3)

    spontaneous = not addressed
    bot.send_chat_action(cid, 'typing')
    time.sleep(random.uniform(0.5, 1.5))

    logger = logging.getLogger("DanilaTuev_Bot")
    base64_image = ""
    file_id = None
    media_mime = "image/jpeg"

    # 1. Извлекаем file_id для фото, видео или видеосообщения (кружка)
    if message.photo:
        # Берем подходящее по размеру фото (последнее самое четкое, до 10MB)
        # Если последнее слишком тяжелое (>10MB), берем предыдущее
        chosen_photo = message.photo[-1]
        if getattr(chosen_photo, 'file_size', 0) and chosen_photo.file_size > 10 * 1024 * 1024 and len(message.photo) > 1:
            chosen_photo = message.photo[-2]
        file_id = chosen_photo.file_id
        media_mime = "image/jpeg"
    elif message.video and getattr(message.video, 'thumbnail', None):
        file_id = message.video.thumbnail.file_id
        media_mime = "image/jpeg"
    elif getattr(message, 'video_note', None) and getattr(message.video_note, 'thumbnail', None):
        file_id = message.video_note.thumbnail.file_id
        media_mime = "image/jpeg"
    elif message.document:
        doc_mime = getattr(message.document, 'mime_type', '') or ''
        if doc_mime.startswith('image/'):
            # Если передали фото документом (без сжатия)
            file_id = message.document.file_id
            media_mime = doc_mime
        elif getattr(message.document, 'thumbnail', None):
            file_id = message.document.thumbnail.file_id
            media_mime = "image/jpeg"

    # 2. Скачивание файла без внешних тяжелых библиотек (cv2)
    if file_id:
        try:
            info = bot.get_file(file_id)
            # Защита от слишком больших файлов для памяти контейнера (лимит 15 МБ)
            if getattr(info, 'file_size', 0) and info.file_size > 15 * 1024 * 1024:
                logger.warning(f"Media file {file_id} exceeds 15MB limit ({info.file_size} bytes)")
            else:
                data = bot.download_file(info.file_path)
                if data:
                    # Валидируем mime по сигнатуре первых байтов
                    if data.startswith(b'\x89PNG\r\n\x1a\n'):
                        media_mime = 'image/png'
                    elif data.startswith(b'RIFF') and data[8:12] == b'WEBP':
                        media_mime = 'image/webp'
                    elif data.startswith(b'\xff\xd8'):
                        media_mime = 'image/jpeg'
                    base64_image = base64.b64encode(data).decode('ascii')
        except Exception as e:
            logger.warning(f"Failed to download media file {file_id}: {type(e).__name__}: {e}")

    state, goal = _prepare_turn(cid)
    system_prompt = get_system_prompt(state, goal, get_story_phase(state['story_turn']), user_name)

    if base64_image:
        vision_content = [
            {"type": "text", "text": f"Тут фото от пользователя ({user_name}). Подпись: '{caption}'. Отреагируй от лица персонажа. Отвечай СТРОГО на русском!"},
            {"type": "image_url", "image_url": {"url": f"data:{media_mime};base64,{base64_image}"}},
        ]
        msgs = chat_histories[cid][:-1] + [{"role": "user", "content": vision_content}]
        is_vision = True
    else:
        msgs = chat_histories[cid]
        is_vision = False

    if not _generate_and_send(
        cid, system_prompt, msgs, is_vision=is_vision, reply_to=message, state=state,
        spontaneous=spontaneous,
        inventory_user_id=message.from_user.id if addressed and message.from_user else None,
        inventory_user_name=user_name,
    ):
        bot.reply_to(message, "<i>*хмурится*</i> Да ну, ерунда какая-то.", parse_mode='HTML')
        bot.send_chat_action(cid, 'typing')
        time.sleep(random.uniform(2.0, 3.5))
        if not _generate_and_send(
            cid, system_prompt, msgs, is_vision=is_vision, reply_to=message, state=state,
            spontaneous=spontaneous,
            inventory_user_id=message.from_user.id if addressed and message.from_user else None,
            inventory_user_name=user_name,
        ):
            bot.send_message(cid, "⚙️ Нейронка не ответила. Напиши /err — там HTTP-код и причина.")


@bot.message_handler(func=lambda m: True, content_types=['text', 'sticker', 'voice', 'audio'])
def handle_text(message):
    cid = message.chat.id
    if message.from_user:
        inventory_store.remember_member(
            cid, message.from_user.id, message.from_user.first_name,
            getattr(message.from_user, 'username', None),
            chat_title=getattr(message.chat, 'title', None),
            chat_username=getattr(message.chat, 'username', None),
            is_private=message.chat.type == 'private',
        )
    _remember_context_users(message, cid)

    if message.content_type in ('voice', 'audio'):
        if handlers.try_setvoice_from_caption(message) or handlers.try_transcribe_from_caption(message):
            return

    text = message.text or message.caption or "*какое-то действие*"
    if text.startswith('/'):
        return

    if message.from_user:
        try:
            inventory_store.increment_stat(cid, message.from_user.id, "messages_count")
            inventory_store.record_chat_message_activity(cid, message.from_user.id)
        except Exception:
            pass

    init_chat_state(cid)
    record_message(cid)
    state = chat_states[cid]
    user_name = message.from_user.first_name

    if message.chat.type in ('group', 'supergroup'):
        chat_histories[cid].append({"role": "user", "content": f"[{user_name}]: {text}"})
    else:
        chat_histories[cid].append({"role": "user", "content": f"{user_name}: {text}"})

    if len(chat_histories[cid]) > HISTORY_LIMIT:
        chat_histories[cid].pop(0)

    is_private = message.chat.type == 'private'
    is_reply = message.reply_to_message and message.reply_to_message.from_user.id == BOT_ID
    is_mention = f"@{BOT_USERNAME}".lower() in text.lower()
    called = is_called_by_name(text, state)
    requester_id = message.from_user.id if message.from_user else None
    take_intent = inventory_store.extract_take_intent(text)
    give_intent = inventory_store.extract_give_intent(cid, text, requester_id, user_name)
    container_loss_target = inventory_store.resolve_container_loss_target(
        cid, message.from_user.id if message.from_user else 0, text
    )
    # Explicit inventory actions should be handled even when addressed to another user.
    addressed = bool(
        is_private or is_reply or is_mention or called or take_intent
        or (give_intent and give_intent.get("explicit"))
        or container_loss_target
    )

    if not addressed:
        # Если активирован режим тишины (silent_muter), бот полностью игнорирует спонтанные реплики
        if inventory_store.is_chat_muted(cid):
            return

        # Сообщение адресовано другому человеку — бот не вмешивается
        to_other = bool(
            message.reply_to_message and message.reply_to_message.from_user
            and message.reply_to_message.from_user.id != BOT_ID
        ) or bool(re.search(r'@\w+', text))
        if to_other:
            return

        # Проходная реплика: считаем сообщения
        state['message_count'] = state.get('message_count', 0) + 1
        target_count = state.setdefault('target_count', random.randint(5, 10))
        # Содержательность: не встревать на пустые смайлики / 1 букву,
        # но на реплики от 10-15 символов или с вопросом/восклицанием встревать
        clean_text = text.strip()
        substantial = len(clean_text) >= 12 or '?' in clean_text or '!' in clean_text
        if not (substantial and state['message_count'] >= target_count):
            return

    spontaneous = not addressed
    state['message_count'] = 0
    state['target_count'] = random.randint(5, 10)
    state, goal = _prepare_turn(cid)
    system_prompt = get_system_prompt(state, goal, get_story_phase(state['story_turn']), user_name)

    # --- Механики вовлечённости (только адресованные, не в момент смерти) ---
    if addressed and message.from_user and not spontaneous:
        uid = message.from_user.id
        days_away = inventory_store.days_since_seen(cid, uid)
        if days_away >= 2:
            system_prompt += (
                f"\n\nВНИМАНИЕ: {user_name} не появлялся {days_away} дн. "
                "Поприветствуй возвращение одной фразой в духе персонажа — "
                "коротко и в характере, не объясняй, что делал без него."
            )
        if inventory_store.check_daily_reward(cid, uid):
            system_prompt += (
                f"\n\nЕЖЕДНЕВНАЯ НАГРАДА: {user_name} написал первым за сегодня. "
                "Вплети в ответ, что даришь ему один небольшой предмет, подходящий персонажу "
                "(бухгалтер-дракон — чек, рыцарь — блин, детектив — улику и т.д.). "
                "Добавь [[ITEM_ADD:название]] в конец. Название — одно слово или короткая фраза."
            )
        if state.get('story_turn', 0) == 5:
            system_prompt += (
                "\n\nКРЮК: в самом конце ответа намекни одной загадочной фразой "
                "на что-то интригующее — то, что произойдёт или что ты только что узнал. "
                "Не раскрывай полностью — пусть захочется вернуться."
            )

    # Игрок убил персонажа? Тогда смерть форсируется кодом, а не «на совесть модели».
    force_death = addressed and detect_lethal_action(text, state)
    if force_death:
        system_prompt += DEATH_INSTRUCTION
        if message.from_user:
            try:
                inventory_store.increment_stat(cid, message.from_user.id, "lethal_strikes")
            except Exception:
                pass

    bot.send_chat_action(cid, 'typing')
    time.sleep(random.uniform(0.8, 1.5))

    if not _generate_and_send(
        cid, system_prompt, chat_histories[cid], state=state, force_death=force_death,
        spontaneous=spontaneous,
        inventory_user_id=message.from_user.id if message.from_user else None,
        inventory_user_name=user_name,
        inventory_target_user_id=container_loss_target[0] if container_loss_target else None,
        inventory_target_user_name=container_loss_target[1] if container_loss_target else None,
    ):
        bot.send_message(
            cid,
            "<i>*бормочет себе под нос*</i> Тьфу, мысль потерял... О чём бишь мы?",
            parse_mode='HTML',
        )
        bot.send_chat_action(cid, 'typing')
        time.sleep(random.uniform(2.0, 3.5))
        if not _generate_and_send(
            cid, system_prompt, chat_histories[cid], state=state, force_death=force_death,
            spontaneous=spontaneous,
            inventory_user_id=message.from_user.id if message.from_user else None,
            inventory_user_name=user_name,
            inventory_target_user_id=container_loss_target[0] if container_loss_target else None,
            inventory_target_user_name=container_loss_target[1] if container_loss_target else None,
        ):
            bot.send_message(cid, "⚙️ Нейронка не ответила. Напиши /err — там HTTP-код и причина.")


if __name__ == '__main__':
    print(f"[BOOT] DanilaTuev_Bot build: {BOT_BUILD}")
    mini_app.BOT_TOKEN = TELEGRAM_TOKEN
    mini_app.BOT_USERNAME = BOT_USERNAME
    mini_app.start_background()
    start_midnight_reset_thread()
    # start_proactive_loop_thread()  # Отключено: бот больше не спамит авто-сообщениями в тишине чата
    while True:
        try:
            bot.infinity_polling(timeout=60, long_polling_timeout=60, logger_level=logging.CRITICAL)
        except Exception:
            time.sleep(3)
