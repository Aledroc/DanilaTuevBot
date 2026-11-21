import re
import json
import base64
import os
import time
import random
import html
import urllib.parse
import urllib.request
import requests
import logging

import config
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
BOT_BUILD = "2026-11-18-daily-cycle-fix"

_HF_SPACES = (
    "black-forest-labs/FLUX.1-schnell",
)


def _track_incoming_message_activity(message):
    """Регистрирует активность пользователя по любому входящему сообщению (включая команды)
    и проверяет выполнение достижений.
    """
    if not message or not getattr(message, 'from_user', None):
        return
    user = message.from_user
    cid = message.chat.id
    try:
        inventory_store.remember_member(
            cid, user.id, user.first_name,
            getattr(user, 'username', None),
            chat_title=getattr(message.chat, 'title', None),
            chat_username=getattr(message.chat, 'username', None),
            is_private=message.chat.type == 'private',
        )
    except Exception:
        pass

    try:
        inventory_store.increment_stat(cid, user.id, "messages_count")
        inventory_store.record_chat_message_activity(cid, user.id)
    except Exception:
        pass


bot.set_update_listener(lambda messages: [_track_incoming_message_activity(m) for m in messages if m])


def _generate_image(prompt_en: str) -> bytes | None:
    """Генерирует изображение через авторизованный FLUX API без ватермарок."""
    import json
    import requests

    polli_key = getattr(config, 'POLLINATIONS_API_KEY', '') or os.getenv('POLLINATIONS_API_KEY', '')
    hf_token = getattr(config, 'HUGGINGFACE_TOKEN', '') or os.getenv('HUGGINGFACE_TOKEN', '')
    encoded = urllib.parse.quote(prompt_en)
    seed = random.randint(1, 1_000_000)

    # 1. Приоритетный путь: авторизованный Pollinations API (FLUX 1024x1024 без ватермарки, моментальный ответ)
    if polli_key:
        try:
            url = f"https://gen.pollinations.ai/image/{encoded}?model=flux&width=1024&height=1024&seed={seed}&nologo=true&key={polli_key}"
            res = requests.get(url, timeout=35)
            if res.status_code == 200 and len(res.content) > 5000:
                return res.content
        except Exception as e:
            logging.warning(f"[_generate_image] Auth Pollinations failed: {e}")

    # 2. Попытка через Hugging Face Space (FLUX.1-schnell)
    headers = {'Content-Type': 'application/json'}
    if hf_token:
        headers['Authorization'] = f'Bearer {hf_token}'

    try:
        payload = {
            'data': [
                prompt_en,
                seed,
                True,
                1024,
                1024,
                4,
            ]
        }
        res_post = requests.post(
            'https://black-forest-labs-flux-1-schnell.hf.space/gradio_api/call/infer',
            json=payload,
            headers=headers,
            timeout=25,
        )
        if res_post.status_code == 200:
            event_id = res_post.json().get('event_id')
            if event_id:
                res_stream = requests.get(
                    f'https://black-forest-labs-flux-1-schnell.hf.space/gradio_api/call/infer/{event_id}',
                    headers=headers,
                    stream=True,
                    timeout=45,
                )
                for line in res_stream.iter_lines():
                    if line:
                        decoded = line.decode('utf-8', errors='ignore')
                        if decoded.startswith('data:'):
                            data_block = json.loads(decoded[5:].strip())
                            if data_block and isinstance(data_block, list) and len(data_block) > 0:
                                item = data_block[0]
                                img_url = item.get('url') if isinstance(item, dict) else None
                                if img_url:
                                    img_res = requests.get(img_url, headers=headers, timeout=20)
                                    if img_res.status_code == 200 and len(img_res.content) > 5000:
                                        return img_res.content
                            break
    except Exception as e:
        logging.warning(f"[_generate_image] Space direct HTTP failed: {e}")

    # 3. Резервный фолбэк при недоступности (используем стабильный image.pollinations.ai)
    try:
        url = f"https://image.pollinations.ai/prompt/{encoded}?model=flux&nologo=true&width=1024&height=1024&seed={seed}"
        res = requests.get(url, timeout=35)
        if res.status_code == 200 and len(res.content) > 5000:
            return res.content
    except Exception as e:
        logging.warning(f"[_generate_image] Fallback failed: {e}")

    return None


