import re
import time
import threading
import logging
import requests

import config
from config import (
    XKIRO_API_KEY, TEXT_MODELS, VISION_MODELS, MAX_RESPONSE_TOKENS,
    RE_RUSSIAN, RE_ENGLISH, RE_META_LINE, RE_PROMPT_LEAK, RE_HTML_TAG,
    RE_CLEAN_WORD, RE_VOWELS, RE_THINK_TAG, RE_THOUGHT_TAG, RE_THINK_BLOCK,
    RE_PREFIX_LABEL, RE_SPEAKER, RE_ITALICS, RE_RUSSIAN_WORD,
    ai_debug, _last_ai_call, _AI_MIN_INTERVAL, _AI_429_BACKOFF
)

XKIRO_ENDPOINT = "https://api.xkiro.com/v1/chat/completions"
RE_LEADING_ACTION = re.compile(r'^\*([^*]+)\*\s*')
MAX_CHAR_LIMIT = 1000
_tls = threading.local()  # truncated: ответ оборван по max_tokens


def _throttle_ai(extra: float = 0.0):
    global _last_ai_call
    now = time.time()
    wait = _AI_MIN_INTERVAL + extra - (now - _last_ai_call)
    if wait > 0:
        time.sleep(wait)
    _last_ai_call = time.time()


def _set_ai_trace(lines: list, cid=None):
    # ВАЖНО: пишем в config.LAST_AI_TRACE через сам объект модуля. Раньше здесь было
    # "global LAST_AI_TRACE; LAST_AI_TRACE = ...", а это имя было импортировано в
    # ai_client через "from config import LAST_AI_TRACE" — такое присваивание меняет
    # ТОЛЬКО локальную копию имени внутри ai_client.py и никогда не доходит до
    # config.py. Из-за этого /err годами показывал одну и ту же заглушку.
    text = "\n".join(lines) if lines else "ошибок пока не было"
    config.LAST_AI_TRACE = text
    if cid is not None:
        ai_debug[cid] = text


def _xkiro_err(res) -> str:
    try:
        data = res.json()
        err = data.get("error", data)
        if isinstance(err, dict):
            return str(err.get("message") or err.get("code") or err)[:400]
        return str(err)[:400]
    except Exception:
        return (res.text or "")[:400]


def _cmd_body(message) -> str:
    parts = (message.text or "").split(maxsplit=1)
    return parts[1].strip() if len(parts) > 1 else ""


def _as_int(x, default=None):
    try:
        return int(str(x).strip())
    except (TypeError, ValueError):
        return default


def _is_cot_or_leak(text: str) -> bool:
    if not text:
        return True
    ru = len(RE_RUSSIAN.findall(text))
    en = len(RE_ENGLISH.findall(text))
    head = text[:500]
    if RE_META_LINE.search(head) and ru < 40:
        return True
    if RE_PROMPT_LEAK.search(head) and ru < 40:
        return True
    if en > 25 and en > ru:
        return True
    return False


def get_ai_response(system_prompt, messages=None, max_tokens=MAX_RESPONSE_TOKENS,
                    is_vision=False, filter_leak=True):
    _tls.truncated = False
    models = VISION_MODELS if is_vision else TEXT_MODELS
    payload = [{"role": "system", "content": system_prompt}]
    if messages:
        payload.extend(messages)

    timeout = 60 if is_vision else 40
    headers = {
        "Authorization": f"Bearer {XKIRO_API_KEY}",
        "Content-Type": "application/json",
    }
    params = {
        "temperature": 0.75,
        "max_tokens": max_tokens,
        "top_p": 0.9,
        "repetition_penalty": 1.2,
        "stop": [
            "\nUser", "\nПользователь", "User:", "\n\n\n",
            "Кстати,", "Так вот,", "Между прочим,",
            "Okay,", "The user", "I need to",
            "Как ИИ", "As an AI", "Я языковая модель",
            "Thinking:", "Process:", "Analyze:",
        ],
    }

    traces = []
    logger = logging.getLogger("ai_client")
    for model in models:
        try:
            _throttle_ai()
            res = requests.post(
                XKIRO_ENDPOINT,
                headers=headers,
                json={"model": model, "messages": payload, **params},
                timeout=timeout,
            )
            if res.status_code == 429:
                err_msg = f"{model}: HTTP 429 — rate limit, жду {_AI_429_BACKOFF:.0f}с"
                traces.append(err_msg)
                if is_vision:
                    logger.warning(f"[VISION API] {err_msg}")
                _throttle_ai(extra=_AI_429_BACKOFF)
                continue
            if res.status_code != 200:
                err_detail = _xkiro_err(res)
                err_msg = f"{model}: HTTP {res.status_code} — {err_detail}"
                traces.append(err_msg)
                if is_vision:
                    logger.warning(f"[VISION API] {err_msg}")
                continue

            data = res.json()
            if data.get("error"):
                err_msg = f"{model}: API error — {data['error']}"
                traces.append(err_msg)
                if is_vision:
                    logger.warning(f"[VISION API] {err_msg}")
                continue

            choices = data.get("choices") or []
            if not choices:
                err_msg = f"{model}: пустой choices, raw={str(data)[:200]}"
                traces.append(err_msg)
                if is_vision:
                    logger.warning(f"[VISION API] {err_msg}")
                continue

            msg = choices[0].get("message") or {}
            content = msg.get("content")
            if isinstance(content, list):
                text = " ".join(
                    p.get("text", "") for p in content if isinstance(p, dict)
                ).strip()
            else:
                text = (content or "").strip()

            if not text:
                reason = choices[0].get("finish_reason")
                extra = msg.get("reasoning") or msg.get("reasoning_content") or ""
                err_msg = (
                    f"{model}: пустой content (finish={reason})"
                    + (f", reasoning={str(extra)[:120]}" if extra else "")
                )
                traces.append(err_msg)
                if is_vision:
                    logger.warning(f"[VISION API] {err_msg}")
                continue

            if filter_leak and _is_cot_or_leak(text):
                err_msg = f"{model}: отсеян как CoT/утечка: {text[:120]!r}"
                traces.append(err_msg)
                if is_vision:
                    logger.warning(f"[VISION API] {err_msg}")
                continue

            _tls.truncated = (choices[0].get("finish_reason") == "length")
            _set_ai_trace([f"{model}: ок, {len(text)} символов"])
            return text
        except Exception as e:
            err_msg = f"{model}: {type(e).__name__}: {e}"
            traces.append(err_msg)
            if is_vision:
                logger.warning(f"[VISION API] {err_msg}")
            continue

    if is_vision and messages:
        logger.info("[VISION API] All vision models failed. Falling back to text-only mode.")
        fallback = []
        for m in messages:
            content = m["content"]
            if isinstance(content, list):
                text_only = " ".join(
                    item["text"] for item in content if item.get("type") == "text"
                )
                fallback.append({
                    "role": m["role"],
                    "content": text_only + " (Картинка не загрузилась, ответь просто на текст)",
                })
            else:
                fallback.append(m)
        return get_ai_response(system_prompt, fallback, max_tokens, is_vision=False, filter_leak=filter_leak)

    _set_ai_trace(traces or ["ни одна модель не ответила"])
    return None


def _make_suffix(word: str, suffix: str) -> str:
    w = word.lower()
    while len(w) > 1 and w[-1] in RE_VOWELS:
        w = w[:-1]
    if len(w) == 1 and w in RE_VOWELS:
        consonants = [c for c in word.lower() if c not in RE_VOWELS]
        w = "".join(consonants[:2]) if consonants else "бр"
    return w.capitalize() + suffix


def _is_good_name_word(w: str) -> bool:
    w = w.lower().strip()
    if not w or len(w) < 2 or len(w) > 8:
        return False
    if not RE_RUSSIAN.match(w):
        return False
    return w[-1] not in RE_VOWELS and w[-1] not in ('й', 'ь', 'ъ')


def _words_from_prompt(prompt: str) -> list:
    raw_words = RE_RUSSIAN_WORD.findall(prompt)
    candidates = []
    for w in raw_words:
        w = w.lower()
        while len(w) > 1 and w[-1] in RE_VOWELS:
            w = w[:-1]
        if 2 <= len(w) <= 6 and w[-1] not in ('й', 'ь', 'ъ'):
            if w not in candidates:
                candidates.append(w)
    candidates.sort(key=len)
    return candidates


_KEYWORD_FALLBACKS = {
    'аним':  ('бант', 'блеск'),
    'девочк': ('бант', 'блеск'),
    'гоп':   ('брат', 'двор'),
    'пацан': ('брат', 'двор'),
    'музык': ('звук', 'ритм'),
    'учён':  ('мозг', 'факт'),
    'наук':  ('мозг', 'факт'),
    'пират': ('клад', 'флот'),
    'маг':   ('маг', 'жезл'),
    'чарод': ('маг', 'жезл'),
    'киборг': ('диск', 'порт'),
    'робот':  ('диск', 'порт'),
    'целит': ('лист', 'сок'),
    'лекар': ('лист', 'сок'),
    'сыщ':   ('след', 'факт'),
    'детек': ('след', 'факт'),
    'воин':  ('меч', 'щит'),
    'самур': ('меч', 'кодекс'),
    'плут':  ('хитр', 'трюк'),
    'обман': ('хитр', 'трюк'),
    'творч': ('твор', 'вдох'),
    'худож': ('краск', 'холст'),
}