def _swap_danila_face(target_img_bytes: bytes) -> bytes:
    """Заменяет лицо на сгенерированном арте на лицо Данилы.
    Использует официальный gradio_client Client API с inswapper_128 + GPEN-BFR-512 для идеального сходства черт лица без мыла и артефактов."""
    face_path = os.path.join(os.path.dirname(__file__), 'danila_face.jpg')
    if not os.path.exists(face_path):
        print(f"[SWAP] WARNING: danila_face.jpg not found at {face_path}!", flush=True)
        return target_img_bytes

    print(f"[SWAP] Starting Face Swap via gradio_client ({len(target_img_bytes)} bytes)...", flush=True)

    target_tmp = None
    try:
        from gradio_client import Client, handle_file
        import tempfile

        with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
            tmp.write(target_img_bytes)
            target_tmp = tmp.name

        token = getattr(config, 'HUGGINGFACE_TOKEN', None)
        client = Client(
            'V0pr0S/ComfyUI-Reactor-Fast-Face-Swap-CPU',
            token=token,
            verbose=False,
            httpx_kwargs={'timeout': 60.0}
        )

        res_path = client.predict(
            source_image=handle_file(face_path),
            target_image=handle_file(target_tmp),
            target_index=0,
            swap_model='inswapper_128.onnx',
            face_restore_model='GPEN-BFR-512.onnx',
            restore_strength=0.8,
            api_name='/generate_image'
        )

        if res_path and os.path.exists(res_path):
            with open(res_path, 'rb') as f:
                swapped_bytes = f.read()
            if len(swapped_bytes) > 5000:
                print(f"[SWAP] SUCCESS! Output size: {len(swapped_bytes)} bytes", flush=True)
                return swapped_bytes
    except Exception as e:
        print(f"[SWAP] gradio_client primary failed: {e}, trying fallback...", flush=True)
        logging.error(f"[_swap_danila_face] gradio_client failed: {e}")
    finally:
        if target_tmp and os.path.exists(target_tmp):
            try:
                os.remove(target_tmp)
            except Exception:
                pass

    return target_img_bytes