def _smart_fallback(prompt: str) -> tuple:
    lower = prompt.lower()
    for keyword, (w1, w2) in _KEYWORD_FALLBACKS.items():
        if keyword in lower:
            return w1, w2
    from_prompt = _words_from_prompt(prompt)
    if len(from_prompt) >= 2:
        return from_prompt[0], from_prompt[1]
    return "тайн", "рок"


def ai_generate_name(character_prompt: str) -> str:
    instruction = (
        "Твоя задача — подобрать ДВА русских нарицательных существительных, "
        "которые ПЕРЕДАЮТ СУТЬ этого персонажа. Слова станут основой его имени.\n\n"
        "ПРАВИЛА:\n"
        "- Каждое слово ОБЯЗАТЕЛЬНО заканчивается на ТВЁРДУЮ СОГЛАСНУЮ "
        "(допустимые окончания: б,в,г,д,ж,з,к,л,м,н,п,р,с,т,ф,х,ц,ч,ш,щ). "
        "НЕ используй слова на й, ь, ъ или гласную.\n"
        "- Слова короткие: 3-6 букв.\n"
        "- Слова РЕАЛЬНЫЕ, русские, нарицательные существительные.\n"
        f"Персонаж: '{character_prompt}'\n\n"
        "Напиши ТОЛЬКО ДВА СЛОВА через пробел. Никаких других символов."
    )
    for _ in range(2):
        raw = get_ai_response(instruction, max_tokens=50) or ""
        raw = RE_HTML_TAG.sub('', raw)
        words = RE_CLEAN_WORD.sub('', raw).strip().split()
        if len(words) >= 2:
            w1, w2 = words[-2], words[-1]
            if _is_good_name_word(w1) and _is_good_name_word(w2):
                return f"{_make_suffix(w1, 'ила')} {_make_suffix(w2, 'уев')}"
    w1, w2 = _smart_fallback(character_prompt)
    return f"{_make_suffix(w1, 'ила')} {_make_suffix(w2, 'уев')}"


def enforce_russian(text: str) -> str:
    if not text:
        return ""
    ru = len(RE_RUSSIAN.findall(text))
    en = len(RE_ENGLISH.findall(text))
    if en > 15 and en > ru:
        translated = get_ai_response(
            "Переведи этот текст на русский язык, строго сохраняя стиль общения "
            "персонажа и его *действия в звездочках*. Выведи ТОЛЬКО русский "
            "перевод без кавычек и комментариев.",
            [{"role": "user", "content": text}],
            max_tokens=MAX_RESPONSE_TOKENS,
        )
        if translated:
            return translated
    return text


def _line_is_russian_rp(line: str) -> bool:
    ru = len(RE_RUSSIAN.findall(line))
    en = len(RE_ENGLISH.findall(line))
    if ru < 3:
        return False
    if RE_META_LINE.search(line) and ru < 25:
        return False
    if RE_PROMPT_LEAK.search(line) and ru < 25:
        return False

    low = line.lower().strip()
    bad_starts = [
        "я музыкант", "я гопник", "я учёный", "я сыщик", "я маг",
        "я пират", "я самурай", "я плут", "я целитель", "я киборг",
        "я творческая", "я дерзкий", "я заумный", "я хитрый", "я таинственный",
        "я отважный", "я стойкий", "я лукавый", "я добрый", "я холодный",
        "мой персонаж", "как персонаж", "в роли", "играю роль",
    ]
    for bad in bad_starts:
        if low.startswith(bad) and len(low) < 80:
            return False

    return ru >= en