def _build_final_image_prompt(user_prompt: str) -> str:
    """Генерирует сочный, кинематографичный сюжетный промпт через нейросеть (Pollinations AI).
    Гарантирует полноценную сцену (medium/wide shot, окружение, свет, действие),
    а не скучный портрет в упор, сохраняя лицо персонажа для дальнейшего Face Swap."""
    p = user_prompt.strip()

    # 1. Сначала пробуем умный промпт-инжиниринг через LLM (Pollinations API)
    poll_key = getattr(config, 'POLLINATIONS_API_KEY', None)
    if poll_key:
        sys_prompt = (
            "You are an expert prompt engineer for FLUX image generator.\n"
            "The user enters a brief idea in Russian (e.g., 'данила играет в дедлок', 'данила на море', 'данила жарит шашлык').\n"
            "Convert this idea into a vivid, cinematic, high-quality English prompt for FLUX.\n"
            "Rules:\n"
            "1. If Danila / Данила / Туев is mentioned, always replace him with 'a young clean-shaven man with visible face'.\n"
            "2. NEVER produce just a headshot/close-up portrait unless the user explicitly requested 'портрет' or 'лицо крупным планом'.\n"
            "3. Describe the whole scene: environment, action, lighting, camera shot (medium shot or wide shot), props (e.g. for Deadlock/gaming: sitting in front of PC gaming monitor displaying Deadlock game, keyboard, mouse, headphones, glowing room).\n"
            "4. Return ONLY the English prompt text, nothing else. Maximum 60 words."
        )
        try:
            headers = {'Authorization': f'Bearer {poll_key}', 'Content-Type': 'application/json'}
            payload = {
                'model': 'openai',
                'messages': [
                    {'role': 'system', 'content': sys_prompt},
                    {'role': 'user', 'content': p}
                ],
                'max_tokens': 120
            }
            r = requests.post('https://gen.pollinations.ai/v1/chat/completions', headers=headers, json=payload, timeout=8)
            if r.status_code == 200:
                ai_prompt = r.json()['choices'][0]['message']['content'].strip()
                if ai_prompt and len(ai_prompt) > 15:
                    print(f"[IMG] AI Expanded Prompt: '{ai_prompt}'", flush=True)
                    return ai_prompt
        except Exception as ai_err:
            logging.warning(f"[_build_final_image_prompt] AI expansion failed: {ai_err}")

    # 2. Фолбэк через Google Translate, если сеть недоступна
    translated = ""
    try:
        url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q={requests.utils.quote(p)}"
        resp = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=7)
        if resp.status_code == 200:
            data = resp.json()
            translated = ''.join([part[0] for part in data[0] if part[0]])
    except Exception as e:
        logging.warning(f"[_build_final_image_prompt] GT error: {e}")

    if not translated:
        translated = p

    # Обработка сленга (если встретится)
    slang_map = {
        'altushka': 'cute gothic anime e-girl with dyed split hair and eyeliner',
        'skuf': 'middle-aged chubby balding man with beer',
        'masik': 'caring sweet handsome boyfriend',
        'tyubik': 'skinny trendy indie boy',
        'chechik': 'regular casual guy'
    }
    for k, v in slang_map.items():
        translated = re.sub(rf'(?i)\b\w*{k}\w*\b', v, translated)

    rus_slang = {
        'альтушк': 'cute gothic anime e-girl with dyed split hair and eyeliner',
        'альтух': 'cute gothic anime e-girl with dyed split hair and eyeliner',
        'скуф': 'middle-aged chubby balding man with beer',
        'масик': 'caring sweet handsome boyfriend',
        'тюбик': 'skinny trendy indie boy',
        'чечик': 'regular casual guy'
    }
    for k, v in rus_slang.items():
        translated = re.sub(rf'(?i)\b\w*{k}\w*\b', v, translated)

    # Заменяем имена Данилы на молодого мужчину, не ломая сюжет и позу
    translated = re.sub(
        r'(?i)\b(Danila|Danil|Daniil|Danya|Danile|Danilo|Danyla|Tuev|DanilaTuev|Данила|Даня|Туев)\b',
        'young clean-shaven man, visible face',
        translated
    )

    return f"{translated.strip()}, medium cinematic shot, highly detailed environment"


import threading
from collections import OrderedDict

# Потокобезопасный LRU-кэш и lock для дедупликации сообщений /img
_img_lock = threading.Lock()
_processed_img_messages = OrderedDict()

@bot.message_handler(commands=['img'])
def generate_image_cmd(message):
    cid = message.chat.id
    mid = message.message_id
    key = (cid, mid)

    # Атомарная блокировка от повторных апдейтов Telegram / дублирования потоков
    with _img_lock:
        if key in _processed_img_messages:
            return
        _processed_img_messages[key] = time.time()
        # Ограничиваем размер кэша до 2000 последних сообщений
        while len(_processed_img_messages) > 2000:
            _processed_img_messages.popitem(last=False)

    args = message.text.split(maxsplit=1)
    cid = message.chat.id
    if len(args) < 2:
        bot.send_message(cid, "🎨 Напиши, что нарисовать. Пример: `/img киберпанк кот в очках`", parse_mode='Markdown')
        return
    user_prompt = args[1].strip()
    bot.send_chat_action(cid, 'upload_photo')
    status_msg = bot.reply_to(message, "<i>*прищурился, достал холст и начал что-то кропотливо вырисовывать...*</i>", parse_mode='HTML')
    en_prompt = _build_final_image_prompt(user_prompt)
    image_data = _generate_image(en_prompt)
    if image_data:
        # Регулярка на ВСЕ производные и склонения имени Данила / Туев / парень / автопортрет / я / меня
        danila_pattern = re.compile(
            r'\b(данил\w*|дан[яеиюё]\w*|даньк\w*|данёк\w*|данек\w*|данич\w*|даниил\w*|даниэль\w*|туев\w*|парн\w*|парен\w*|мужчин\w*|мужик\w*|пацан\w*|человек\w*|себ[яе]\w*|автопортрет\w*|лиц\w*|босс\w*|тренер\w*|качок\w*|я|мне|меня|мной)\b',
            re.IGNORECASE
        )
        should_swap = bool(danila_pattern.search(user_prompt)) or any(w in en_prompt.lower() for w in ['man', 'guy', 'male', 'boy', 'person', 'young man'])
        print(f"[IMG] user_prompt='{user_prompt}' -> should_swap={should_swap}", flush=True)
        if should_swap:
            swapped = _swap_danila_face(image_data)
            if swapped and len(swapped) > 5000:
                image_data = swapped

        # Удаляем временное статусное сообщение перед отправкой готовой картины
        if status_msg:
            try:
                bot.delete_message(cid, status_msg.message_id)
            except Exception:
                pass

        bot.send_photo(cid, image_data, caption=f"🎨 <b>Твоя идея:</b> {html.escape(user_prompt)}", parse_mode='HTML')
    else:
        if status_msg:
            try:
                bot.delete_message(cid, status_msg.message_id)
            except Exception:
                pass
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
            "🏛 <b>DEEP DARK GYM • МЕНЮ КОМАНД</b>\n"
            "━━━━━━━━━━━━━━━━━━━━\n\n"
            "🎮 <b>Мини-игры и Турниры:</b>\n"
            "  • /app — открыть мини-приложение, 9 игр и инвентарь\n"
            "  • /cup — кубок недели и таблица чемпионов\n"
            "  • /achievements (/ach) — твои достижения и награды\n\n"
            "💰 <b>Экономика и Магазин ($300 Store):</b>\n"
            "  • /coins — баланс монет и серия посещений (стрик)\n"
            "  • /shop — витрина товаров, приколов и VIP-статуса\n"
            "  • <code>/buy &lt;товар&gt;</code> — купить перк или прикол в чате\n\n"
            "🎭 <b>Ролевая игра и Каста:</b>\n"
            "  • /who — текущий образ и статус персонажа\n"
            "  • <code>/set &lt;роль&gt;</code> — выбрать архетип персонажа\n"
            "  • <code>/prompt &lt;описание&gt;</code> — задать характер и манеру речи\n"
            "  • <code>/goal &lt;цель&gt;</code> — поставить глобальную цель\n"
            "  • /reset — сбросить персонажа и начать заново\n\n"
            "🎒 <b>Инвентарь и Предметы:</b>\n"
            "  • /inv — посмотреть свой кожаный инвентарь\n"
            "  • <code>/use &lt;вещь&gt; | &lt;действие&gt;</code> — применить предмет\n"
            "  • <code>/giveitem &lt;кому&gt; | &lt;вещь&gt;</code> — передать предмет другу\n\n"
            "🎙 <b>Озвучка и Медиа:</b>\n"
            "  • <code>/voice &lt;имя&gt;</code> — выбрать голос (Valentin, Danila, etc.)\n"
            "  • /voice on / /voice off — включить или выключить озвучку\n"
            "  • <code>/img &lt;описание&gt;</code> — сгенерировать Deep Dark Fantasy арт\n\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
            "💡 <i>Нажмите /app для быстрого запуска игр, магазина и таблицы рекордов.</i>",
            parse_mode='HTML',
        )
        return
    if command in {'/start', '/app'}:
        from telebot.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
        # BotFather's Mini App URL is separate from this runtime setting.
        # Keep a working default so /app still replies when the host variable
        # has not been configured.
        app_url = os.getenv('MINIAPP_URL', 'https://danilatuevbot.wispbyte.app').strip()
        short_app_name = os.getenv('MINIAPP_SHORT_NAME', 'app').strip()
        bot_username = BOT_USERNAME or os.getenv('MINIAPP_BOT_USERNAME', 'DanilaTuev_Bot').strip().lstrip('@')

        if app_url.startswith('https://') or app_url.startswith('http://'):
            # A group-launched /start deep link preserves that group's context
            # when the Mini App has to open in a private chat.
            start_arg = message.text.split(maxsplit=1)[1].strip() if message.text and len(message.text.split(maxsplit=1)) > 1 else ''
            group_match = re.fullmatch(r'app_(-\d{1,15})(?:_([A-Za-z0-9_]{1,32}))?', start_arg)
            context = {}
            if group_match:
                context['chat_id'] = group_match.group(1)
                if group_match.group(2):
                    context['chat_username'] = group_match.group(2)
                if user:
                    inventory_store.remember_chat(
                        int(group_match.group(1)), user.id, "", group_match.group(2) or "",
                    )
            elif message.chat.type in {'group', 'supergroup'}:
                context['chat_id'] = str(message.chat.id)
                if getattr(message.chat, 'username', None):
                    context['chat_username'] = message.chat.username

            if user:
                context['user_id'] = str(user.id)
                context['username'] = getattr(user, 'username', '') or ''
                context['first_name'] = getattr(user, 'first_name', '') or ''

            separator = '&' if '?' in app_url else '?'
            full_app_url = f'{app_url}{separator}{urllib.parse.urlencode(context)}' if context else app_url

            if message.chat.type in {'group', 'supergroup'}:
                # In groups, InlineKeyboardButton with web_app is prohibited by Telegram API.
                # Provide direct t.me link (which launches Mini App in Telegram) + PM deep link + Web link.
                group_username = getattr(message.chat, 'username', None) or ''
                if not group_username:
                    group_username = os.getenv('MINIAPP_GROUP_USERNAME', '').strip().lstrip('@')
                
                chat_context_param = f"{message.chat.id}"
                bot_pm_url = (
                    f'https://t.me/{bot_username}?start=app_{message.chat.id}'
                    + (f'_{group_username}' if group_username else '')
                )
                
                # Direct Telegram Mini App links
                # startapp query format: https://t.me/<bot>?startapp=<param>
                # and BotFather direct mini app link: https://t.me/<bot>/<app_name>?startapp=<param>
                tme_startapp_url = f'https://t.me/{bot_username}?startapp={urllib.parse.quote(chat_context_param)}'
                tme_short_url = f'https://t.me/{bot_username}/{short_app_name}?startapp={urllib.parse.quote(chat_context_param)}' if short_app_name else tme_startapp_url

                keyboard = InlineKeyboardMarkup(row_width=1)
                keyboard.add(
                    InlineKeyboardButton('🚀 Запустить Mini App', url=tme_short_url),
                    InlineKeyboardButton('💬 Открыть через ЛС с ботом', url=bot_pm_url),
                    InlineKeyboardButton('🌐 Открыть в браузере', url=full_app_url)
                )
                bot.send_message(
                    message.chat.id,
                    '🎮 <b>Danila Mini App</b>\n\n'
                    'Инвентарь, магазин, игры и профиль персонажа.\n'
                    '<i>Выберите удобный способ открытия:</i>',
                    parse_mode='HTML',
                    reply_markup=keyboard,
                )
                return

            # In private chat:
            # InlineKeyboardButton with web_app=WebAppInfo(...) works directly in the native Telegram Webview.
            # Also provide direct t.me startapp link and direct browser link as fallbacks.
            chat_context_param = group_match.group(1) if group_match else 'inventory'
            tme_short_url = f'https://t.me/{bot_username}/{short_app_name}?startapp={urllib.parse.quote(chat_context_param)}' if short_app_name else f'https://t.me/{bot_username}?startapp={urllib.parse.quote(chat_context_param)}'

            keyboard = InlineKeyboardMarkup(row_width=1)
            keyboard.add(
                InlineKeyboardButton('🎒 Открыть профиль игрока', web_app=WebAppInfo(url=full_app_url)),
                InlineKeyboardButton('🚀 Запустить Mini App (Telegram)', url=tme_short_url),
                InlineKeyboardButton('🌐 Открыть в браузере', url=full_app_url)
            )
            bot.send_message(
                message.chat.id,
                '🎒 <b>Danila Mini App</b>\n\n'
                'Инвентарь, магазин, игры и архетипы персонажа.\n'
                '<i>Нажмите кнопку ниже для запуска Mini App:</i>',
                parse_mode='HTML',
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
    # Проверяем, есть ли для автора сообщения или цели купленный розыгрыш/подкол
    pending_prank = inventory_store.get_pending_prank(cid, target_user_id=requester_id) if requester_id else None
    pending_roast = inventory_store.get_pending_roast(cid, target_user_id=requester_id) if requester_id else None
    has_pending_interaction = bool(pending_prank or pending_roast)

    # Explicit inventory actions and paid shop pranks should be handled even when addressed to another user.
    addressed = bool(
        is_private or is_reply or is_mention or called or take_intent
        or (give_intent and give_intent.get("explicit"))
        or container_loss_target
        or has_pending_interaction
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

    # Регистрация меню команд Telegram для всплывающей кнопки Меню [/]
    try:
        from telebot.types import BotCommand
        bot.set_my_commands([
            BotCommand("app", "🎮 Мини-игры, инвентарь и магазин"),
            BotCommand("help", "📖 Полный список команд клуба"),
            BotCommand("coins", "🪙 Монеты и стрик посещений"),
            BotCommand("shop", "🏪 Leather Shop ($300 Store)"),
            BotCommand("achievements", "🏅 Достижения и награды"),
            BotCommand("claimach", "🎁 Забрать все награды за ачивки"),
            BotCommand("cup", "🏆 Еженедельный кубок качалки"),
            BotCommand("records", "🕹 Рекорды мини-игр"),
            BotCommand("who", "🎭 Кто ты? Текущий образ и статус"),
            BotCommand("inv", "🎒 Посмотреть кожаный инвентарь"),
            BotCommand("reset", "🔄 Начать нового персонажа с нуля"),
        ])
        print("[BOOT] Telegram bot commands menu registered successfully.")
    except Exception as cmd_err:
        print(f"[BOOT] Notice: Could not register Telegram bot commands: {cmd_err}")

    import signal

    global _bot_running
    _bot_running = True

    def _graceful_stop(signum, frame):
        global _bot_running
        print(f"\n[SHUTDOWN] Received signal {signum}, stopping gracefully...", flush=True)
        _bot_running = False
        try:
            bot.stop_polling()
        except Exception:
            pass
        os._exit(0)

    signal.signal(signal.SIGINT, _graceful_stop)
    signal.signal(signal.SIGTERM, _graceful_stop)

    while _bot_running:
        try:
            # interval=1 задает паузу между запросами к Telegram, исключая tight loop и 100% CPU spike при разрывах связи
            bot.infinity_polling(timeout=30, long_polling_timeout=30, interval=1, logger_level=logging.ERROR)
        except (KeyboardInterrupt, SystemExit):
            print("\n[SHUTDOWN] Bot stopped by interrupt.", flush=True)
            break
        except Exception as poll_err:
            if not _bot_running:
                break
            logging.error("Telegram polling error: %s", poll_err)
            time.sleep(5)