def final_clean(ai_text: str, limit: int = 4000) -> str:
    if not ai_text:
        return ""
    ai_text = RE_THINK_BLOCK.sub('', ai_text)
    ai_text = RE_THINK_TAG.sub('', ai_text)
    ai_text = RE_THOUGHT_TAG.sub('', ai_text)
    ai_text = RE_HTML_TAG.sub('', ai_text)
    ai_text = RE_PREFIX_LABEL.sub('', ai_text)
    clean_lines = []
    for line in ai_text.split('\n'):
        line = line.strip()
        if not line:
            continue
        low = line.lower()
        if "языковая модель" in low or "искусственный интеллект" in low:
            continue
        if low.startswith(("you are ", "name:", "persona:", "goal:", "current stage:")):
            continue
        if not _line_is_russian_rp(line):
            continue
        clean_lines.append(line)
    ai_text = " ".join(clean_lines).strip()
    ai_text = RE_SPEAKER.sub('', ai_text)
    ru = len(RE_RUSSIAN.findall(ai_text))
    en = len(RE_ENGLISH.findall(ai_text))
    if not ai_text or en > ru:
        return ""
    if RE_META_LINE.search(ai_text) and ru < 40:
        return ""
    if RE_PROMPT_LEAK.search(ai_text) and ru < 20:
        return ""
    return ai_text[:limit]


def format_html_italics(text: str) -> str:
    return RE_ITALICS.sub(r'<i>\1</i>', text)


_SENT_END = '.!?…'
_CLOSERS = '»"”)'


def smart_trim(text: str, max_sentences: int, truncated: bool = False) -> str:
    """Обрезка по ЦЕЛЫМ предложениям. Знаки препинания внутри *действий* не считаются
    концом предложения. Если ответ оборван по лимиту токенов (truncated) — недописанный
    хвост и незакрытое *действие* отбрасываются, а не отправляются обрывком."""
    text = text.strip()
    if not text:
        return text
    sentences, cur, in_act = [], "", False
    n = len(text)
    for i, ch in enumerate(text):
        cur += ch
        if ch == '*':
            in_act = not in_act
            continue
        if in_act:
            continue
        at_boundary = (i + 1 >= n) or text[i + 1].isspace()
        is_end = ch in _SENT_END or (ch in _CLOSERS and len(cur) > 1 and cur[-2] in _SENT_END)
        if is_end and at_boundary:
            sent = cur.strip()
            if sent:
                sentences.append(sent)
            cur = ""
            if len(sentences) >= max_sentences:
                return " ".join(sentences)

    frag = cur.strip()
    if frag:
        broken = False
        if in_act:
            if truncated:
                frag = frag[:frag.rfind('*')].strip()
                broken = True
            else:
                frag += '*'
        elif truncated and frag[-1] not in _SENT_END + _CLOSERS + '*':
            broken = True
        if frag and not (broken and sentences):
            if broken:
                frag += "…"
            sentences.append(frag)
    return " ".join(sentences)


def process_ai_response(raw: str, max_sentences: int | None = None,
                        max_chars: int | None = None) -> str | None:
    if not raw:
        return None
    # Не режем ответ до поиска границы предложения: ранний лимит в final_clean
    # мог оставить середину последней мысли, после чего smart_trim уже не мог
    # восстановить её. Финальный лимит применяется ниже, после обрезки по фразам.
    clean_limit = max(12000, (max_chars or MAX_CHAR_LIMIT) * 3)
    text = final_clean(raw, limit=clean_limit)
    if not text:
        return None

    truncated = getattr(_tls, "truncated", False)
    if max_sentences:
        text = smart_trim(text, max_sentences, truncated)
    elif truncated:
        text = smart_trim(text, 10 ** 6, True)
    if not text:
        return None

    limit = max_chars or MAX_CHAR_LIMIT
    if len(text) > limit:
        cut_pos = max(text.rfind(c, 0, limit) for c in '.!?')
        text = text[:cut_pos + 1] if cut_pos > 100 else text[:limit]
        if text.count('*') % 2:
            text = text[:text.rfind('*')].rstrip() or text.replace('*', '')

    m = RE_LEADING_ACTION.match(text)
    if m:
        action = m.group(1).strip()
        rest = text[m.end():].strip()
        split_match = re.search(r'[.!?](\s|$)', rest)
        if split_match:
            first_sentence = rest[:split_match.end()].strip()
            remainder = rest[split_match.end():].strip()
            if first_sentence and first_sentence[-1] in '.!?':
                text = f"{first_sentence[:-1]}, *{action}*{first_sentence[-1]}"
            else:
                text = f"{first_sentence}, *{action}*."
            if remainder:
                text += f" {remainder}"
        else:
            text = f"{rest}, *{action}*."

    ru = len(RE_RUSSIAN.findall(text))
    en = len(RE_ENGLISH.findall(text))
    if en > 8 and en > ru // 3:
        text = enforce_russian(text)
        text = final_clean(text)
    return format_html_italics(text) if text else None

