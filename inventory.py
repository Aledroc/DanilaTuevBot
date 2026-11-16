"""Persistent per-player inventories for each Telegram chat."""

import os
import re
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path


_DATA_DIR = Path(os.getenv("BOT_DATA_DIR") or Path(__file__).resolve().parent)
_DB_PATH = _DATA_DIR / "bot_data.sqlite3"
_MAX_ITEM_NAME = 60
_MAX_UNIQUE_ITEMS = 30
_MAX_STACK = 99

_ITEM_ADD_RE = re.compile(
    r"\[\[?\s*ITEM_ADD\s*:\s*([^\]\r\n]{1,100})\]?\]", re.IGNORECASE
)
_ITEM_CONSUME_RE = re.compile(
    r"\[\[?\s*ITEM_CONSUME\s*:\s*([^\]\r\n]{1,100})\]?\]", re.IGNORECASE
)
_ITEM_GIVE_RE = re.compile(
    r"\[\[?\s*ITEM_GIVE\s*:\s*([^:\]\r\n]{1,80})\s*:\s*([^\]\r\n]{1,100})\]?\]",
    re.IGNORECASE,
)
_TAKE_INTENT_RE = re.compile(
    r"^\s*(?:я\s+)?(?:беру|возьму|взял[а]?|взять|поднимаю|поднял[а]?|подбираю|подобрал[а]?|"
    r"забираю|забрал[а]?|хватаю|схватил[а]?|подхватываю|подхватил[а]?|получить)\s+"
    r"(?:себе\s+)?(.+?)\s*[.!?]*\s*$",
    re.IGNORECASE | re.DOTALL,
)
_PICKUP_LOCATION_RE = re.compile(
    r"\s+(?:со|с|из|от)\s+(?:стола|полки|подноса|корзины|ящика|земли|пола|"
    r"прилавка|витрины|чужих рук|рук)\b.*$",
    re.IGNORECASE,
)
_PICKUP_PREFIX_RE = re.compile(
    r"^\s*(?:(?:со|с|из|от)\s+(?:стола|полки|подноса|корзины|ящика|земли|пола|"
    r"прилавка|витрины|тарелки|тарелку|подоконника|сумки|коробки)\s+)+",
    re.IGNORECASE,
)
_PICKUP_TAIL_RE = re.compile(r"\s+(?:и|а потом|чтобы|пока)\b.*$", re.IGNORECASE)
_TAKE_DENIAL_PATTERNS = tuple(re.compile(pattern, re.IGNORECASE) for pattern in (
    r"\bне\s+(?:можешь|могу|сможешь|получается|получилось|уда[её]тся)\s+(?:взять|забрать|поднять|подобрать|дотянуться|получить)",
    r"\bне\s+(?:смог|смогла|смогли|удалось)\s+(?:взять|забрать|поднять|подобрать|достать|получить)",
    r"\bне\s+могу\s+(?:дать|передать|отдать|позволить)\s+(?:тебе\s+)?",
    r"\bне\s+(?:дам|даю|позволяю|отдаю|могу\s+отдать)\s+(?:тебе\s+)?(?:взять|забрать|поднять|подобрать)",
    r"\bнельзя\s+(?:взять|забрать|поднять|получить)",
    r"\bневозможно\s+(?:взять|забрать|поднять|получить)",
    r"\bне\s+(?:оказал\w*|был\w*|остал\w*)",
    r"\bне\s+было\b",
    r"\bне\s+остал\w*\b",
    r"\bнедоступ\w*",
    r"\bслишком\s+(?:далеко|высоко)",
    r"\bуже\s+(?:съеден\w*|съели|исчез\w*|забрал\w*|разбит\w*)",
    r"\bне\s+существу\w*",
    r"\bпустое\s+место",
    r"\bничего\s+не\s+остал\w*",
    r"\bне\s+(?:вижу|видно|нашли|нашел|нашла|обнаружил\w*)",
))
_NO_TRANSFER_PATTERNS = tuple(re.compile(pattern, re.IGNORECASE) for pattern in (
    r"\bнечего(?:\s+(?:(?:мне|тебе|ему|ей|им|нам|вам|сюда|туда|сейчас|здесь))){0,3}\s+"
    r"(?:передавать|передать|отдавать|отдать|дать|вручать|вручить|дарить|подарить)\b",
    r"\bнечем(?:\s+(?:(?:мне|тебе|ему|ей|им|нам|вам|сюда|туда|сейчас|здесь))){0,3}\s+"
    r"(?:передать|отдать|дать|вручить|подарить)\b",
    r"\b(?:передавать|передать|отдавать|отдать|дать|вручать|вручить|дарить|подарить)\s+нечего\b",
))
_GIVE_DENIAL_PATTERNS = tuple(re.compile(pattern, re.IGNORECASE) for pattern in (
    r"\bне\s+(?:могу|смогу|смог\w*|буду|стану|хочу|собираюсь|захотел\w*)\s+(?:дать|передать|отдать|вручить|подарить)",
    r"\bне\s+(?:дам|даю|дал[аои]?|передам|передаю|передал[аои]?|отдам|отдаю|отдал[аои]?|"
    r"вручу|вручаю|вручил[аои]?|подарю|дарю|подарил[аои]?)\b",
    r"\bотказ(?:ал\w*|ался|алась|ались|ыва\w*)\b",
    r"\b(?:у\s+меня|у\s+него|у\s+не[её])\s+(?:нет|не\s+оказал\w*)\b",
    r"\bне\s+получил[аои]?\b",
))
_ITEM_WORD_RE = re.compile(r"[а-яёa-z0-9]+", re.IGNORECASE)
# Telegram often stores a participant's name in Latin ("Palkin") while players
# and the model write it in Cyrillic ("Палкин"). Both sides are reduced to the
# same rough Latin key so such gifts can still find their addressee.
_TRANSLIT_MAP = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "i", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "i", "ь": "", "э": "e", "ю": "iu", "я": "ia",
}
_GIFT_HANDOVER_RE = re.compile(
    r"\b(?:отдаю|отдал[а]?|отда[её]т|передаю|передал[а]?|переда[её]т|"
    r"вручаю|вручил[а]?|вруча[её]т|протягиваю|протянул[а]?|протягива[её]т|"
    r"дарю|подарил[а]?|вкладываю|вложил[а]?|кладу|положил[а]?|клад[её]т|"
    r"даю|дал[а]?|да[её]т|достаю|достал[а]?|доста[её]т)\b",
    re.IGNORECASE,
)
# Phrases that confirm the character has just handed something to the player.
_PLAYER_RECEIVE_RE = re.compile(
    r"\b(?:отдаю|отдал[а]?|отда[её]т|передаю|передал[а]?|переда[её]т|"
    r"вручаю|вручил[а]?|вруча[её]т|протягиваю|протянул[а]?|протягива[её]т|"
    r"дарю|подарил[а]?|вкладываю|вложил[а]?|кладу|положил[а]?|клад[её]т|"
    r"даю|дал[а]?|да[её]т|держи(?:те)?|возьми(?:те)?|забирай(?:те)?|"
    r"бери(?:те)?|достаю|достал[а]?|доста[её]т|вынимаю|вынул[а]?|"
    r"вытаскиваю|вытащил[а]?|вот\s+(?:тебе|тво[яйиё]|ваш\w*))\b",
    re.IGNORECASE,
)
_SPEAKER_OBJECT_RE = re.compile(
    r"\b(?:мне|меня|мной|моего|мою|моя|мой|мои|ему|ей|им)\b", re.IGNORECASE
)
_HANDOVER_BLOCKER_RE = re.compile(
    r"(?:\bне\s+|\b(?:могу|мог[ла]?|готов[а]?|хочу|собираюсь|обещаю)\s+)$",
    re.IGNORECASE,
)
_RU_ENDINGS = (
    "иями", "ями", "ами", "ого", "его", "ему", "ому", "ыми", "ими", "иях", "ах", "ях",
    "ею", "ою", "ией", "иями", "ого", "ому", "ою", "ею", "ами", "ями",
    "ую", "юю", "ая", "яя", "ые", "ие", "ых", "их", "ое", "ее", "ый", "ий", "ым", "им",
    "ом", "ем", "ой", "ей", "ам", "ям", "ов", "ев", "ы", "и", "а", "я", "у", "ю", "е",
)
_KNOWN_MEMBERS: dict[int, dict[str, dict[int, str]]] = {}
# Familiar group nicknames, keyed to Telegram usernames. Aliases are only
# attached once that participant has spoken in the chat and their ID is known.
_GROUP_MEMBER_ALIASES = {
    "blacksunm": ("Дима", "Аледрок"),
    "valentinz9": ("Валентин",),
    "northstar_li": ("Тимурчик",),
    "searook": ("Кирилл",),
    "dgyip1": ("Данила", "Данила Туев"),
    "lamr1k": ("Ваня",),
    "northstar_paradise": ("Софья",),
    "v_1nc3nt": ("Саня",),
    "serethreal": ("Лёха", "Лёха Хайп"),
    "missmorda": ("Вика",),
    "dumbsalmon": ("Семён",),
    "dasha15sad": ("Даша",),
    "xitodek": ("Миша",),
}
_GIVE_RE = re.compile(
    r"\b(?P<verb>дай|дайте|дашь|дадите|передай|передайте|вручи|вручите|отдай|отдайте|"
    r"подар[иь](?:те)?|выдай|выдайте|выдашь|добавь|добавить|положи|запиши|можно|"
    r"угости|угостите|угостишь)\b"
    r"(?P<rest>[^.!?\r\n]+)",
    re.IGNORECASE,
)
# "Есть сигаретка?" / "Найдётся закурить?" — polite requests for an item.
_HAVE_ITEM_RE = re.compile(
    r"^\s*(?:а\s+)?(?:есть\s+(?:у\s+тебя\s+|ли\s+у\s+тебя\s+)?|"
    r"найд[её]тся\s+(?:у\s+тебя\s+)?|не\s+найд[её]тся\s+ли\s+(?:у\s+тебя\s+)?)"
    r"(?P<rest>[^.!?\r\n]+?)\s*\??\s*$",
    re.IGNORECASE,
)
# "Сигарету можно?" — the verb trails the item, so _GIVE_RE cannot see it.
_CAN_I_ITEM_RE = re.compile(
    r"^\s*(?:а\s+)?(?P<item>[^.!?\r\n]+?)\s+можно\s*\??\s*$", re.IGNORECASE
)
# A request for a smoke is a request for a cigarette: "дай закурить" must not
# create an inventory item literally named "закурить".
_SMOKE_REQUEST_RE = re.compile(r"^(?:закурить|покурить|перекурить|затянуться)$", re.IGNORECASE)
# Players ask for things for themselves far more often than they name themselves.
# "дай мне подкову" must land in the author's inventory, not be ignored.
_SELF_REQUEST_RE = re.compile(
    r"\b(?:мне|меня|мной|мною|для\s+меня|мне\s+лично)\b", re.IGNORECASE
)
_OTHER_REQUEST_RE = re.compile(
    r"\b(?:ему|ей|им|них|нам|вам|себе|себя|собой|для\s+него|для\s+не[её])\b",
    re.IGNORECASE,
)
# "Дай мне руку" / "дай пять" are roleplay phrases, not item requests. Without
# this guard the self-request fallback would store a body part or an idiom.
_NON_ITEM_REQUESTS = {
    "рука", "руку", "руки", "ладошку", "ладонь", "плечо", "пять", "слово",
    "знать", "совет", "шанс", "минуту", "секунду", "дорогу", "место",
    "внимание", "ответ", "объяснение", "извинение", "прощение", "помощь",
    "подождать", "пройти", "выбор", "жизнь", "бог", "волю", "вопрос",
    "идея", "подсказка", "план", "пощёчина", "пощечина", "пинок", "удар",
    "затрещина", "подзатыльник", "оплеуха", "тычок", "укус", "поцелуй",
}
# "Что можно?" / "Дай что-нибудь" are not item names.
_NOT_A_THING_RE = re.compile(
    r"^(?:что|кто|как|где|когда|почему|зачем|куда|откуда|сколько|какой|какая|"
    r"какое|какие|чем|кого|чего|что-нибудь|что-то|ничего|поесть|попить|"
    r"перекусить|покурить)(?:\s|$)",
    re.IGNORECASE,
)
_CONTAINER_LOSS_RE = re.compile(
    r"\b(?:сж[её]г\w*|сжига\w*|подж[её]г\w*|сгор\w*|уничтож\w*|"
    r"украл\w*|крад\w*|стащ\w*|похит\w*|потер\w*|оброн\w*|утоп\w*|"
    r"ун[её]с\w*|исчез\w*|пропал\w*|разбил\w*|разорвал\w*)\b",
    re.IGNORECASE,
)
_CONTAINER_RE = re.compile(
    r"\b(?:рюкзак\w*|сумк\w*|мешк\w*|котомк\w*|вещмешк\w*|чемодан\w*|торб\w*|ранец\w*)\b",
    re.IGNORECASE,
)
_SELF_CONTAINER_RE = re.compile(
    r"\b(?:мой|моя|моё|моего|мою|мои|свой|своя|своё|своего|свою|свои|у меня)\b",
    re.IGNORECASE,
)


def _clean_item_name(name: str) -> str:
    name = re.sub(r"<[^>]*>", "", str(name or ""))
    name = " ".join(name.split()).strip(" \t\r\n.,;:!?\"'«»“”-")
    name = re.sub(r"[^\w\s'’()\-]", "", name, flags=re.UNICODE)
    return " ".join(name.split())[:_MAX_ITEM_NAME].strip()


def _nominative_item(name: str) -> str:
    """Best-effort nominative for a single-word item written in the accusative.

    Requests ("дай мне подкову") and pickups ("беру подкову") would otherwise
    store the item as "подкову". Only one-word feminine forms are touched, so
    multi-word names and masculine nouns are left as written.
    """
    words = str(name or "").split()
    if len(words) != 1:
        return name
    word = words[0]
    if (
        len(word) >= 5
        and word[-1] == "у"
        and word[-2] not in "аеёиоуыэюяьъй"
    ):
        return word[:-1] + "а"
    return name


def extract_take_intent(user_text: str) -> str | None:
    """Return an explicitly picked-up item from a direct player action."""
    text = re.sub(r"\*", "", str(user_text or ""))
    text = re.sub(r"^\s*\[[^\]]{1,80}\]\s*:?\s*", "", text)
    text = re.sub(r"^\s*[^:\n]{1,60}:\s*", "", text)
    # "Можно я возьму X?" is the same explicit pickup as "я беру X".
    text = re.sub(r"^\s*(?:а\s+)?можно\s+(?:мне\s+)?", "", text, flags=re.IGNORECASE)
    match = _TAKE_INTENT_RE.match(text)
    if not match:
        return None
    item = _PICKUP_PREFIX_RE.sub("", match.group(1))
    item = _PICKUP_LOCATION_RE.sub("", item)
    item = _PICKUP_TAIL_RE.sub("", item)
    item = _nominative_item(_clean_item_name(item))
    return item if len(item) >= 2 else None


def _word_stem(word: str) -> str:
    word = word.casefold().replace("ё", "е")
    for ending in sorted(set(_RU_ENDINGS), key=len, reverse=True):
        if len(word) - len(ending) >= 3 and word.endswith(ending):
            return word[:-len(ending)]
    return word


# Diminutives and case forms of the same thing must match: a player who asks
# for «сигарету» and receives «сигаретку» owns one cigarette, not two items.
_ITEM_WORD_CANON = {
    "сигаретк": "сигарет",
    "сигареточк": "сигарет",
    "сигаретин": "сигарет",
    "сигарет": "сигарет",
    "папироск": "папирос",
    "папиросочк": "папирос",
}


def _canon_item_word(word: str) -> str:
    stem = _word_stem(word)
    return _ITEM_WORD_CANON.get(stem, stem)


def _member_token(word: str) -> str:
    # Speech recognition and informal spelling often confuse и/ы in names.
    return _word_stem(word).replace("ё", "е").replace("ы", "и")


def _phrase_key(text: str) -> str:
    """Stem every word so multi-word nicknames match in any case form."""
    return " ".join(
        _member_token(word) for word in _ITEM_WORD_RE.findall(str(text or ""))
    )


def _latin_key(token: str) -> str:
    """Rough Cyrillic/Latin normalization: «Палкину» and «Palkin» share a key."""
    token = str(token or "").casefold().replace("ё", "е")
    latin = "".join(_TRANSLIT_MAP.get(char, char) for char in token)
    latin = latin.replace("sch", "sh").replace("kh", "h").replace("ph", "f")
    latin = latin.replace("x", "ks").replace("j", "i").replace("y", "i")
    latin = latin.replace("w", "v").replace("q", "k").replace("ch", "c").replace("ts", "c")
    return re.sub(r"(.)\1+", r"\1", latin)


def _unique_member(matches) -> tuple[int, str] | None:
    by_id = {}
    for user_id, name in matches:
        by_id[user_id] = name
    if len(by_id) != 1:
        return None
    user_id, name = next(iter(by_id.items()))
    return user_id, name


def remember_member(chat_id: int, user_id: int, name: str, username: str | None = None,
                    chat_title: str | None = None, chat_username: str | None = None,
                    is_private: bool | None = None) -> None:
    """Remember chat participants so natural-language gifts can target them.

    Group chats are also stored per player: the Mini App is opened in the bot's
    private chat, but the ``/use`` draft must land in the friends' group where
    the scene actually happens, not in the bot's private chat.
    """
    if not user_id:
        return
    display_name = str(name or username or user_id).strip()
    username = str(username or "").strip().lstrip("@")
    with _connect() as conn:
        conn.execute(
            "INSERT INTO chat_members (chat_id, user_id, display_name, username) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(chat_id, user_id) DO UPDATE SET display_name = excluded.display_name, "
            "username = CASE WHEN excluded.username != '' THEN excluded.username ELSE chat_members.username END",
            (int(chat_id), int(user_id), display_name, username),
        )
    _cache_member(int(chat_id), int(user_id), display_name, username)
    if is_private is None:
        is_private = int(chat_id) > 0
    if not is_private:
        remember_chat(chat_id, user_id, chat_title, chat_username)


def remember_chat(chat_id: int, user_id: int, title: str | None = None,
                  username: str | None = None) -> None:
    """Store the last group chat this player wrote in."""
    if not user_id or int(chat_id) > 0:
        return
    with _connect() as conn:
        conn.execute(
            "INSERT INTO chat_targets (user_id, chat_id, title, username, updated_at) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(user_id, chat_id) DO UPDATE SET "
            "title = CASE WHEN excluded.title != '' THEN excluded.title ELSE chat_targets.title END, "
            "username = CASE WHEN excluded.username != '' THEN excluded.username ELSE chat_targets.username END, "
            "updated_at = excluded.updated_at",
            (
                int(user_id), int(chat_id), str(title or "").strip(),
                str(username or "").strip().lstrip("@"), int(time.time()),
            ),
        )


def list_group_chats(user_id: int) -> list[dict]:
    """Group chats this player wrote in, most recent first."""
    if not user_id:
        return []
    with _connect() as conn:
        rows = conn.execute(
            "SELECT chat_id, title, username FROM chat_targets "
            "WHERE user_id = ? ORDER BY updated_at DESC",
            (int(user_id),),
        ).fetchall()
    return [
        {"chat_id": int(chat_id), "title": title or "", "username": username or ""}
        for chat_id, title, username in rows
    ]


def get_last_group_chat(user_id: int) -> dict | None:
    """Most recently used group chat of this player, for Mini App drafts."""
    chats = list_group_chats(user_id)
    return chats[0] if chats else None


def is_known_member(chat_id: int, user_id: int) -> bool:
    """Check whether the authenticated user has been seen in this chat."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?",
            (int(chat_id), int(user_id)),
        ).fetchone()
    return row is not None


def _alias_names_for_username(username: str) -> tuple[str, ...]:
    """Nicknames bound to a Telegram username in ``_GROUP_MEMBER_ALIASES``.

    The mapping is written by hand, so it also tolerates the common case where
    the username grew a digit or a suffix since then: "dgyip" and "dgyip1"
    must both reach the same person.
    """
    key = str(username or "").strip().lstrip("@").casefold()
    if not key:
        return ()
    names = list(_GROUP_MEMBER_ALIASES.get(key, ()))
    if names:
        return tuple(names)
    for known_key, known_names in _GROUP_MEMBER_ALIASES.items():
        if len(key) >= 4 and len(known_key) >= 4 and (
            known_key.startswith(key) or key.startswith(known_key)
        ):
            names.extend(known_names)
    return tuple(names)


def _add_to_bucket(bucket: dict, user_id: int, name: str, username: str | None = None) -> None:
    aliases = [name, username, f"@{username}" if username else None]
    aliases.extend(_alias_names_for_username(username))
    for alias in aliases:
        clean = str(alias or "").strip().lstrip("@").casefold()
        if clean:
            display_name = str(name or alias).strip() or clean
            bucket.setdefault(clean, {})[int(user_id)] = display_name
            phrase_key = _phrase_key(clean)
            if phrase_key and phrase_key != clean:
                bucket.setdefault(phrase_key, {})[int(user_id)] = display_name
            latin_alias = _latin_key(clean)
            if latin_alias != clean and len(latin_alias) >= 3:
                bucket.setdefault(latin_alias, {})[int(user_id)] = display_name
            for word in _ITEM_WORD_RE.findall(clean):
                stem = _member_token(word)
                if len(stem) >= 3:
                    bucket.setdefault(stem, {})[int(user_id)] = display_name
                    latin_stem = _latin_key(stem)
                    if latin_stem != stem and len(latin_stem) >= 3:
                        bucket.setdefault(latin_stem, {})[int(user_id)] = display_name


_KNOWN_MEMBERS_GLOBAL: dict[str, dict[int, str]] = {}
_GLOBAL_MEMBERS_LOADED = False


def _cache_member(chat_id: int, user_id: int, name: str, username: str | None = None) -> None:
    _add_to_bucket(_KNOWN_MEMBERS.setdefault(int(chat_id), {}), user_id, name, username)
    # The same person is the same person in every chat: a nickname decoded from
    # a username must keep working when the request comes from another group or
    # from the bot's private chat.
    _add_to_bucket(_KNOWN_MEMBERS_GLOBAL, user_id, name, username)


def _global_member_bucket() -> dict[str, dict[int, str]]:
    """Participants seen by the bot in any chat, keyed by every known alias."""
    global _GLOBAL_MEMBERS_LOADED
    if not _GLOBAL_MEMBERS_LOADED:
        try:
            with _connect() as conn:
                rows = conn.execute(
                    "SELECT user_id, display_name, username FROM chat_members"
                ).fetchall()
        except Exception:
            rows = []
        for user_id, name, username in rows:
            _add_to_bucket(_KNOWN_MEMBERS_GLOBAL, user_id, name, username)
        _GLOBAL_MEMBERS_LOADED = True
    return _KNOWN_MEMBERS_GLOBAL


def _match_bucket(bucket: dict[str, dict[int, str]], reference: str) -> tuple[int, str] | None:
    direct = bucket.get(reference)
    if direct:
        resolved = _unique_member(direct.items())
        if resolved:
            return resolved
    phrase = _phrase_key(reference)
    if phrase and phrase != reference:
        direct_phrase = bucket.get(phrase)
        if direct_phrase:
            resolved = _unique_member(direct_phrase.items())
            if resolved:
                return resolved
    if len(_ITEM_WORD_RE.findall(reference)) > 1:
        # Multi-word references are matched only as a whole (see the phrase key
        # above). Prefix/typo heuristics would otherwise eat the item name:
        # "Аледроку подкову" would resolve entirely to Аледрок.
        return None
    stem = _member_token(reference)
    candidates = {stem, _latin_key(stem)}
    # A remaining final vowel commonly distinguishes case forms of Russian
    # names (e.g. "Алексею" -> "алекс", "Андрея" -> "андр").
    if len(stem) >= 4 and stem[-1] in "аеёиоуыэюя":
        shortened = _member_token(stem[:-1])
        candidates.add(shortened)
        candidates.add(_latin_key(shortened))
    for candidate in candidates:
        direct_stem = bucket.get(candidate)
        if direct_stem:
            resolved = _unique_member(direct_stem.items())
            if resolved:
                return resolved
    # Names in a request often appear in a grammatical case while Telegram
    # gives us the nominative form.
    prefix_matches = [
        (user_id, name)
        for alias, members in bucket.items()
        if any(
            len(alias) >= 4 and len(candidate) >= 4
            and (alias.startswith(candidate) or candidate.startswith(alias))
            for candidate in candidates
        )
        for user_id, name in members.items()
    ]
    resolved = _unique_member(prefix_matches)
    if resolved:
        return resolved

    # Allow a single typo in longer names, but reject ambiguous matches.
    matches = []
    for alias, members in bucket.items():
        if len(alias) < 5:
            continue
        for candidate in candidates:
            if len(candidate) < 5 or abs(len(alias) - len(candidate)) > 1:
                continue
            if len(alias) == len(candidate):
                close = sum(a != b for a, b in zip(alias, candidate)) <= 1
            else:
                shorter, longer = sorted((alias, candidate), key=len)
                i = j = edits = 0
                while i < len(shorter) and j < len(longer):
                    if shorter[i] == longer[j]:
                        i += 1
                        j += 1
                    else:
                        edits += 1
                        j += 1
                        if edits > 1:
                            break
                close = edits <= 1
            if close:
                matches.extend(members.items())
                break
    return _unique_member(matches)


def resolve_member(chat_id: int, reference: str) -> tuple[int, str] | None:
    reference = str(reference or "").strip().lstrip("@").casefold()
    if not reference:
        return None
    bucket = _KNOWN_MEMBERS.setdefault(int(chat_id), {})
    with _connect() as conn:
        rows = conn.execute(
            "SELECT user_id, display_name, username FROM chat_members WHERE chat_id = ?",
            (int(chat_id),),
        ).fetchall()
    for user_id, name, username in rows:
        _cache_member(chat_id, user_id, name, username)
    resolved = _match_bucket(bucket, reference)
    if resolved:
        return resolved
    # The nickname may be decoded from a username while its owner only ever
    # wrote in another chat (the bot's private chat or a different group).
    # He is still the same participant, so the gift must reach him.
    return _match_bucket(_global_member_bucket(), reference)


def extract_give_intent(chat_id: int, user_text: str, requester_id: int | None = None,
                        requester_name: str | None = None) -> dict | None:
    """Parse an explicit request such as 'дай Палкину фонарь' or 'дай мне подкову'.

    ``requester_id`` lets a request for the author themselves ("дай мне X",
    "дай X") resolve to that author instead of being dropped as an unknown
    recipient.
    """
    text = re.sub(r"^\s*\[[^\]]{1,100}\]\s*:??\s*", "", str(user_text or ""))
    # Messages arrive as "Palkin: дай сигарету"; the polite "есть ...?" form is
    # anchored, so the speaker label must go first.
    text = re.sub(r"^\s*[^:\n]{1,60}:\s*", "", text)
    if requester_id is not None and extract_take_intent(text):
        # "Можно мне взять подкову?" is a pickup, not a give request.
        return None
    match = _GIVE_RE.search(text)
    if match:
        rest = match.group("rest").strip()
        verb = match.group("verb").casefold()
        # "Можно сигарету?" is a question, not an order: it still needs the
        # character to confirm the handover in the scene.
        direct = verb != "можно"
    else:
        # "Есть сигаретка?" / "Найдётся закурить?" / "Сигарету можно?" are
        # polite requests too.
        have = _HAVE_ITEM_RE.match(text) or _CAN_I_ITEM_RE.match(text)
        if not have or requester_id is None:
            return None
        rest = (have.groupdict().get("rest") or have.groupdict().get("item") or "").strip()
        verb = ""
        direct = False
    # "дай мне подкову, я её возьму" / "дай мне подкову, пожалуйста" — the
    # clause after the comma is not part of the item name.
    rest = re.split(r"[,;]", rest, maxsplit=1)[0].strip()
    tokens = list(_ITEM_WORD_RE.finditer(rest))
    recipient = None
    recipient_span = None
    explicit = False
    # Full names such as "Данила Туев" must be consumed as one recipient,
    # otherwise the surname is left behind and becomes part of the item name.
    for size in (3, 2, 1):
        if size > len(tokens):
            continue
        for start in range(len(tokens) - size + 1):
            span = tokens[start:start + size]
            candidate = resolve_member(chat_id, rest[span[0].start():span[-1].end()])
            if candidate:
                recipient = candidate
                recipient_span = (span[0].start(), span[-1].end())
                explicit = True
                break
        if recipient:
            break
    if not recipient and requester_id is not None:
        self_match = _SELF_REQUEST_RE.search(rest)
        if self_match:
            recipient = (int(requester_id), str(requester_name or "Игрок"))
            recipient_span = (self_match.start(), self_match.end())
            explicit = True
        else:
            # "дай ему подкову" names someone the bot cannot map to a chat
            # member: guessing the author would give the item to the wrong person.
            # "Можно сигарету?" without "мне" is the same request for oneself.
            if _OTHER_REQUEST_RE.search(rest):
                return None
            first = tokens[0].group(0) if tokens else ""
            if direct and first[:1].isupper():
                # "Дай Морозу подкову": looks like a person's name, not an item.
                # In "Сигарету можно?" the capital is just the sentence start.
                return None
            # "Дай подкову" / "выдай фонарь" — the player asks for themselves.
            recipient = (int(requester_id), str(requester_name or "Игрок"))
            recipient_span = (0, 0)
    if not recipient:
        return None
    item = rest[:recipient_span[0]] + " " + rest[recipient_span[1]:]
    item = re.sub(
        r"\b(?:мне|меня|мной|мною|ему|ей|им|для|пожалуйста|же|ка|"
        r"в\s+инвентарь|инвентар[ьяею]|вещь|предмет)\b",
        " ", item, flags=re.IGNORECASE,
    )
    item = _clean_item_name(item)
    if len(item) < 2:
        return None
    item = _nominative_item(item)
    # "дай закурить" и «сигаретку» — это одна сигарета, а не предмет с таким
    # названием: иначе в инвентаре появляется мусорная строка.
    if _SMOKE_REQUEST_RE.match(item) or (
        len(item.split()) == 1 and _canon_item_word(item) == "сигарет"
    ):
        item = "сигарета"
    if item.split()[0].casefold() in _NON_ITEM_REQUESTS or _NOT_A_THING_RE.match(item):
        return None
    return {
        "user_id": recipient[0],
        "name": recipient[1],
        "item": item,
        "self": requester_id is not None and recipient[0] == int(requester_id),
        "explicit": explicit,
        # Imperative requests ("дай", "угости") are honoured even when the model
        # forgets to repeat the item name in its one-line answer.
        "direct": direct,
    }


def extract_gives(text: str) -> list[dict]:
    return [
        {"recipient": _clean_item_name(m.group(1)), "item": _clean_item_name(m.group(2))}
        for m in _ITEM_GIVE_RE.finditer(text or "")
        if len(_clean_item_name(m.group(1))) >= 2 and len(_clean_item_name(m.group(2))) >= 2
    ][:1]


def extract_handover_target(chat_id: int, text: str, item_name: str) -> tuple[int, str] | None:
    """Find the participant the character hands ``item_name`` to in its reply.

    The model does not always emit ``ITEM_GIVE``: it may describe a handover
    and tag the item with ``ITEM_ADD`` instead. In that case the item would be
    credited to the player who triggered the answer rather than to the person
    named in the scene. Only names that follow a first-person handover verb are
    considered, so the actor ("Кирилл отдал мне подкову") is never mistaken for
    the recipient.
    """
    clean = strip_change_markers(text or "")
    if not response_mentions_item(clean, item_name):
        return None
    for sentence in re.split(r"(?<=[.!?])\s+|[\r\n]+", clean):
        if not response_mentions_item(sentence, item_name):
            continue
        verbs = list(_GIFT_HANDOVER_RE.finditer(sentence))
        for index, verb in enumerate(verbs):
            segment_end = verbs[index + 1].start() if index + 1 < len(verbs) else len(sentence)
            segment = sentence[verb.end():segment_end]
            if not response_mentions_item(segment, item_name):
                continue
            if _HANDOVER_BLOCKER_RE.search(sentence[:verb.start()]):
                # "я не отдаю", "пока не отдал" — the handover did not happen.
                continue
            if _SPEAKER_OBJECT_RE.search(segment):
                # "протягиваю мне", "отдаю ему" — the addressee is a pronoun,
                # not a named participant.
                continue
            for token in _ITEM_WORD_RE.finditer(segment):
                member = resolve_member(chat_id, token.group(0))
                if member:
                    return member
    return None


def player_receives_item(chat_id: int, text: str, item_name: str,
                         player_id: int | None = None) -> bool:
    """Whether the reply clearly hands ``item_name`` to the player.

    Used as a safety net for direct requests ("дай мне подкову"): the model
    often narrates the handover but forgets the hidden ITEM_ADD marker. Only
    affirmative handover phrases count, and a handover to another named
    participant is ignored.
    """
    clean = strip_change_markers(text or "")
    if not response_mentions_item(clean, item_name):
        return False
    if give_was_denied(clean, item_name):
        return False
    for sentence in re.split(r"(?<=[.!?])\s+|[\r\n]+", clean):
        if not response_mentions_item(sentence, item_name):
            continue
        verbs = list(_PLAYER_RECEIVE_RE.finditer(sentence))
        for index, verb in enumerate(verbs):
            segment_end = verbs[index + 1].start() if index + 1 < len(verbs) else len(sentence)
            segment = sentence[verb.end():segment_end]
            if not response_mentions_item(segment, item_name):
                continue
            if _HANDOVER_BLOCKER_RE.search(sentence[:verb.start()]):
                continue
            if any(
                (member := resolve_member(chat_id, token.group(0)))
                and (player_id is None or member[0] != int(player_id))
                for token in _ITEM_WORD_RE.finditer(segment)
            ):
                # "протягиваю подкову Даниле" — someone else is the recipient.
                continue
            return True
    return False


def clear_inventory(chat_id: int, user_id: int) -> list[dict]:
    """Remove all carried items after the container holding them is lost."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT item_name, quantity FROM inventory WHERE chat_id = ? AND user_id = ?",
            (int(chat_id), int(user_id)),
        ).fetchall()
        conn.execute(
            "DELETE FROM inventory WHERE chat_id = ? AND user_id = ?",
            (int(chat_id), int(user_id)),
        )
    return [{"name": name, "quantity": quantity} for name, quantity in rows]


def _trim_item_copies(conn, user_id: int, name: str, target: int) -> None:
    """Bring every per-chat copy of an item down to ``target`` copies.

    An item may be mirrored into several chats. Removing or transferring one
    copy must lower all mirrors, otherwise the item reappears from the other
    chat as if it had never been spent.
    """
    rows = conn.execute(
        "SELECT chat_id, item_name, quantity FROM inventory WHERE user_id = ?",
        (int(user_id),),
    ).fetchall()
    for chat_id, item_name, quantity in rows:
        if int(quantity) <= target or not same_item_name(item_name, name):
            continue
        if target <= 0:
            conn.execute(
                "DELETE FROM inventory WHERE chat_id = ? AND user_id = ? AND item_name = ?",
                (int(chat_id), int(user_id), item_name),
            )
        else:
            conn.execute(
                "UPDATE inventory SET quantity = ? "
                "WHERE chat_id = ? AND user_id = ? AND item_name = ?",
                (int(target), int(chat_id), int(user_id), item_name),
            )


def give_item(chat_id: int, sender_id: int, recipient_id: int, name: str) -> str | None:
    """Transfer one copy atomically; leave both inventories untouched on failure."""
    name = _clean_item_name(name)
    if not name:
        return None
    if int(sender_id) == int(recipient_id):
        # A self-transfer used to delete the only copy: the source row was
        # deleted and the same row was then "incremented".
        return None
    with _connect() as conn:
        rows = conn.execute(
            "SELECT item_name, quantity FROM inventory WHERE chat_id = ? AND user_id = ?",
            (int(chat_id), int(sender_id)),
        ).fetchall()
        item = next((row for row in rows if same_item_name(row[0], name)), None)
        if not item:
            return None
        # The same thing can be mirrored into another chat; the transfer must
        # lower every mirror, not only the row of the current chat.
        logical_quantity = max(
            (
                int(quantity)
                for _, row_name, quantity in conn.execute(
                    "SELECT chat_id, item_name, quantity FROM inventory WHERE user_id = ?",
                    (int(sender_id),),
                ).fetchall()
                if same_item_name(row_name, item[0])
            ),
            default=int(item[1]),
        )
        recipient_rows = conn.execute(
            "SELECT item_name, quantity FROM inventory WHERE chat_id = ? AND user_id = ?",
            (int(chat_id), int(recipient_id)),
        ).fetchall()
        recipient_item = next((row for row in recipient_rows if same_item_name(row[0], item[0])), None)
        if recipient_item and recipient_item[1] >= _MAX_STACK:
            return None
        if not recipient_item and len(recipient_rows) >= _MAX_UNIQUE_ITEMS:
            return None

        if item[1] == 1:
            conn.execute(
                "DELETE FROM inventory WHERE chat_id = ? AND user_id = ? AND item_name = ?",
                (int(chat_id), int(sender_id), item[0]),
            )
        else:
            conn.execute(
                "UPDATE inventory SET quantity = quantity - 1 "
                "WHERE chat_id = ? AND user_id = ? AND item_name = ?",
                (int(chat_id), int(sender_id), item[0]),
            )
        if recipient_item:
            conn.execute(
                "UPDATE inventory SET quantity = quantity + 1 "
                "WHERE chat_id = ? AND user_id = ? AND item_name = ?",
                (int(chat_id), int(recipient_id), recipient_item[0]),
            )
        else:
            conn.execute(
                "INSERT INTO inventory (chat_id, user_id, item_name, quantity) VALUES (?, ?, ?, 1)",
                (int(chat_id), int(recipient_id), item[0]),
            )
        _trim_item_copies(conn, sender_id, item[0], logical_quantity - 1)
    return item[0]


def detect_container_loss(chat_id: int, sender_id: int, text: str) -> bool:
    """Detect an explicit loss of a player's backpack or bag."""
    return resolve_container_loss_target(chat_id, sender_id, text) is not None


def resolve_container_loss_target(chat_id: int, sender_id: int, text: str) -> tuple[int, str] | None:
    """Return the owner of a lost container, including a named participant."""
    clean = re.sub(r"^\s*\[[^\]]{1,100}\]\s*:??\s*", "", str(text or ""))
    for sentence in re.split(r"(?<=[.!?])\s+|[\r\n]+", clean):
        container = _CONTAINER_RE.search(sentence)
        if not container or not _CONTAINER_LOSS_RE.search(sentence):
            continue
        before = sentence[max(0, container.start() - 35):container.start()]
        if _SELF_CONTAINER_RE.search(before) and not re.search(
            r"\b(?:его|её|их|ему|ей|им)\b", before, re.IGNORECASE
        ):
            return int(sender_id), ""

        # Resolve the named owner after the container first ("рюкзак Кирилла").
        tokens = list(_ITEM_WORD_RE.finditer(sentence))
        for token in tokens:
            if token.start() > container.end():
                member = resolve_member(chat_id, token.group(0))
                if member:
                    return member

        # Also support dative order ("сжёг Кириллу рюкзак"). Only inspect the
        # words between the loss verb and container, not the named actor.
        loss = _CONTAINER_LOSS_RE.search(sentence)
        between = sentence[loss.end():container.start()] if loss.end() <= container.start() else ""
        between = re.sub(r"^\s*\w+", " ", between, count=1)
        between_tokens = list(_ITEM_WORD_RE.finditer(between))
        for token in reversed(between_tokens):
            member = resolve_member(chat_id, token.group(0))
            if member:
                return member

        explicit_other = re.search(
            r"\b(?:его|её|их|ему|ей|им|твой|твоего|чужой)\b", sentence, re.IGNORECASE
        )
        has_owner_text = any(token.start() > container.end() for token in tokens) or bool(between_tokens)
        if explicit_other or has_owner_text:
            continue

        # A bare "рюкзак сгорел" in a player-directed action belongs to sender.
        if not explicit_other:
            return int(sender_id), ""
    return None


def was_offered_in_history(item_name: str, messages: list[dict]) -> bool:
    """Only allow a direct pickup if the assistant previously placed/offered it."""
    words = _ITEM_WORD_RE.findall(item_name or "")
    if not words:
        return False
    target = _word_stem(words[-1])
    # The latest message is the player's pickup request; inspect earlier assistant
    # turns only, so a request itself cannot conjure the item into the scene.
    for message in (messages or [])[:-1]:
        if message.get("role") != "assistant":
            continue
        content = message.get("content", "")
        if not isinstance(content, str):
            continue
        if any(_word_stem(word) == target for word in _ITEM_WORD_RE.findall(content)):
            return True
    return False


def response_mentions_item(text: str, item_name: str) -> bool:
    wanted = [_word_stem(word) for word in _ITEM_WORD_RE.findall(item_name or "")]
    if not wanted:
        return False
    response_words = {_word_stem(word) for word in _ITEM_WORD_RE.findall(strip_change_markers(text or ""))}
    return any(word in response_words for word in wanted)


def take_was_denied(text: str, item_name: str) -> bool:
    """Treat an explicit in-scene refusal/unavailability as overriding pickup intent."""
    wanted = {_word_stem(word) for word in _ITEM_WORD_RE.findall(item_name or "")}
    if not wanted:
        return False
    clean_text = strip_change_markers(text or "")
    sentences = re.split(r"(?<=[.!?])\s+|[\r\n]+", clean_text)
    for sentence in sentences:
        mentioned = {_word_stem(word) for word in _ITEM_WORD_RE.findall(sentence)}
        if not wanted & mentioned:
            continue
        if any(pattern.search(sentence) for pattern in _TAKE_DENIAL_PATTERNS):
            return True
        # Catch common replies such as "пирога нет" / "нет пирога", but not
        # "Нет, пирог твой — бери", where the comma makes "нет" an answer particle.
        no_match = re.search(r"\bнет\b", sentence, re.IGNORECASE)
        if no_match:
            before_no = sentence[:no_match.start()]
            after_no = sentence[no_match.end():].lstrip()
            if before_no.strip() or not after_no.startswith(","):
                return True
    return False


def give_was_denied(text: str, item_name: str) -> bool:
    """Respect an explicit refusal instead of forcing a requested gift."""
    clean_text = strip_change_markers(text or "")
    wanted = {_word_stem(word) for word in _ITEM_WORD_RE.findall(item_name or "")}
    handover_cue = re.compile(
        r"\b(?:держи(?:те)?|возьми(?:те)?|забирай(?:те)?|бери(?:те)?|"
        r"протягива\w*|протянул\w*|даю|дал[аи]?|вруча\w*|отдаю|дарю|"
        r"достаю|вынимаю|вытаскиваю)\b",
        re.IGNORECASE,
    )
    for sentence in re.split(r"(?<=[.!?])\s+|[\r\n]+", clean_text):
        no_transfer_available = any(pattern.search(sentence) for pattern in _NO_TRANSFER_PATTERNS)
        denied = no_transfer_available or any(
            pattern.search(sentence) for pattern in _GIVE_DENIAL_PATTERNS
        )
        # "Сигарет нет" / "Нет сигарет" is a refusal too, but "Нет, держи"
        # is an answer particle followed by a handover.
        if not denied:
            for no_word in re.finditer(
                r"\b(?:нет|не\s+осталось|не\s+оказалось|закончил[аи]?сь)\b",
                sentence, re.IGNORECASE,
            ):
                before_no = sentence[:no_word.start()]
                after_no = sentence[no_word.end():].lstrip()
                if before_no.strip() or not after_no.startswith(","):
                    denied = True
                    break
        if not denied:
            continue
        mentioned = {_word_stem(word) for word in _ITEM_WORD_RE.findall(sentence)}
        if no_transfer_available or (wanted and wanted & mentioned):
            return True
        if any(
            re.search(pattern, sentence, re.IGNORECASE)
            for pattern in (
                r"не\s+(?:могу|буду|стану|хочу)\s+(?:дать|передать|отдать)",
                r"\bне\s+(?:дам|передам|отдам|вручу|подарю)\b",
            )
        ):
            return True
        # "У меня нет." / "Нет." without a positive handover is a refusal too.
        if not handover_cue.search(sentence):
            return True
    return False


def same_item_name(left: str, right: str) -> bool:
    """Compare full item names while allowing common Russian case endings."""
    left_words = [_canon_item_word(word) for word in _ITEM_WORD_RE.findall(left or "")]
    right_words = [_canon_item_word(word) for word in _ITEM_WORD_RE.findall(right or "")]
    return bool(left_words and right_words and left_words == right_words)


def same_item_head(left: str, right: str) -> bool:
    """Whether both names denote the same thing (same head noun).

    The model often decorates the item the player asked for: "дай мне меч" may
    be answered with ``ITEM_ADD: длинный меч``. Such variants must be treated
    as one sword, otherwise the same request adds two swords at once.
    """
    left_words = [_canon_item_word(word) for word in _ITEM_WORD_RE.findall(left or "")]
    right_words = [_canon_item_word(word) for word in _ITEM_WORD_RE.findall(right or "")]
    if not left_words or not right_words:
        return False
    # "меч" vs "длинный меч" is the same item; two different multi-word names
    # ("ключ от машины" vs "гаечный ключ") must stay distinct.
    if len(left_words) > 1 and len(right_words) > 1:
        return False
    return left_words[-1] == right_words[-1]


def same_item(left: str, right: str) -> bool:
    return same_item_name(left, right) or same_item_head(left, right)


@contextmanager
def _connect():
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, timeout=10)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS inventory (
                chat_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                item_name TEXT NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
                PRIMARY KEY (chat_id, user_id, item_name)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_members (
                chat_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                display_name TEXT NOT NULL,
                username TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (chat_id, user_id)
            )
            """
        )
        # Миграция: добавляем колонки для механик вовлечённости (безопасно на существующей БД)
        for col_def in (
            "ALTER TABLE chat_members ADD COLUMN last_seen_date TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE chat_members ADD COLUMN last_reward_date TEXT NOT NULL DEFAULT ''",
        ):
            try:
                conn.execute(col_def)
            except Exception:
                pass  # колонка уже существует — игнорируем
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_targets (
                user_id INTEGER NOT NULL,
                chat_id INTEGER NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                username TEXT NOT NULL DEFAULT '',
                updated_at INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, chat_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS item_ideas (
                item_key TEXT PRIMARY KEY,
                item_name TEXT NOT NULL,
                ideas TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_styles (
                chat_id INTEGER PRIMARY KEY,
                prompt TEXT NOT NULL DEFAULT '',
                updated_at INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_voices (
                chat_id INTEGER PRIMARY KEY,
                preset TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 0,
                custom_audio_b64 TEXT NOT NULL DEFAULT '',
                custom_mime TEXT NOT NULL DEFAULT '',
                custom_transcript TEXT NOT NULL DEFAULT '',
                updated_at INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_archetypes (
                user_id INTEGER NOT NULL,
                archetype_key TEXT NOT NULL,
                name TEXT NOT NULL,
                prompt TEXT NOT NULL,
                is_builtin INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, archetype_key)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_preferences (
                user_id INTEGER PRIMARY KEY,
                selected_archetype TEXT NOT NULL DEFAULT ''
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS daily_recaps (
                chat_id INTEGER NOT NULL,
                recap_date TEXT NOT NULL,
                character_name TEXT NOT NULL,
                summary TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_titles (
                chat_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                granted_by TEXT NOT NULL DEFAULT '',
                granted_date TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (chat_id, user_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_stats (
                chat_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                messages_count INTEGER DEFAULT 0,
                items_collected INTEGER DEFAULT 0,
                lethal_strikes INTEGER DEFAULT 0,
                game_wins INTEGER DEFAULT 0,
                PRIMARY KEY (chat_id, user_id)
            )
            """
        )
        try:
            conn.execute("ALTER TABLE chat_stats ADD COLUMN game_wins INTEGER DEFAULT 0")
        except Exception:
            pass
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS game_scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id TEXT NOT NULL,
                game_name TEXT,
                user_id INTEGER NOT NULL,
                user_name TEXT NOT NULL,
                score INTEGER NOT NULL,
                chat_id INTEGER,
                played_at INTEGER NOT NULL,
                created_at INTEGER
            )
            """
        )
        for col_stmt in (
            "ALTER TABLE game_scores ADD COLUMN game_name TEXT",
            "ALTER TABLE game_scores ADD COLUMN created_at INTEGER",
        ):
            try:
                conn.execute(col_stmt)
            except Exception:
                pass
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS custom_archetypes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                desc TEXT NOT NULL,
                action TEXT NOT NULL DEFAULT '',
                created_by_user_id INTEGER NOT NULL,
                created_by_name TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_custom_archetypes_key
            ON custom_archetypes(key)
            """
        )
        # --- Экономика, Магазин и Турниры ---
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_economy (
                user_id INTEGER PRIMARY KEY,
                coins INTEGER NOT NULL DEFAULT 0,
                daily_streak INTEGER NOT NULL DEFAULT 0,
                last_daily_claim TEXT NOT NULL DEFAULT '',
                last_message_award INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_perks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                chat_id INTEGER,
                perk_id TEXT NOT NULL,
                extra_data TEXT NOT NULL DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1,
                purchased_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_mood_overrides (
                chat_id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL,
                mood_text TEXT NOT NULL,
                set_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS pending_roasts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                buyer_id INTEGER NOT NULL,
                target_user_id INTEGER NOT NULL,
                target_name TEXT NOT NULL,
                hint TEXT NOT NULL DEFAULT '',
                used INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS pending_pranks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                buyer_id INTEGER NOT NULL,
                target_user_id INTEGER NOT NULL,
                target_name TEXT NOT NULL,
                prank_type TEXT NOT NULL,
                extra_text TEXT NOT NULL DEFAULT '',
                used INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_mutes (
                chat_id INTEGER PRIMARY KEY,
                muted_by INTEGER NOT NULL,
                until_ts INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS weekly_tournaments (
                season_id TEXT PRIMARY KEY,
                week_number INTEGER NOT NULL,
                start_date TEXT NOT NULL,
                end_date TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tournament_scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                season_id TEXT NOT NULL,
                chat_id INTEGER,
                user_id INTEGER NOT NULL,
                user_name TEXT NOT NULL,
                points INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL,
                UNIQUE(season_id, chat_id, user_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_achievements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                achievement_id TEXT NOT NULL,
                unlocked_at INTEGER NOT NULL,
                claimed INTEGER NOT NULL DEFAULT 0,
                UNIQUE(user_id, achievement_id)
            )
            """
        )
        for col_stmt in (
            "ALTER TABLE user_economy ADD COLUMN total_spent INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE user_economy ADD COLUMN total_messages INTEGER NOT NULL DEFAULT 0",
        ):
            try:
                conn.execute(col_stmt)
            except Exception:
                pass
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def add_custom_archetype(user_id: int, user_name: str, title: str, desc: str, action: str = "") -> dict:
    """Генерирует уникальный ключ (custom_<hash/timestamp>), валидирует и сохраняет архетип в БД."""
    import unicodedata

    user_id = int(user_id)
    user_name = " ".join(str(user_name or "").split())[:64] or f"Игрок {user_id}"
    title = " ".join(str(title or "").split())[:80]
    desc = str(desc or "").strip()[:4000]
    action = str(action or "").strip()[:500]

    if not title:
        raise ValueError("Название архетипа обязательно")
    if not desc:
        raise ValueError("Описание архетипа обязательно")

    # Генерируем уникальный читаемый ключ custom_<slug>_<timestamp_or_hash>
    slug = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode().lower()
    slug = re.sub(r"[^a-z0-9]+", "_", slug).strip("_") or "custom"
    ts = int(time.time())
    suffix = f"{ts % 1000000:06d}_{abs(hash((user_id, title, desc, time.time()))) % 10000:04d}"
    key = f"custom_{slug[:30]}_{suffix}"[:64]

    # Если в desc ещё нет первого действия в формате *...*, но передано action - объединяем для prompt
    full_prompt = desc
    if action:
        cleaned_action = action.strip()
        if not (cleaned_action.startswith("*") and cleaned_action.endswith("*")):
            formatted_action = f"(*{cleaned_action.strip('*')}*)"
        else:
            formatted_action = cleaned_action
        if formatted_action not in full_prompt:
            full_prompt = f"{full_prompt}\n{formatted_action}"

    now = int(time.time())
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO custom_archetypes (key, title, desc, action, created_by_user_id, created_by_name, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (key, title, desc, action, user_id, user_name, now),
        )
        # Также для совместимости с user_archetypes / prompt синхронизацией
        conn.execute(
            """
            INSERT INTO user_archetypes (user_id, archetype_key, name, prompt, is_builtin)
            VALUES (?, ?, ?, ?, 0)
            ON CONFLICT(user_id, archetype_key) DO UPDATE SET name = excluded.name, prompt = excluded.prompt
            """,
            (user_id, key, title, full_prompt),
        )

    return {
        "key": key,
        "title": title,
        "name": title,
        "desc": desc,
        "action": action,
        "prompt": full_prompt,
        "created_by_user_id": user_id,
        "created_by_name": user_name,
        "created_at": now,
        "is_custom": True,
        "builtin": False,
    }


def delete_custom_archetype(archetype_key: str, user_id: int | None = None) -> bool:
    """Удаляет пользовательский архетип из БД. Если передан user_id, разрешает удалять только автору."""
    archetype_key = str(archetype_key or "").strip()
    if not archetype_key:
        return False

    with _connect() as conn:
        # Защита базовых системных архетипов: архетип должен существовать в custom_archetypes
        row = conn.execute(
            "SELECT created_by_user_id FROM custom_archetypes WHERE key = ?",
            (archetype_key,),
        ).fetchone()

        if not row:
            # Возможно, старая запись в user_archetypes
            u_row = conn.execute(
                "SELECT user_id FROM user_archetypes WHERE archetype_key = ? AND is_builtin = 0",
                (archetype_key,),
            ).fetchone()
            if not u_row:
                return False
            creator_id = u_row[0]
        else:
            creator_id = row[0]

        if user_id is not None and int(user_id) != int(creator_id):
            return False

        conn.execute("DELETE FROM custom_archetypes WHERE key = ?", (archetype_key,))
        conn.execute("DELETE FROM user_archetypes WHERE archetype_key = ?", (archetype_key,))
        conn.execute(
            "UPDATE user_preferences SET selected_archetype = '' WHERE selected_archetype = ?",
            (archetype_key,),
        )
        return True


def get_custom_archetypes() -> list[dict]:
    """Возвращает список всех кастомных архетипов от игроков."""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, key, title, desc, action, created_by_user_id, created_by_name, created_at
            FROM custom_archetypes
            ORDER BY id DESC
            """
        ).fetchall()

    results = []
    for r in rows:
        cid, key, title, desc, action, user_id, user_name, created_at = r
        full_prompt = desc
        if action:
            act_clean = action.strip()
            if not (act_clean.startswith("*") and act_clean.endswith("*")):
                act_fmt = f"(*{act_clean.strip('*')}*)"
            else:
                act_fmt = act_clean
            if act_fmt not in full_prompt:
                full_prompt = f"{full_prompt}\n{act_fmt}"
        results.append({
            "id": cid,
            "key": key,
            "title": title,
            "name": title,
            "desc": desc,
            "action": action,
            "prompt": full_prompt,
            "created_by_user_id": user_id,
            "created_by_name": user_name,
            "created_at": created_at,
            "is_custom": True,
            "builtin": False,
        })
    return results


def list_user_archetypes(user_id: int) -> list[dict]:
    from archetypes import BASE_ARCHETYPES, DEFAULT_ARCHETYPES

    builtins = dict(DEFAULT_ARCHETYPES)
    for key, value in BASE_ARCHETYPES.items():
        if isinstance(value, str):
            builtins[key] = (key.capitalize(), value)
        elif isinstance(value, (tuple, list)) and len(value) >= 2:
            builtins[key] = (value[0], value[1])

    items = [
        {
            "key": key,
            "name": value[0],
            "title": value[0],
            "prompt": value[1],
            "desc": value[1],
            "action": "",
            "builtin": True,
            "is_custom": False,
            "created_by_user_id": 0,
            "created_by_name": "Система",
        }
        for key, value in builtins.items()
    ]

    # Добавляем все пользовательские архетипы
    customs = get_custom_archetypes()
    known_keys = {item["key"] for item in items}
    for c in customs:
        if c["key"] not in known_keys:
            items.append(c)
            known_keys.add(c["key"])

    # Также проверим старые записи в user_archetypes для обратной совместимости
    with _connect() as conn:
        old_rows = conn.execute(
            "SELECT archetype_key, name, prompt, user_id FROM user_archetypes WHERE is_builtin = 0",
        ).fetchall()
        for key, name, prompt, uid in old_rows:
            if key not in known_keys:
                items.append({
                    "key": key,
                    "name": name,
                    "title": name,
                    "prompt": prompt,
                    "desc": prompt,
                    "action": "",
                    "builtin": False,
                    "is_custom": True,
                    "created_by_user_id": uid,
                    "created_by_name": f"Игрок {uid}",
                })
                known_keys.add(key)

    return items


def get_user_archetype(user_id: int, key: str) -> dict | None:
    return next((item for item in list_user_archetypes(user_id) if item["key"] == key), None)


def create_user_archetype(user_id: int, name: str, prompt: str) -> dict:
    return add_custom_archetype(user_id=user_id, user_name="", title=name, desc=prompt, action="")


def delete_user_archetype(user_id: int, key: str) -> bool:
    return delete_custom_archetype(archetype_key=key, user_id=user_id)


def get_selected_archetype(user_id: int) -> str:
    with _connect() as conn:
        row = conn.execute(
            "SELECT selected_archetype FROM user_preferences WHERE user_id = ?",
            (int(user_id),),
        ).fetchone()
    return row[0] if row else ""


def select_user_archetype(user_id: int, key: str) -> dict:
    archetype = get_user_archetype(user_id, key)
    if not archetype:
        raise ValueError("Архетип не найден")
    with _connect() as conn:
        conn.execute(
            "INSERT INTO user_preferences (user_id, selected_archetype) VALUES (?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET selected_archetype = excluded.selected_archetype",
            (int(user_id), str(key)),
        )
    return archetype


def _merge_item_rows(rows) -> list[dict]:
    """Collapse per-chat copies of one item into a single row.

    ``merge_missing_items`` mirrors an item into a chat so the scene prompt
    knows the player carries it. Those rows are views of the same thing, not
    extra copies: two rows with one cigarette each mean one cigarette, not two.
    """
    merged: list[dict] = []
    for name, quantity in rows:
        entry = next(
            (item for item in merged if same_item_name(item["name"], name)), None
        )
        if entry is None:
            merged.append({"name": name, "quantity": int(quantity)})
        elif int(quantity) > entry["quantity"]:
            entry["quantity"] = int(quantity)
    merged.sort(key=lambda item: item["name"].casefold())
    return merged


def get_items_anywhere(user_id: int) -> list[dict]:
    """All items a player owns across every chat, merged by name.

    This backs the player view: the same person can pick something up in a
    group and then open the Mini App from the bot's private chat, where the
    group context is unknown. The Mini App must still show what /inv showed.
    """
    with _connect() as conn:
        rows = conn.execute(
            "SELECT item_name, quantity FROM inventory WHERE user_id = ?",
            (int(user_id),),
        ).fetchall()
    return _merge_item_rows(rows)


def save_chat_style(chat_id: int, prompt: str) -> None:
    """Persist the player's style wishes so a restart does not forget them."""
    prompt = str(prompt or "").strip()[:4000]
    with _connect() as conn:
        if not prompt:
            conn.execute("DELETE FROM chat_styles WHERE chat_id = ?", (int(chat_id),))
            return
        conn.execute(
            "INSERT INTO chat_styles (chat_id, prompt, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(chat_id) DO UPDATE SET prompt = excluded.prompt, "
            "updated_at = excluded.updated_at",
            (int(chat_id), prompt, int(time.time())),
        )


def get_chat_style(chat_id: int) -> str:
    with _connect() as conn:
        row = conn.execute(
            "SELECT prompt FROM chat_styles WHERE chat_id = ?", (int(chat_id),)
        ).fetchone()
    return row[0] if row else ""


def save_chat_voice(chat_id: int, preset: str = "", enabled: bool | None = None,
                    custom_audio_b64: str = "", custom_mime: str = "",
                    custom_transcript: str = "") -> None:
    """Сохраняет настройки голоса для чата (пресет или кастомный образец, статус вкл/выкл)."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT preset, enabled, custom_audio_b64, custom_mime, custom_transcript "
            "FROM chat_voices WHERE chat_id = ?", (int(chat_id),)
        ).fetchone()

        cur_preset = row[0] if row else ""
        cur_enabled = bool(row[1]) if row else False
        cur_b64 = row[2] if row else ""
        cur_mime = row[3] if row else ""
        cur_transcript = row[4] if row else ""

        new_preset = preset if preset != "" else cur_preset
        new_enabled = int(enabled if enabled is not None else cur_enabled)
        new_b64 = custom_audio_b64 if custom_audio_b64 != "" else cur_b64
        new_mime = custom_mime if custom_mime != "" else cur_mime
        new_transcript = custom_transcript if custom_transcript != "" else cur_transcript

        conn.execute(
            "INSERT INTO chat_voices (chat_id, preset, enabled, custom_audio_b64, custom_mime, custom_transcript, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(chat_id) DO UPDATE SET "
            "preset = excluded.preset, "
            "enabled = excluded.enabled, "
            "custom_audio_b64 = excluded.custom_audio_b64, "
            "custom_mime = excluded.custom_mime, "
            "custom_transcript = excluded.custom_transcript, "
            "updated_at = excluded.updated_at",
            (int(chat_id), new_preset, new_enabled, new_b64, new_mime, new_transcript, int(time.time())),
        )


def load_chat_voice(chat_id: int) -> dict | None:
    """Загружает настройки голоса чата из БД."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT preset, enabled, custom_audio_b64, custom_mime, custom_transcript "
            "FROM chat_voices WHERE chat_id = ?", (int(chat_id),)
        ).fetchone()
    if not row:
        return None
    return {
        "preset": row[0] or "",
        "enabled": bool(row[1]),
        "custom_audio_b64": row[2] or "",
        "custom_mime": row[3] or "",
        "custom_transcript": row[4] or "",
    }



def _idea_key(name: str) -> str:
    return " ".join(_word_stem(word) for word in _ITEM_WORD_RE.findall(name or ""))


def get_item_ideas(name: str) -> list[str] | None:
    """Cached "what can I do with this item" examples for the Mini App."""
    key = _idea_key(name)
    if not key:
        return None
    with _connect() as conn:
        row = conn.execute(
            "SELECT ideas FROM item_ideas WHERE item_key = ?", (key,)
        ).fetchone()
    if not row:
        return None
    ideas = [line.strip() for line in str(row[0]).split("\n") if line.strip()]
    return ideas or None


def save_item_ideas(name: str, ideas) -> None:
    key = _idea_key(name)
    clean = []
    for idea in ideas or []:
        text = " ".join(str(idea).split()).strip(" .;:,-—!?\"'«»")
        if 2 <= len(text) <= 80 and text.casefold() not in {item.casefold() for item in clean}:
            clean.append(text)
    clean = clean[:3]
    if not key or not clean:
        return
    with _connect() as conn:
        conn.execute(
            "INSERT INTO item_ideas (item_key, item_name, ideas, updated_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(item_key) DO UPDATE SET item_name = excluded.item_name, "
            "ideas = excluded.ideas, updated_at = excluded.updated_at",
            (key, str(name or "")[:60], "\n".join(clean), int(time.time())),
        )


# Used when the model cannot be asked (standalone Mini App, no AI key, timeout).
_ITEM_IDEA_FALLBACKS = (
    (("меч", "клинок", "сабл", "нож", "топор", "копь", "кинжал", "шпаг"),
     ("руби врага", "отражай удар", "перережь верёвку")),
    (("щит", "брон"), ("закройся от удара", "прикрой союзника", "отражай атаку")),
    (("лук", "арбалет", "стрел"), ("выстрели в цель", "пристрели верёвку", "отпугни врага")),
    (("факел", "фонар", "лампа", "свеч", "спичк"), ("освети тёмное место", "подожги хворост", "отпугни зверя")),
    (("ключ", "отмычк"), ("открой запертую дверь", "вскрой сундук", "осмотри замок")),
    (("верёвк", "канат", "цепь"), ("свяжи пленника", "спустись по стене", "переберись через пропасть")),
    (("зель", "эликсир", "микстур", "лекарств", "бинт", "аптечк"),
     ("вылечи рану", "сними усталость", "помоги союзнику")),
    (("еда", "хлеб", "мясо", "яблок", "сыр", "фляг", "вода", "вино"),
     ("утоли голод", "подкрепись перед дорогой", "поделись с союзником")),
    (("монет", "золот", "деньг", "кошел"), ("оплати проход", "подкупи стража", "купи припасы")),
    (("книг", "свиток", "карт", "записк", "письм"),
     ("прочитай нужную страницу", "найди подсказку", "покажи союзнику")),
    (("амулет", "талисман", "оберег", "кольц"), ("защитись от магии", "почувствуй опасность", "покажи как знак")),
    (("удочк", "сеть", "крюч"), ("поймай рыбу", "вытащи предмет из воды", "зацепи что-то вдалеке")),
    (("инструмент", "молот", "клещ", "отвёрт", "гаечн"), ("почини механизм", "вскрой замок", "закрепи опору")),
)
_GENERIC_ITEM_IDEAS = ("используй предмет по назначению в сцене", "осмотри предмет вблизи", "покажи предмет союзнику")


def fallback_item_ideas(name: str) -> list[str]:
    """Item-specific examples without calling the model."""
    lowered = str(name or "").casefold()
    for keywords, ideas in _ITEM_IDEA_FALLBACKS:
        if any(keyword in lowered for keyword in keywords):
            return list(ideas)
    return list(_GENERIC_ITEM_IDEAS)


def merge_missing_items(chat_id: int, user_id: int) -> list[dict]:
    """Copy items the player holds in another chat into ``chat_id`` once.

    Used when the bot answers in a chat that never saw the pickup, so the
    inventory prompt does not tell the model that the player is empty-handed.
    The source row is kept, so nothing is lost until ``get_items_anywhere`` is
    used for display.
    """
    present = get_items(chat_id, user_id)
    merged = []
    for item in get_items_anywhere(user_id):
        if any(same_item_name(item["name"], entry["name"]) for entry in present):
            continue
        canonical = add_item(chat_id, user_id, item["name"])
        if canonical:
            # Keep the real stack size: the mirrored row is a view of the same
            # item, so it must show "(x3)" when the player carries three.
            with _connect() as conn:
                conn.execute(
                    "UPDATE inventory SET quantity = ? "
                    "WHERE chat_id = ? AND user_id = ? AND item_name = ?",
                    (int(item["quantity"]), int(chat_id), int(user_id), canonical),
                )
            merged.append(canonical)
    return merged


def get_items(chat_id: int, user_id: int) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT item_name, quantity FROM inventory "
            "WHERE chat_id = ? AND user_id = ? ORDER BY item_name COLLATE NOCASE",
            (int(chat_id), int(user_id)),
        ).fetchall()
    return [{"name": name, "quantity": quantity} for name, quantity in rows]


def find_item(chat_id: int, user_id: int, name: str) -> dict | None:
    name = _clean_item_name(name)
    if not name:
        return None
    with _connect() as conn:
        rows = conn.execute(
            "SELECT item_name, quantity FROM inventory "
            "WHERE chat_id = ? AND user_id = ?",
            (int(chat_id), int(user_id)),
        ).fetchall()
    wanted = name.casefold()
    for item_name, quantity in rows:
        if item_name.casefold() == wanted or same_item_name(item_name, name):
            return {"name": item_name, "quantity": quantity}
    return None


def add_item(chat_id: int, user_id: int, name: str) -> str | None:
    """Add one copy and return its canonical name, or None when invalid/full."""
    name = _clean_item_name(name)
    if len(name) < 2:
        return None
    with _connect() as conn:
        rows = conn.execute(
            "SELECT item_name, quantity FROM inventory "
            "WHERE chat_id = ? AND user_id = ?",
            (int(chat_id), int(user_id)),
        ).fetchall()
        row = next((r for r in rows if same_item_name(r[0], name)), None)
        if row:
            if row[1] >= _MAX_STACK:
                return None
            conn.execute(
                "UPDATE inventory SET quantity = quantity + 1 "
                "WHERE chat_id = ? AND user_id = ? AND item_name = ?",
                (int(chat_id), int(user_id), row[0]),
            )
            return row[0]

        count = conn.execute(
            "SELECT COUNT(*) FROM inventory WHERE chat_id = ? AND user_id = ?",
            (int(chat_id), int(user_id)),
        ).fetchone()[0]
        if count >= _MAX_UNIQUE_ITEMS:
            return None
        conn.execute(
            "INSERT INTO inventory (chat_id, user_id, item_name, quantity) VALUES (?, ?, ?, 1)",
            (int(chat_id), int(user_id), name),
        )
    try:
        check_user_achievements(int(user_id))
    except Exception:
        pass
    return name


def remove_one(chat_id: int, user_id: int, name: str) -> str | None:
    """Remove one copy of an item and return its canonical name."""
    item = find_item(chat_id, user_id, name)
    if not item:
        return None
    with _connect() as conn:
        if item["quantity"] > 1:
            conn.execute(
                "UPDATE inventory SET quantity = quantity - 1 "
                "WHERE chat_id = ? AND user_id = ? AND item_name = ?",
                (int(chat_id), int(user_id), item["name"]),
            )
        else:
            conn.execute(
                "DELETE FROM inventory WHERE chat_id = ? AND user_id = ? AND item_name = ?",
                (int(chat_id), int(user_id), item["name"]),
            )
    return item["name"]


def remove_one_anywhere(user_id: int, name: str) -> str | None:
    """Consume one logical copy even when it is mirrored into several chats.

    Using the only cigarette must leave the player with none, no matter which
    chat the command came from and how many mirror rows exist.
    """
    name = _clean_item_name(name)
    if not name:
        return None
    with _connect() as conn:
        rows = conn.execute(
            "SELECT chat_id, item_name, quantity FROM inventory WHERE user_id = ?",
            (int(user_id),),
        ).fetchall()
        matches = [row for row in rows if same_item_name(row[1], name)]
        if not matches:
            return None
        canonical = matches[0][1]
        target = max(int(quantity) for _, _, quantity in matches) - 1
        _trim_item_copies(conn, user_id, canonical, target)
    return canonical


def find_item_chat(user_id: int, name: str) -> int | None:
    """Chat storing a copy of the item, preferring the friends' group chat."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT chat_id, item_name FROM inventory WHERE user_id = ?",
            (int(user_id),),
        ).fetchall()
    matches = [
        int(chat_id) for chat_id, item_name in rows
        if same_item_name(item_name, name)
    ]
    if not matches:
        return None
    for target in list_group_chats(user_id):
        if target["chat_id"] in matches:
            return target["chat_id"]
    return matches[0]


def inventory_prompt(chat_id: int, user_id: int, player_name: str) -> str:
    items = get_items(chat_id, user_id)
    if items:
        listing = ", ".join(
            f"{item['name']} (x{item['quantity']})" if item["quantity"] > 1 else item["name"]
            for item in items
        )
    else:
        listing = "пуст"
    capacity_note = (
        "В инвентаре уже максимальное число разных предметов (30): новый предмет нельзя добавить, "
        "пока один не будет потрачен или выброшен в сюжете. "
        if len(items) >= _MAX_UNIQUE_ITEMS else ""
    )
    return (
        f"\n\nИНВЕНТАРЬ ИГРОКА «{player_name}»: {listing}. "
        + capacity_note
        + "Инвентари участников разделены. Не добавляй предмет одному игроку за другого; "
        "если в сообщении явно просят передать предмет конкретному участнику, используй для него "
        "ITEM_GIVE. Предметы не должны отвлекать от роли и текущей цели: не инициируй находки "
        "или подарки только ради пополнения инвентаря. Не превращай ответ в отчёт об инвентаре "
        "и не объясняй служебную механику предметов. "
        "Если действительно находишь, создаёшь или отдаёшь этот предмет игроку, ОБЯЗАТЕЛЬНО "
        "добавь в конец ответа метку [[ITEM_ADD:название предмета]] — она пополняет инвентарь "
        "именно игрока. Игрок также может сам подобрать вещь: если его "
        "последнее сообщение прямо говорит «беру/поднимаю/забираю X», считай X взятым и "
        "обыграй это; если X недоступен, явно скажи почему. Название в метке пиши в "
        "именительном падеже. Не пропускай метку при явной передаче или успешном подборе. "
        "Если игрок просит дать вещь другому участнику по имени, передай её именно этому участнику, "
        "а не автору просьбы, и добавь [[ITEM_GIVE:имя участника:название предмета]], только если "
        "персонаж действительно передал вещь. Ту же метку ITEM_GIVE используй, когда персонаж по "
        "своей инициативе отдаёт, вручает или дарит вещь другому участнику, даже если у автора "
        "просьбы этой вещи нет. Не используй ITEM_ADD для предмета, который получает другой "
        "участник: ITEM_ADD всегда кладёт вещь автору сообщения. Не приписывай автору владение "
        "вещью, которой у него нет: если её отдаёт персонаж, предмет попадёт прямо в инвентарь "
        "адресата. Если автор передаёт свою вещь, перемести одну копию из его инвентаря без "
        "создания дубликата. "
        "Если игрок описывает потерю чужого рюкзака или сумки по имени/местоимению, применяй её "
        "к указанному владельцу, а не к автору сообщения. Естественно "
        "вплети передачу в ролевую сцену, не делай её отчётом или обещанием и затем продолжи "
        "текущее действие/сюжет самостоятельным поступком персонажа, не отправляя участника "
        "куда-либо следом. Не показывай метку. "
        "Если вещь игрока расходуется, ломается или окончательно уходит из его рук, "
        "добавь [[ITEM_CONSUME:точное название предмета из списка, в именительном падеже]]. "
        "Обычное применение не расходует "
        "многоразовые предметы. Не добавляй метки за одну лишь просьбу поискать: предмет "
        "появляется только если он действительно найден/создан/передан или игрок прямо "
        "забрал его в сцене; одна просьба найти вещь без фактического обнаружения не считается. "
        "Не показывай сами метки в видимом тексте. За один ответ можно добавить не более "
        "одного предмета и не более одной копии: ставь ITEM_ADD ровно один раз. "
        "Если такой предмет у игрока уже есть, не выдавай вторую копию — обыграй, что "
        "вещь у него в руках."
    )


def extract_changes(text: str) -> tuple[list[str], list[str]]:
    additions = [_clean_item_name(m.group(1)) for m in _ITEM_ADD_RE.finditer(text or "")]
    consumptions = [_clean_item_name(m.group(1)) for m in _ITEM_CONSUME_RE.finditer(text or "")]
    additions = [name for name in additions if len(name) >= 2][:1]
    consumptions = [name for name in consumptions if len(name) >= 2]
    return additions, consumptions


def strip_change_markers(text: str | None) -> str | None:
    if text is None:
        return None
    text = _ITEM_ADD_RE.sub("", text)
    text = _ITEM_CONSUME_RE.sub("", text)
    text = _ITEM_GIVE_RE.sub("", text)
    return text.strip()


# ---------------------------------------------------------------------------
# Механики вовлечённости: return greeting + daily reward
# ---------------------------------------------------------------------------

def days_since_seen(chat_id: int, user_id: int) -> int:
    """Возвращает кол-во дней с последнего визита пользователя в чате и обновляет дату.

    Возвращает 0 при первом визите или если пользователь уже писал сегодня.
    """
    from datetime import date as _date
    today = _date.today().isoformat()
    try:
        with _connect() as conn:
            row = conn.execute(
                "SELECT last_seen_date FROM chat_members WHERE chat_id=? AND user_id=?",
                (int(chat_id), int(user_id)),
            ).fetchone()
            if not row:
                return 0
            last = row[0] or ''
            if last == today:
                return 0
            conn.execute(
                "UPDATE chat_members SET last_seen_date=? WHERE chat_id=? AND user_id=?",
                (today, int(chat_id), int(user_id)),
            )
            if not last:
                return 0
            try:
                delta = _date.today() - _date.fromisoformat(last)
                return max(delta.days, 0)
            except Exception:
                return 0
    except Exception:
        return 0


def check_daily_reward(chat_id: int, user_id: int) -> bool:
    """Возвращает True (и помечает выдачу) если это первое сообщение пользователя за сегодня.

    Второй и последующие вызовы в тот же день возвращают False.
    """
    from datetime import date as _date
    today = _date.today().isoformat()
    try:
        with _connect() as conn:
            row = conn.execute(
                "SELECT last_reward_date FROM chat_members WHERE chat_id=? AND user_id=?",
                (int(chat_id), int(user_id)),
            ).fetchone()
            if not row:
                return False
            if row[0] == today:
                return False
            conn.execute(
                "UPDATE chat_members SET last_reward_date=? WHERE chat_id=? AND user_id=?",
                (today, int(chat_id), int(user_id)),
            )
            return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Механики вовлечённости: Daily Recaps, User Titles, Hall of Fame / Stats
# ---------------------------------------------------------------------------

def save_daily_recap(chat_id: int, character_name: str, summary: str) -> None:
    """Сохраняет итог дня персонажа для чата."""
    from datetime import date as _date
    recap_date = _date.today().isoformat()
    now_ts = int(time.time())
    try:
        with _connect() as conn:
            conn.execute(
                "INSERT INTO daily_recaps (chat_id, recap_date, character_name, summary, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (int(chat_id), recap_date, str(character_name or "").strip(), str(summary or "").strip(), now_ts),
            )
    except Exception:
        pass


def get_latest_recaps(chat_id: int, limit: int = 5) -> list[dict]:
    """Возвращает последние итоги дня для чата."""
    try:
        with _connect() as conn:
            rows = conn.execute(
                "SELECT recap_date, character_name, summary, created_at FROM daily_recaps "
                "WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?",
                (int(chat_id), int(limit)),
            ).fetchall()
            return [
                {
                    "recap_date": row[0],
                    "character_name": row[1],
                    "summary": row[2],
                    "created_at": row[3],
                }
                for row in rows
            ]
    except Exception:
        return []


def record_game_score(game_id: str, user_id: int, user_name: str, score: int, chat_id: int | None = None) -> dict:
    """Сохраняет счёт игры и возвращает лучший результат пользователя и ранг."""
    now = int(time.time())
    game_id = str(game_id).strip()[:32]
    user_name = str(user_name).strip()[:64] or f"Игрок {user_id}"
    score = int(score)
    
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO game_scores (game_id, user_id, user_name, score, chat_id, played_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (game_id, int(user_id), user_name, score, int(chat_id) if chat_id else None, now),
        )
        # Получаем максимальный рекорд пользователя
        best_row = conn.execute(
            """
            SELECT MAX(score) FROM game_scores
            WHERE game_id = ? AND user_id = ?
            """,
            (game_id, int(user_id)),
        ).fetchone()
        personal_best = best_row[0] if best_row and best_row[0] is not None else score
        
    try:
        check_user_achievements(int(user_id))
    except Exception:
        pass

    return {
        "game_id": game_id,
        "score": score,
        "personal_best": personal_best,
        "is_new_record": score >= personal_best,
    }


def get_game_leaderboard(game_id: str, chat_id: int | None = None, limit: int = 10) -> list[dict]:
    """Возвращает топ игроков по игре (по их лучшему рекорду)."""
    game_id = str(game_id).strip()
    limit = max(1, min(limit, 50))
    try:
        with _connect() as conn:
            if chat_id:
                # Если передан chat_id, фильтруем по чату (или берем общий лидерборд)
                rows = conn.execute(
                    """
                    SELECT user_id, user_name, MAX(score) as high_score, MAX(played_at) as last_play
                    FROM game_scores
                    WHERE game_id = ? AND (chat_id = ? OR chat_id IS NULL)
                    GROUP BY user_id
                    ORDER BY high_score DESC
                    LIMIT ?
                    """,
                    (game_id, int(chat_id), limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT user_id, user_name, MAX(score) as high_score, MAX(played_at) as last_play
                    FROM game_scores
                    WHERE game_id = ?
                    GROUP BY user_id
                    ORDER BY high_score DESC
                    LIMIT ?
                    """,
                    (game_id, limit),
                ).fetchall()
                
            return [
                {
                    "rank": idx + 1,
                    "user_id": row[0],
                    "user_name": row[1] or f"Игрок {row[0]}",
                    "score": row[2],
                    "played_at": row[3],
                }
                for idx, row in enumerate(rows)
            ]
    except Exception:
        return []


def get_all_games_leaderboards(chat_id: int | None = None) -> dict[str, list[dict]]:
    """Возвращает лидерборды для всех основных соревновательных игр."""
    games = ["timberjack", "game2048", "snake"]
    return {g: get_game_leaderboard(g, chat_id=chat_id, limit=10) for g in games}


def grant_user_title(chat_id: int, user_id: int, title: str, granted_by: str = "") -> None:
    """Назначает или обновляет звание/титул участника чата."""
    from datetime import date as _date
    granted_date = _date.today().isoformat()
    clean_title = " ".join(str(title or "").split())[:80].strip()
    if not clean_title:
        return
    try:
        with _connect() as conn:
            conn.execute(
                "INSERT INTO user_titles (chat_id, user_id, title, granted_by, granted_date) "
                "VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(chat_id, user_id) DO UPDATE SET "
                "title = excluded.title, granted_by = excluded.granted_by, granted_date = excluded.granted_date",
                (int(chat_id), int(user_id), clean_title, str(granted_by or "").strip(), granted_date),
            )
    except Exception:
        pass


def get_user_title(chat_id: int, user_id: int) -> str:
    """Возвращает звание участника в чате или пустую строку."""
    try:
        with _connect() as conn:
            row = conn.execute(
                "SELECT title FROM user_titles WHERE chat_id = ? AND user_id = ?",
                (int(chat_id), int(user_id)),
            ).fetchone()
            return row[0] if row and row[0] else ""
    except Exception:
        return ""


def increment_stat(chat_id: int, user_id: int, stat_type: str, amount: int = 1) -> None:
    """Увеличивает счётчик статистики участника: messages_count, items_collected, lethal_strikes, game_wins."""
    allowed = {
        "messages_count": "messages_count",
        "items_collected": "items_collected",
        "lethal_strikes": "lethal_strikes",
        "game_wins": "game_wins",
    }
    col = allowed.get(stat_type)
    if not col or not user_id:
        return
    amt = int(amount)
    if amt <= 0:
        return
    try:
        with _connect() as conn:
            conn.execute(
                f"INSERT INTO chat_stats (chat_id, user_id, {col}) VALUES (?, ?, ?) "
                f"ON CONFLICT(chat_id, user_id) DO UPDATE SET {col} = chat_stats.{col} + ?",
                (int(chat_id), int(user_id), amt, amt),
            )
    except Exception:
        pass


def get_hall_of_fame(chat_id: int) -> list[dict]:
    """Возвращает участников чата с их статистикой, активностью и титулами."""
    try:
        with _connect() as conn:
            query = """
                SELECT 
                    COALESCE(m.user_id, s.user_id) as uid,
                    COALESCE(m.display_name, ''),
                    COALESCE(m.username, ''),
                    COALESCE(s.messages_count, 0) as messages_count,
                    MAX(COALESCE(s.items_collected, 0), COALESCE(inv.items_count, 0)) as items_collected,
                    COALESCE(s.lethal_strikes, 0) as lethal_strikes,
                    COALESCE(s.game_wins, 0) as game_wins,
                    COALESCE(t.title, '') as title,
                    (COALESCE(s.messages_count, 0) + MAX(COALESCE(s.items_collected, 0), COALESCE(inv.items_count, 0)) * 2 + COALESCE(s.lethal_strikes, 0) * 5 + COALESCE(s.game_wins, 0) * 10) as score
                FROM chat_members m
                LEFT JOIN chat_stats s ON s.chat_id = m.chat_id AND s.user_id = m.user_id
                LEFT JOIN user_titles t ON t.chat_id = m.chat_id AND t.user_id = m.user_id
                LEFT JOIN (
                    SELECT user_id, chat_id, COUNT(*) as items_count 
                    FROM inventory 
                    GROUP BY user_id, chat_id
                ) inv ON inv.chat_id = m.chat_id AND inv.user_id = m.user_id
                WHERE m.chat_id = ?
                UNION
                SELECT 
                    s.user_id as uid,
                    COALESCE(m.display_name, ''),
                    COALESCE(m.username, ''),
                    COALESCE(s.messages_count, 0) as messages_count,
                    MAX(COALESCE(s.items_collected, 0), COALESCE(inv.items_count, 0)) as items_collected,
                    COALESCE(s.lethal_strikes, 0) as lethal_strikes,
                    COALESCE(s.game_wins, 0) as game_wins,
                    COALESCE(t.title, '') as title,
                    (COALESCE(s.messages_count, 0) + MAX(COALESCE(s.items_collected, 0), COALESCE(inv.items_count, 0)) * 2 + COALESCE(s.lethal_strikes, 0) * 5 + COALESCE(s.game_wins, 0) * 10) as score
                FROM chat_stats s
                LEFT JOIN chat_members m ON m.chat_id = s.chat_id AND m.user_id = s.user_id
                LEFT JOIN user_titles t ON t.chat_id = s.chat_id AND t.user_id = s.user_id
                LEFT JOIN (
                    SELECT user_id, chat_id, COUNT(*) as items_count 
                    FROM inventory 
                    GROUP BY user_id, chat_id
                ) inv ON inv.chat_id = m.chat_id AND inv.user_id = m.user_id
                WHERE s.chat_id = ?
                ORDER BY score DESC, messages_count DESC, items_collected DESC, lethal_strikes DESC
                LIMIT 50
            """
            rows = conn.execute(query, (int(chat_id), int(chat_id))).fetchall()
            return [
                {
                    "user_id": row[0],
                    "display_name": row[1] or (f"@{row[2]}" if row[2] else f"User {row[0]}"),
                    "username": row[2] or "",
                    "messages_count": row[3] or 0,
                    "items_collected": row[4] or 0,
                    "lethal_strikes": row[5] or 0,
                    "game_wins": row[6] or 0,
                    "title": row[7] or "",
                    "score": row[8] or 0,
                }
                for row in rows
            ]
    except Exception:
        return []


def record_game_score(game_name: str, user_id: int, user_name: str, chat_id: int | None = None, score: int = 0) -> dict:
    """Сохраняет результат игры в общую таблицу game_scores и начисляет очки в Зал славы."""
    now = int(time.time())
    game_key = str(game_name or "mini_game").strip()[:32]
    user_name = str(user_name or "").strip()[:64] or f"Игрок {user_id}"
    score = int(score)
    cid = int(chat_id) if chat_id else None
    
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO game_scores (game_id, game_name, user_id, user_name, score, chat_id, played_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (game_key, game_key, int(user_id), user_name, score, cid, now, now),
        )
        best_row = conn.execute(
            """
            SELECT MAX(score) FROM game_scores
            WHERE (game_id = ? OR game_name = ?) AND user_id = ?
            """,
            (game_key, game_key, int(user_id)),
        ).fetchone()
        personal_best = best_row[0] if best_row and best_row[0] is not None else score

    # Автоматическое начисление в Зал славы (chat_stats), если игра привязана к чату
    if cid and user_id:
        try:
            # Начисляем победу/активность в игре в Зал славы чата
            increment_stat(cid, user_id, "game_wins", amount=1)
        except Exception:
            pass

    # Начисление монет и турнирных очков за сыгранную игру
    coins_earned = 0
    tournament_pts = 0
    if user_id:
        try:
            # Рассчитываем награду: базовые 5 монет за участие + 1 монета за каждые 10 очков (макс 50 за игру)
            coins_earned = max(5, min(50, 5 + max(0, score) // 10))
            add_coins(user_id, coins_earned, reason=f"game:{game_key}")
            # Турнирные очки: соответствуют счёту или эквиваленту монет
            tournament_pts = max(10, min(500, max(0, score) if score > 0 else 10))
            add_tournament_points(user_id, user_name, tournament_pts, chat_id=cid)
        except Exception:
            pass

    if user_id:
        try:
            check_user_achievements(int(user_id))
        except Exception:
            pass

    return {
        "game_id": game_key,
        "game_name": game_key,
        "score": score,
        "personal_best": personal_best,
        "is_new_record": score >= personal_best,
        "coins_earned": coins_earned,
        "tournament_points": tournament_pts,
    }


def get_top_game_scores(game_name: str | None = None, chat_id: int | None = None, limit: int = 10) -> list[dict]:
    """Возвращает лучшие результаты по конкретной игре или общий лидерборд по всем играм."""
    limit = max(1, min(int(limit or 10), 50))
    # Маппинг алиасов ключей игр
    alias_map = {
        "tower_stack": ["tower_stack", "tower"],
        "tower": ["tower_stack", "tower"],
        "timberjack": ["timberjack", "timberman"],
        "timberman": ["timberjack", "timberman"],
        "knife_hit": ["knife_hit", "knife"],
        "knife": ["knife_hit", "knife"],
        "swipe_basketball": ["swipe_basketball", "basketball"],
        "basketball": ["swipe_basketball", "basketball"],
        "brick_breaker": ["brick_breaker", "bricks"],
        "bricks": ["brick_breaker", "bricks"],
        "colorswitch": ["colorswitch"],
        "air_hockey": ["air_hockey", "airhockey"],
        "airhockey": ["air_hockey", "airhockey"],
        "whack_mole": ["whack_mole", "whack"],
        "whack": ["whack_mole", "whack"],
        "game_2048": ["game_2048", "game2048", "2048"],
        "game2048": ["game_2048", "game2048", "2048"],
    }
    try:
        with _connect() as conn:
            params = []
            where_clauses = []
            if game_name:
                aliases = alias_map.get(str(game_name).strip(), [str(game_name).strip()])
                placeholders = " OR ".join(["game_id = ? OR game_name = ?" for _ in aliases])
                where_clauses.append(f"({placeholders})")
                for a in aliases:
                    params.extend([a, a])
            if chat_id:
                where_clauses.append("(chat_id = ? OR chat_id IS NULL)")
                params.append(int(chat_id))

            where_str = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

            query = f"""
                SELECT user_id, user_name, COALESCE(game_name, game_id) as game, MAX(score) as high_score, MAX(COALESCE(created_at, played_at)) as last_play
                FROM game_scores
                {where_str}
                GROUP BY user_id
                ORDER BY high_score DESC
                LIMIT ?
            """
            params.append(limit)
            rows = conn.execute(query, params).fetchall()
            return [
                {
                    "rank": idx + 1,
                    "user_id": row[0],
                    "user_name": row[1] or f"Игрок {row[0]}",
                    "game_name": row[2],
                    "score": row[3],
                    "played_at": row[4],
                    "created_at": row[4],
                }
                for idx, row in enumerate(rows)
            ]
    except Exception:
        return []


def get_game_leaderboard(game_id: str, chat_id: int | None = None, limit: int = 10) -> list[dict]:
    """Возвращает топ игроков по игре (по их лучшему рекорду)."""
    return get_top_game_scores(game_name=game_id, chat_id=chat_id, limit=limit)


def get_all_games_leaderboards(chat_id: int | None = None) -> dict[str, list[dict]]:
    """Возвращает лидерборды для всех основных соревновательных игр."""
    games = ["duel_dice", "duel_darts", "duel_bowling", "duel_football", "duel_basketball", "quiz_absurd", "timberjack", "game2048", "flappy"]
    return {g: get_game_leaderboard(g, chat_id=chat_id, limit=10) for g in games}


# ==========================================
# ЭКОНОМИКА, МОНЕТЫ И СТРИКИ (COINS & DAILY)
# ==========================================

SHOP_ITEMS = [
    {
        "item_id": "vip_badge",
        "name": "👑 LORD OF THE DUNGEON (VIP на 7 дней)",
        "price": 5000,
        "description": "Элитный королевский статус босса качалки на неделю (7 дней)! Персонаж признает вас своим боссом, обращается на 'Вы, мой Босс' с поклоном в каждом сообщении, дает доступ к золотой короне в Зале славы и бейджу [LORD VIP].",
        "icon": "👑",
        "type": "duration",
    },
    {
        "item_id": "slap_friend",
        "name": "🐟 Дружеский лещ / Мокрое полотенце",
        "price": 120,
        "description": "Бот со смачным звоном отвешивает дружеского леща другу при входе в чат.",
        "icon": "🐟",
        "type": "usable",
    },
    {
        "item_id": "custom_roast",
        "name": "🎯 Спанкинг / Заказной подкол",
        "price": 100,
        "description": "Бот жестко и остроумно подколет выбранного слейва на заданную тему.",
        "icon": "🎯",
        "type": "usable",
    },
    {
        "item_id": "golden_fart",
        "name": "💨 Золотой залп / Гачи-выхлоп",
        "price": 80,
        "description": "Бот смачно и громогласно комментирует появление звука мощного выхлопа в раздевалке с хлопком и смешной фразой.",
        "icon": "💨",
        "type": "usable",
    },
    {
        "item_id": "silent_muter",
        "name": "🤐 Кляп для слейва / Режим Тишины (15 минут)",
        "price": 150,
        "description": "Заставляет бота замолчать и не отвечать на спонтанные сообщения в этом чате следующие 15 минут (отдых для качалки).",
        "icon": "🤐",
        "type": "duration",
    },
    {
        "item_id": "compliment_bomb",
        "name": "🌹 Королевский респект / Комплимент",
        "price": 90,
        "description": "Бот персонально осыпает выбранного братана роскошными эпитетами о его бицепсах, форме и непревзойденной мощи.",
        "icon": "🌹",
        "type": "usable",
    },
    {
        "item_id": "dungeon_party",
        "name": "🎉 Дискотека в качалке / Party Hard (30 мин)",
        "price": 220,
        "description": "Бот врубает режим безумной вечеринки, цитирует ремиксы, кричит 'Let's celebrate and suck some...', танцует и спамит энергией.",
        "icon": "🎉",
        "type": "duration",
    },
    {
        "item_id": "fake_ban",
        "name": "🔨 Фейковый бан молотом Тора",
        "price": 130,
        "description": "Бот торжественно и драматично 'банит' указанного друга в шуточной манере с отсчетом секунд до 'изгнания из качалки'.",
        "icon": "🔨",
        "type": "usable",
    },
    {
        "item_id": "bot_whisper",
        "name": "🕵️ Анонимный слух / Сплетня",
        "price": 180,
        "description": "Бот вбрасывает в чат забавный анонимный слух от своего лица, не выдавая автора.",
        "icon": "🕵️",
        "type": "usable",
    },
    {
        "item_id": "paranoia_mode",
        "name": "🛸 Режим Паранойи и Масонов (1 час)",
        "price": 250,
        "description": "Бот начинает подозревать всех в чате в работе на рептилоидов и мировое правительство.",
        "icon": "🛸",
        "type": "duration",
    },
    {
        "item_id": "shout_announcement",
        "name": "📢 Мегафон / Крик на всю качалку",
        "price": 300,
        "description": "Персонаж прерывает разговор громогласным криком через рупор с вашим объявлением.",
        "icon": "📢",
        "type": "usable",
    },
    {
        "item_id": "dungeon_immunity",
        "name": "🛡️ Неприкасаемый Слейв (Иммунитет)",
        "price": 600,
        "description": "Иммунитет на неделю: бот ни при каких условиях не подкалывает владельца и заступается за него.",
        "icon": "🛡️",
        "type": "passive",
    },
    {
        "item_id": "mood_override",
        "name": "⚡ Атмосфера Подземелья (30 мин)",
        "price": 150,
        "description": "Принудительно переключает стиль общения и вайб бота в текущем чате на 30 минут.",
        "icon": "⚡",
        "type": "duration",
    },
    {
        "item_id": "custom_title",
        "name": "🏷️ Кожаный Титул",
        "price": 200,
        "description": "Уникальный авторский титул в чате и профиле (например: 'Мастер спорта по спанкингу').",
        "icon": "🏷️",
        "type": "title",
    },
]


def get_shop_items() -> list[dict]:
    """Возвращает актуальный каталог товаров магазина."""
    return list(SHOP_ITEMS)


def get_user_coins(user_id: int) -> int:
    """Возвращает текущий баланс монет пользователя."""
    if not user_id:
        return 0
    try:
        with _connect() as conn:
            row = conn.execute("SELECT coins FROM user_economy WHERE user_id = ?", (int(user_id),)).fetchone()
            return row[0] if row and row[0] is not None else 0
    except Exception:
        return 0


def add_coins(user_id: int, amount: int, reason: str = "") -> int:
    """Начисляет монеты пользователю и возвращает обновленный баланс."""
    if not user_id:
        return 0
    amt = int(amount)
    now = int(time.time())
    try:
        with _connect() as conn:
            conn.execute(
                """
                INSERT INTO user_economy (user_id, coins, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    coins = user_economy.coins + excluded.coins,
                    updated_at = excluded.updated_at
                """,
                (int(user_id), amt, now),
            )
            row = conn.execute("SELECT coins FROM user_economy WHERE user_id = ?", (int(user_id),)).fetchone()
            return row[0] if row else 0
    except Exception:
        return 0


def spend_coins(user_id: int, amount: int, reason: str = "") -> bool:
    """Списывает указанное количество монет, если на балансе достаточно средств."""
    if not user_id:
        return False
    amt = int(amount)
    if amt <= 0:
        return True
    now = int(time.time())
    try:
        with _connect() as conn:
            row = conn.execute("SELECT coins FROM user_economy WHERE user_id = ?", (int(user_id),)).fetchone()
            current = row[0] if row and row[0] is not None else 0
            if current < amt:
                return False
            conn.execute(
                """
                UPDATE user_economy
                SET coins = coins - ?,
                    total_spent = COALESCE(total_spent, 0) + ?,
                    updated_at = ?
                WHERE user_id = ?
                """,
                (amt, amt, now, int(user_id)),
            )
            return True
    except Exception:
        return False


def claim_daily_streak(user_id: int) -> dict:
    """Проверяет и начисляет ежедневную награду за вход (daily streak)."""
    import datetime
    if not user_id:
        return {"streak": 0, "reward": 0, "claimed": False, "message": "Не указан пользователь"}
    today = datetime.date.today().isoformat()
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    now = int(time.time())

    try:
        with _connect() as conn:
            row = conn.execute(
                "SELECT coins, daily_streak, last_daily_claim FROM user_economy WHERE user_id = ?",
                (int(user_id),),
            ).fetchone()

            if not row:
                streak = 1
                reward = 50
                conn.execute(
                    """
                    INSERT INTO user_economy (user_id, coins, daily_streak, last_daily_claim, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (int(user_id), reward, streak, today, now),
                )
                return {
                    "streak": streak,
                    "reward": reward,
                    "claimed": True,
                    "coins": reward,
                    "message": f"Ежедневная награда получена! +{reward} монет (Стрик 1 день)",
                }

            current_coins, current_streak, last_claim = row
            if last_claim == today:
                return {
                    "streak": current_streak,
                    "reward": 0,
                    "claimed": False,
                    "coins": current_coins,
                    "message": "Сегодня вы уже забрали свою ежедневную награду!",
                }

            if last_claim == yesterday:
                streak = current_streak + 1
            else:
                streak = 1

            # Базовая награда 50 + 10 за каждый день стрика (до 200 монет)
            reward = min(200, 50 + (streak - 1) * 10)
            conn.execute(
                """
                UPDATE user_economy
                SET coins = coins + ?, daily_streak = ?, last_daily_claim = ?, updated_at = ?
                WHERE user_id = ?
                """,
                (reward, streak, today, now, int(user_id)),
            )
            new_coins = current_coins + reward
            ret_data = {
                "streak": streak,
                "reward": reward,
                "claimed": True,
                "coins": new_coins,
                "message": f"Ежедневная награда! +{reward} монет! Стрик: {streak} дн.",
            }
        try:
            check_user_achievements(int(user_id))
        except Exception:
            pass
        return ret_data
    except Exception as e:
        return {"streak": 0, "reward": 0, "claimed": False, "message": f"Ошибка: {e}"}


def record_chat_message_activity(chat_id: int, user_id: int) -> dict:
    """Начисляет монеты за активность в чате с антиспам-кулдауном (60 секунд)."""
    if not user_id:
        return {"awarded": False, "coins_added": 0, "balance": 0}
    now = int(time.time())
    cooldown = 60

    try:
        with _connect() as conn:
            row = conn.execute(
                "SELECT coins, last_message_award FROM user_economy WHERE user_id = ?",
                (int(user_id),),
            ).fetchone()

            if not row:
                conn.execute(
                    """
                    INSERT INTO user_economy (user_id, coins, last_message_award, total_messages, updated_at)
                    VALUES (?, ?, ?, 1, ?)
                    """,
                    (int(user_id), 2, now, now),
                )
                result_dict = {"awarded": True, "coins_added": 2, "balance": 2}
            else:
                coins, last_award = row
                # Увеличиваем счетчик сообщений в user_economy
                try:
                    conn.execute(
                        "UPDATE user_economy SET total_messages = COALESCE(total_messages, 0) + 1 WHERE user_id = ?",
                        (int(user_id),),
                    )
                except Exception:
                    pass

                if (now - last_award) < cooldown:
                    result_dict = {"awarded": False, "coins_added": 0, "balance": coins}
                else:
                    # Начисляем 2 монеты за активность
                    coins_added = 2
                    conn.execute(
                        """
                        UPDATE user_economy
                        SET coins = coins + ?, last_message_award = ?, updated_at = ?
                        WHERE user_id = ?
                        """,
                        (coins_added, now, now, int(user_id)),
                    )
                    result_dict = {"awarded": True, "coins_added": coins_added, "balance": coins + coins_added}
        # Проверяем достижения ПОСЛЕ закрытия соединения conn
        try:
            check_user_achievements(int(user_id))
        except Exception:
            pass
        return result_dict
    except Exception:
        return {"awarded": False, "coins_added": 0, "balance": 0}


# ==========================================
# МАГАЗИН И ПЕРКИ (SHOP & PERKS)
# ==========================================

def get_user_perks(user_id: int, chat_id: int | None = None) -> dict:
    """Возвращает информацию об активных перках пользователя."""
    if not user_id:
        return {"vip": False, "vip_expires_at": 0, "vip_days_left": 0, "has_roast": False, "titles": [], "perks": []}
    now = int(time.time())
    try:
        with _connect() as conn:
            # Очищаем или деактивируем просроченные временные перки
            conn.execute(
                "UPDATE user_perks SET active = 0 WHERE expires_at > 0 AND expires_at < ?",
                (now,),
            )
            rows = conn.execute(
                """
                SELECT id, perk_id, chat_id, extra_data, expires_at, purchased_at
                FROM user_perks
                WHERE user_id = ? AND active = 1
                """,
                (int(user_id),),
            ).fetchall()

            perks_list = []
            is_vip = False
            vip_expires_at = 0
            has_roast = False
            titles = []

            for r in rows:
                p_id = r[1]
                p_chat = r[2]
                extra = r[3]
                exp = r[4]
                if p_id == "vip_badge":
                    is_vip = True
                    if exp > vip_expires_at:
                        vip_expires_at = exp
                elif p_id == "custom_roast":
                    has_roast = True
                elif p_id == "custom_title":
                    if extra:
                        titles.append(extra)

                perks_list.append({
                    "id": r[0],
                    "perk_id": p_id,
                    "chat_id": p_chat,
                    "extra_data": extra,
                    "expires_at": exp,
                    "purchased_at": r[5],
                })

            # Проверяем также титул из user_titles, если передан chat_id
            if chat_id:
                title_row = conn.execute(
                    "SELECT title FROM user_titles WHERE chat_id = ? AND user_id = ?",
                    (int(chat_id), int(user_id)),
                ).fetchone()
                if title_row and title_row[0] and title_row[0] not in titles:
                    titles.append(title_row[0])

            vip_days_left = 0
            if is_vip and vip_expires_at > now:
                import math
                vip_days_left = max(1, math.ceil((vip_expires_at - now) / 86400))
            elif is_vip and vip_expires_at == 0:
                vip_days_left = 7  # дефолт на случай бесконечного

            return {
                "vip": is_vip,
                "vip_expires_at": vip_expires_at,
                "vip_days_left": vip_days_left,
                "has_roast": has_roast,
                "titles": titles,
                "perks": perks_list,
            }
    except Exception:
        return {"vip": False, "vip_expires_at": 0, "vip_days_left": 0, "has_roast": False, "titles": [], "perks": []}


def buy_shop_item(user_id: int, item_id: str, chat_id: int | None = None, extra_data: dict | None = None) -> dict:
    """Обрабатывает покупку товара в магазине."""
    item = next((i for i in SHOP_ITEMS if i["item_id"] == item_id), None)
    if not item:
        return {"success": False, "message": "Товар не найден"}

    price = item["price"]
    current_coins = get_user_coins(user_id)
    if current_coins < price:
        return {
            "success": False,
            "message": f"Недостаточно монет! Требуется: {price}, у вас: {current_coins}",
            "balance": current_coins,
        }

    now = int(time.time())
    extra_str = ""
    expires_at = 0

    if item_id == "vip_badge":
        # Вычисляем срок VIP: 7 дней (604800 секунд)
        perks = get_user_perks(user_id)
        current_exp = perks.get("vip_expires_at") or 0
        if current_exp > now:
            expires_at = current_exp + 7 * 86400
        else:
            expires_at = now + 7 * 86400

    elif item_id == "custom_title":
        title_text = ""
        if extra_data and isinstance(extra_data, dict):
            title_text = extra_data.get("title") or extra_data.get("title_text") or extra_data.get("text") or ""
        title_text = " ".join(str(title_text).split())[:40].strip()
        if not title_text:
            return {"success": False, "message": "Укажите текст кастомного титула (до 40 символов)"}
        extra_str = title_text
        if chat_id:
            grant_user_title(chat_id, user_id, title_text, granted_by="Магазин")

    elif item_id == "mood_override":
        mood_text = ""
        if extra_data and isinstance(extra_data, dict):
            mood_text = extra_data.get("mood") or extra_data.get("vibe") or extra_data.get("text") or ""
        mood_text = " ".join(str(mood_text).split())[:120].strip() or "Безудержное веселье и сарказм"
        extra_str = mood_text
        expires_at = now + 1800  # 30 минут
        if chat_id:
            set_chat_mood_override(chat_id, user_id, mood_text, duration_seconds=1800)

    elif item_id == "dungeon_party":
        party_mood = "Дискотека в качалке / Party Hard! Врубай безумный драйв, танцуй, цитируй ремиксы, кричи 'Let's celebrate and suck some...', заряжай всех бешеной гачи-энергией!"
        extra_str = party_mood
        expires_at = now + 1800  # 30 минут
        if chat_id:
            set_chat_mood_override(chat_id, user_id, party_mood, duration_seconds=1800)

    elif item_id == "silent_muter":
        mute_seconds = 15 * 60  # 15 минут
        expires_at = now + mute_seconds
        if chat_id:
            mute_chat(chat_id, user_id, duration_seconds=mute_seconds)

    elif item_id == "golden_fart":
        # Смачный гачи-выхлоп в чате
        extra_str = "golden_fart"

    elif item_id == "slap_friend":
        target_id = 0
        target_name = ""
        reason = ""
        if extra_data and isinstance(extra_data, dict):
            target_id = int(extra_data.get("target_user_id") or 0)
            target_name = str(extra_data.get("target_user") or extra_data.get("target_name") or "").strip()
            reason = str(extra_data.get("reason") or extra_data.get("slap_reason") or extra_data.get("extra_text") or "").strip()
        if not target_id:
            return {"success": False, "message": "Укажите цель для леща (ответьте на сообщение друга или укажите ник)!"}
        extra_str = f"target:{target_id}:{target_name}"
        if chat_id:
            order_pending_prank(chat_id, user_id, target_id, target_name or f"Игрок {target_id}", "slap_friend", reason)

    elif item_id == "shout_announcement":
        announcement_text = ""
        if extra_data and isinstance(extra_data, dict):
            announcement_text = str(extra_data.get("text") or extra_data.get("announcement") or extra_data.get("extra_text") or "").strip()
        if not announcement_text:
            return {"success": False, "message": "Укажите текст объявления для мегафона (например: /buy shout_announcement Текст)!"}
        extra_str = announcement_text[:250]
        if chat_id:
            order_pending_prank(chat_id, user_id, 0, "Все в чате", "shout_announcement", extra_str)

    elif item_id == "compliment_bomb":
        target_id = 0
        target_name = ""
        compliment_text = ""
        if extra_data and isinstance(extra_data, dict):
            target_id = int(extra_data.get("target_user_id") or 0)
            target_name = str(extra_data.get("target_user") or extra_data.get("target_name") or "").strip()
            compliment_text = str(extra_data.get("compliment") or extra_data.get("extra_text") or "").strip()
        if not target_id:
            return {"success": False, "message": "Укажите братана для королевского комплимента (ответьте на его сообщение)!"}
        extra_str = f"target:{target_id}:{target_name}"
        if chat_id:
            order_pending_prank(chat_id, user_id, target_id, target_name or f"Братан {target_id}", "compliment_bomb", compliment_text)

    elif item_id == "fake_ban":
        target_id = 0
        target_name = ""
        ban_reason = ""
        if extra_data and isinstance(extra_data, dict):
            target_id = int(extra_data.get("target_user_id") or 0)
            target_name = str(extra_data.get("target_user") or extra_data.get("target_name") or "").strip()
            ban_reason = str(extra_data.get("reason") or extra_data.get("ban_reason") or "").strip()
        if not target_id:
            return {"success": False, "message": "Укажите цель для шуточного бана (ответьте на сообщение друга)!"}
        extra_str = f"target:{target_id}:{target_name}"
        if chat_id:
            order_pending_prank(chat_id, user_id, target_id, target_name or f"Игрок {target_id}", "fake_ban", ban_reason)

    elif item_id == "custom_roast":
        target_id = 0
        target_name = ""
        hint = ""
        if extra_data and isinstance(extra_data, dict):
            target_id = int(extra_data.get("target_user_id") or 0)
            target_name = str(extra_data.get("target_user") or extra_data.get("target_name") or "").strip()
            hint = str(extra_data.get("roast_topic") or extra_data.get("hint") or "").strip()
        if not target_id:
            return {"success": False, "message": "Укажите цель для спанкинга (ответьте на сообщение участника)!"}
        if chat_id and target_id:
            order_custom_roast(user_id, chat_id, target_id, target_name or f"Игрок {target_id}", hint)

    # Списываем монеты
    if not spend_coins(user_id, price, reason=f"buy:{item_id}"):
        return {"success": False, "message": "Ошибка списания средств"}

    # Записываем перк
    try:
        with _connect() as conn:
            conn.execute(
                """
                INSERT INTO user_perks (user_id, chat_id, perk_id, extra_data, active, purchased_at, expires_at)
                VALUES (?, ?, ?, ?, 1, ?, ?)
                """,
                (int(user_id), int(chat_id) if chat_id else None, item_id, extra_str, now, expires_at),
            )
    except Exception:
        pass

    new_balance = get_user_coins(user_id)
    try:
        check_user_achievements(int(user_id))
    except Exception:
        pass
    return {
        "success": True,
        "item_id": item_id,
        "item_name": item["name"],
        "price": price,
        "balance": new_balance,
        "message": f"Вы успешно приобрели «{item['name']}»!",
    }


def get_chat_mood_override(chat_id: int) -> dict | None:
    """Возвращает активный оверрайд настроения для чата или None."""
    if not chat_id:
        return None
    now = int(time.time())
    try:
        with _connect() as conn:
            conn.execute("DELETE FROM chat_mood_overrides WHERE expires_at < ?", (now,))
            row = conn.execute(
                """
                SELECT mood_text, expires_at, user_id
                FROM chat_mood_overrides
                WHERE chat_id = ? AND expires_at > ?
                """,
                (int(chat_id), now),
            ).fetchone()
            if row:
                return {
                    "mood": row[0],
                    "expires_at": row[1],
                    "buyer_id": row[2],
                    "time_left_sec": max(0, row[1] - now),
                }
            return None
    except Exception:
        return None


def set_chat_mood_override(chat_id: int, user_id: int, mood_text: str, duration_seconds: int = 1800) -> dict:
    """Устанавливает временное настроение для бота в чате."""
    now = int(time.time())
    expires_at = now + max(60, int(duration_seconds))
    clean_mood = " ".join(str(mood_text or "").split())[:200].strip()
    try:
        with _connect() as conn:
            conn.execute(
                """
                INSERT INTO chat_mood_overrides (chat_id, user_id, mood_text, set_at, expires_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(chat_id) DO UPDATE SET
                    user_id = excluded.user_id,
                    mood_text = excluded.mood_text,
                    set_at = excluded.set_at,
                    expires_at = excluded.expires_at
                """,
                (int(chat_id), int(user_id), clean_mood, now, expires_at),
            )
            return {"chat_id": chat_id, "mood": clean_mood, "expires_at": expires_at}
    except Exception as e:
        return {"error": str(e)}


def order_custom_roast(buyer_id: int, chat_id: int, target_user_id: int, target_name: str, hint: str = "") -> dict:
    """Заказывает подкол на конкретного участника в чате."""
    now = int(time.time())
    t_name = str(target_name or "").strip()[:64] or f"Участник {target_user_id}"
    h_text = str(hint or "").strip()[:200]
    try:
        with _connect() as conn:
            conn.execute(
                """
                INSERT INTO pending_roasts (chat_id, buyer_id, target_user_id, target_name, hint, used, created_at)
                VALUES (?, ?, ?, ?, ?, 0, ?)
                """,
                (int(chat_id), int(buyer_id), int(target_user_id), t_name, h_text, now),
            )
            return {"ordered": True, "target_name": t_name}
    except Exception as e:
        return {"error": str(e)}


def get_pending_roast(chat_id: int, target_user_id: int | None = None) -> dict | None:
    """Возвращает ожидающий выполнения подкол для чата/участника."""
    if not chat_id:
        return None
    try:
        with _connect() as conn:
            if target_user_id:
                row = conn.execute(
                    """
                    SELECT id, buyer_id, target_user_id, target_name, hint
                    FROM pending_roasts
                    WHERE chat_id = ? AND target_user_id = ? AND used = 0
                    ORDER BY created_at ASC LIMIT 1
                    """,
                    (int(chat_id), int(target_user_id)),
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    SELECT id, buyer_id, target_user_id, target_name, hint
                    FROM pending_roasts
                    WHERE chat_id = ? AND used = 0
                    ORDER BY created_at ASC LIMIT 1
                    """,
                    (int(chat_id),),
                ).fetchone()

            if row:
                return {
                    "roast_id": row[0],
                    "buyer_id": row[1],
                    "target_user_id": row[2],
                    "target_name": row[3],
                    "hint": row[4],
                }
            return None
    except Exception:
        return None


def consume_pending_roast(roast_id: int) -> bool:
    """Помечает заказанный подкол как выполненный."""
    try:
        with _connect() as conn:
            conn.execute("UPDATE pending_roasts SET used = 1 WHERE id = ?", (int(roast_id),))
            return True
    except Exception:
        return False


# ==========================================
# РОЗЫГРЫШИ И РЕЖИМ ТИШИНЫ (PRANKS & MUTE)
# ==========================================

def mute_chat(chat_id: int, user_id: int, duration_seconds: int = 900) -> dict:
    """Устанавливает режим тишины для чата (по умолчанию 15 минут)."""
    now = int(time.time())
    until_ts = now + max(60, int(duration_seconds))
    try:
        with _connect() as conn:
            conn.execute(
                """
                INSERT INTO chat_mutes (chat_id, muted_by, until_ts, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(chat_id) DO UPDATE SET
                    muted_by = excluded.muted_by,
                    until_ts = excluded.until_ts,
                    created_at = excluded.created_at
                """,
                (int(chat_id), int(user_id), until_ts, now),
            )
            return {"chat_id": chat_id, "until_ts": until_ts, "seconds": until_ts - now}
    except Exception as e:
        return {"error": str(e)}


def is_chat_muted(chat_id: int) -> bool:
    """Проверяет, находится ли чат в режиме тишины (silent_muter)."""
    if not chat_id:
        return False
    now = int(time.time())
    try:
        with _connect() as conn:
            conn.execute("DELETE FROM chat_mutes WHERE until_ts < ?", (now,))
            row = conn.execute("SELECT 1 FROM chat_mutes WHERE chat_id = ? AND until_ts > ?", (int(chat_id), now)).fetchone()
            return row is not None
    except Exception:
        return False


def get_chat_mute_info(chat_id: int) -> dict | None:
    """Возвращает информацию об активности режима тишины в чате."""
    if not chat_id:
        return None
    now = int(time.time())
    try:
        with _connect() as conn:
            conn.execute("DELETE FROM chat_mutes WHERE until_ts < ?", (now,))
            row = conn.execute("SELECT muted_by, until_ts FROM chat_mutes WHERE chat_id = ? AND until_ts > ?", (int(chat_id), now)).fetchone()
            if row:
                return {
                    "muted_by": row[0],
                    "until_ts": row[1],
                    "seconds_left": max(0, row[1] - now),
                }
            return None
    except Exception:
        return None


def order_pending_prank(chat_id: int, buyer_id: int, target_user_id: int, target_name: str, prank_type: str, extra_text: str = "") -> dict:
    """Заказывает розыгрыш (compliment_bomb, fake_ban) на участника чата."""
    now = int(time.time())
    t_name = str(target_name or "").strip()[:64] or f"Участник {target_user_id}"
    p_type = str(prank_type).strip()[:32]
    e_text = str(extra_text or "").strip()[:250]
    try:
        with _connect() as conn:
            conn.execute(
                """
                INSERT INTO pending_pranks (chat_id, buyer_id, target_user_id, target_name, prank_type, extra_text, used, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (int(chat_id), int(buyer_id), int(target_user_id), t_name, p_type, e_text, now),
            )
            return {"ordered": True, "target_name": t_name, "prank_type": p_type}
    except Exception as e:
        return {"error": str(e)}


def get_pending_prank(chat_id: int, target_user_id: int | None = None) -> dict | None:
    """Возвращает ожидающий выполнения розыгрыш для чата/участника."""
    if not chat_id:
        return None
    try:
        with _connect() as conn:
            if target_user_id:
                row = conn.execute(
                    """
                    SELECT id, buyer_id, target_user_id, target_name, prank_type, extra_text
                    FROM pending_pranks
                    WHERE chat_id = ? AND target_user_id = ? AND used = 0
                    ORDER BY created_at ASC LIMIT 1
                    """,
                    (int(chat_id), int(target_user_id)),
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    SELECT id, buyer_id, target_user_id, target_name, prank_type, extra_text
                    FROM pending_pranks
                    WHERE chat_id = ? AND used = 0
                    ORDER BY created_at ASC LIMIT 1
                    """,
                    (int(chat_id),),
                ).fetchone()

            if row:
                return {
                    "prank_id": row[0],
                    "buyer_id": row[1],
                    "target_user_id": row[2],
                    "target_name": row[3],
                    "prank_type": row[4],
                    "extra_text": row[5],
                }
            return None
    except Exception:
        return None


def consume_pending_prank(prank_id: int) -> bool:
    """Помечает заказанный розыгрыш как выполненный."""
    try:
        with _connect() as conn:
            conn.execute("UPDATE pending_pranks SET used = 1 WHERE id = ?", (int(prank_id),))
            return True
    except Exception:
        return False


# ==========================================
# ЕЖЕНЕДЕЛЬНЫЙ КУБОК ЧАТА / ТУРНИРНАЯ ЛИГА
# ==========================================

def _get_current_season_meta() -> tuple[str, int, str, str]:
    """Вычисляет идентификатор сезона, номер недели и даты начала/конца текущей недели."""
    import datetime
    today = datetime.date.today()
    # Номер недели по ISO
    year, week, weekday = today.isocalendar()
    season_id = f"season_{year}_w{week:02d}"
    # Понедельник текущей недели
    monday = today - datetime.timedelta(days=weekday - 1)
    # Воскресенье текущей недели
    sunday = monday + datetime.timedelta(days=6)
    return season_id, week, monday.isoformat(), sunday.isoformat()


def get_current_tournament(chat_id: int | None = None) -> dict:
    """Возвращает информацию о текущем еженедельном турнире."""
    season_id, week_num, start_d, end_d = _get_current_season_meta()
    now = int(time.time())
    try:
        with _connect() as conn:
            conn.execute(
                """
                INSERT INTO weekly_tournaments (season_id, week_number, start_date, end_date, active, created_at)
                VALUES (?, ?, ?, ?, 1, ?)
                ON CONFLICT(season_id) DO NOTHING
                """,
                (season_id, week_num, start_d, end_d, now),
            )
            # Деактивируем прошлые недели
            conn.execute(
                "UPDATE weekly_tournaments SET active = 0 WHERE season_id != ? AND end_date < ?",
                (season_id, start_d),
            )
            t_row = conn.execute(
                "SELECT season_id, week_number, start_date, end_date, active FROM weekly_tournaments WHERE season_id = ?",
                (season_id,),
            ).fetchone()
            tournament_info = {
                "season_id": t_row[0] if t_row else season_id,
                "week_number": t_row[1] if t_row else week_num,
                "start_date": t_row[2] if t_row else start_d,
                "end_date": t_row[3] if t_row else end_d,
                "active": bool(t_row[4]) if t_row else True,
            }
    except Exception:
        tournament_info = {
            "season_id": season_id,
            "week_number": week_num,
            "start_date": start_d,
            "end_date": end_d,
            "active": True,
        }

    leaderboard = get_tournament_leaderboard(season_id=season_id, chat_id=chat_id, limit=10)
    tournament_info["leaderboard"] = leaderboard
    return tournament_info


def add_tournament_points(user_id: int, user_name: str, points: int, chat_id: int | None = None) -> dict:
    """Начисляет турнирные очки игроку в текущий сезон."""
    if not user_id or points <= 0:
        return {"season_id": "", "points": 0}
    season_id, _, _, _ = _get_current_season_meta()
    now = int(time.time())
    u_name = str(user_name or "").strip()[:64] or f"Игрок {user_id}"
    cid = int(chat_id) if chat_id else None

    try:
        with _connect() as conn:
            # Гарантируем регистрацию сезона
            get_current_tournament(chat_id)
            conn.execute(
                """
                INSERT INTO tournament_scores (season_id, chat_id, user_id, user_name, points, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(season_id, chat_id, user_id) DO UPDATE SET
                    points = tournament_scores.points + excluded.points,
                    user_name = excluded.user_name,
                    updated_at = excluded.updated_at
                """,
                (season_id, cid, int(user_id), u_name, int(points), now),
            )
            row = conn.execute(
                "SELECT points FROM tournament_scores WHERE season_id = ? AND user_id = ? AND (chat_id = ? OR (chat_id IS NULL AND ? IS NULL))",
                (season_id, int(user_id), cid, cid),
            ).fetchone()
            total = row[0] if row else points
            return {"season_id": season_id, "user_id": user_id, "total_points": total}
    except Exception as e:
        return {"error": str(e)}


def get_tournament_leaderboard(season_id: str | None = None, chat_id: int | None = None, limit: int = 10) -> list[dict]:
    """Возвращает лидерборд участников текущего или указанного турнира."""
    if not season_id:
        season_id, _, _, _ = _get_current_season_meta()
    limit = max(1, min(int(limit or 10), 50))

    try:
        with _connect() as conn:
            if chat_id:
                query = """
                    SELECT user_id, user_name, SUM(points) as total_pts
                    FROM tournament_scores
                    WHERE season_id = ? AND (chat_id = ? OR chat_id IS NULL)
                    GROUP BY user_id
                    ORDER BY total_pts DESC
                    LIMIT ?
                """
                rows = conn.execute(query, (season_id, int(chat_id), limit)).fetchall()
            else:
                query = """
                    SELECT user_id, user_name, SUM(points) as total_pts
                    FROM tournament_scores
                    WHERE season_id = ?
                    GROUP BY user_id
                    ORDER BY total_pts DESC
                    LIMIT ?
                """
                rows = conn.execute(query, (season_id, limit)).fetchall()

            result = []
            for idx, r in enumerate(rows):
                badge = "🥇" if idx == 0 else ("🥈" if idx == 1 else ("🥉" if idx == 2 else f"#{idx+1}"))
                result.append({
                    "rank": idx + 1,
                    "badge": badge,
                    "user_id": r[0],
                    "user_name": r[1] or f"Игрок {r[0]}",
                    "points": r[2] or 0,
                })

            # Если в турнирной таблице текущей недели пока нет очков,
            # делаем фолбэк на суммарный рейтинг игроков из game_scores (чтобы лидерборд никогда не пустовал)
            if not result:
                if chat_id:
                    fallback_query = """
                        SELECT user_id, user_name, SUM(score) as total_pts
                        FROM game_scores
                        WHERE (chat_id = ? OR chat_id IS NULL)
                        GROUP BY user_id
                        ORDER BY total_pts DESC
                        LIMIT ?
                    """
                    fb_rows = conn.execute(fallback_query, (int(chat_id), limit)).fetchall()
                else:
                    fallback_query = """
                        SELECT user_id, user_name, SUM(score) as total_pts
                        FROM game_scores
                        GROUP BY user_id
                        ORDER BY total_pts DESC
                        LIMIT ?
                    """
                    fb_rows = conn.execute(fallback_query, (limit,)).fetchall()

                for idx, r in enumerate(fb_rows):
                    badge = "🥇" if idx == 0 else ("🥈" if idx == 1 else ("🥉" if idx == 2 else f"#{idx+1}"))
                    result.append({
                        "rank": idx + 1,
                        "badge": badge,
                        "user_id": r[0],
                        "user_name": r[1] or f"Игрок {r[0]}",
                        "points": r[2] or 0,
                    })

            return result
    except Exception:
        return []


def award_weekly_tournament_winners(season_id: str | None = None) -> list[dict]:
    """Подводит итоги турнира: начисляет монеты и почетные титулы топ-3 призерам."""
    if not season_id:
        season_id, _, _, _ = _get_current_season_meta()

    winners = get_tournament_leaderboard(season_id=season_id, limit=3)
    awards = [
        {"reward_coins": 500, "title": "🏆 Чемпион Кубка Чата"},
        {"reward_coins": 300, "title": "🥈 Вице-чемпион Лиги"},
        {"reward_coins": 150, "title": "🥉 Бронзовый призер Лиги"},
    ]
    results = []
    for idx, winner in enumerate(winners):
        if idx >= len(awards):
            break
        uid = winner["user_id"]
        award = awards[idx]
        add_coins(uid, award["reward_coins"], reason=f"tournament_reward:{season_id}")
        results.append({
            "user_id": uid,
            "user_name": winner["user_name"],
            "rank": idx + 1,
            "coins": award["reward_coins"],
            "title": award["title"],
        })
    return results


# ==========================================
# ДОСТИЖЕНИЯ И БЕЙДЖИ (ACHIEVEMENTS)
# ==========================================

ACHIEVEMENTS_LIST = [
    # --- Мини-игры ---
    {
        "id": "tower_master",
        "name": "Небоскреб качалки",
        "desc": "Построить башню от 20 этажей в Tower Stack",
        "icon": "🏗️",
        "reward": 150,
        "category": "minigames",
        "req_progress": 20,
    },
    {
        "id": "timber_beast",
        "name": "Лесоруб Билли",
        "desc": "Набрать 50+ очков в Timberman",
        "icon": "🪓",
        "reward": 150,
        "category": "minigames",
        "req_progress": 50,
    },
    {
        "id": "knife_sniper",
        "name": "Мастер спанкинга",
        "desc": "Набрать 30+ очков в Knife Hit",
        "icon": "🗡️",
        "reward": 150,
        "category": "minigames",
        "req_progress": 30,
    },
    {
        "id": "hoop_legend",
        "name": "Dungeon Slammer",
        "desc": "Забить 15+ мячей в Баскетболе",
        "icon": "🏀",
        "reward": 150,
        "category": "minigames",
        "req_progress": 15,
    },
    {
        "id": "brick_breaker",
        "name": "Дробитель кирпичей",
        "desc": "Набрать 500+ очков в Арканоиде",
        "icon": "🧱",
        "reward": 150,
        "category": "minigames",
        "req_progress": 500,
    },
    {
        "id": "color_god",
        "name": "Радужный флекс",
        "desc": "Набрать 25+ очков в Color Switch",
        "icon": "🌈",
        "reward": 150,
        "category": "minigames",
        "req_progress": 25,
    },
    {
        "id": "hockey_pro",
        "name": "Гроза шайбы",
        "desc": "Набрать 7+ очков в Аэрохоккее",
        "icon": "🏒",
        "reward": 150,
        "category": "minigames",
        "req_progress": 7,
    },
    {
        "id": "mole_hunter",
        "name": "Каратель Джаброни",
        "desc": "Набрать 40+ очков в Whack-a-Mole",
        "icon": "🔨",
        "reward": 150,
        "category": "minigames",
        "req_progress": 40,
    },
    {
        "id": "math_genius",
        "name": "Сила 2048",
        "desc": "Собрать плитку 2048 в игре",
        "icon": "🔢",
        "reward": 300,
        "category": "minigames",
        "req_progress": 2048,
    },
    {
        "id": "all_rounder",
        "name": "Универсальный атлет",
        "desc": "Сыграть во все 9 мини-игр клуба",
        "icon": "🏅",
        "reward": 400,
        "category": "minigames",
        "req_progress": 9,
    },
    {
        "id": "game_champion",
        "name": "Покоритель аркад",
        "desc": "Сыграть суммарно 50 раз в мини-игры",
        "icon": "🕹️",
        "reward": 250,
        "category": "minigames",
        "req_progress": 50,
    },
    # --- Активность и Чат ---
    {
        "id": "first_words",
        "name": "Добро пожаловать в клуб",
        "desc": "Отправить первое сообщение боту",
        "icon": "💬",
        "reward": 50,
        "category": "chat",
        "req_progress": 1,
    },
    {
        "id": "chat_warrior",
        "name": "Разговорчивый слейв",
        "desc": "Написать 100+ сообщений в чатах",
        "icon": "🗣️",
        "reward": 200,
        "category": "chat",
        "req_progress": 100,
    },
    {
        "id": "night_owl",
        "name": "Ночной качок",
        "desc": "Общаться с ботом после 02:00 ночи (02:00 - 05:00)",
        "icon": "🦉",
        "reward": 100,
        "category": "chat",
        "req_progress": 1,
    },
    {
        "id": "chat_veteran",
        "name": "Ветеран качалки",
        "desc": "Написать 500+ сообщений в чатах",
        "icon": "🎖️",
        "reward": 500,
        "category": "chat",
        "req_progress": 500,
    },
    # --- Экономика и Магазин ---
    {
        "id": "streak_week",
        "name": "Железная дисциплина",
        "desc": "Стрик ежедневного входа 7 дней подряд",
        "icon": "🔥",
        "reward": 300,
        "category": "economy",
        "req_progress": 7,
    },
    {
        "id": "first_purchase",
        "name": "Первая примерка кожи",
        "desc": "Купить любой товар в магазине",
        "icon": "🛍️",
        "reward": 100,
        "category": "economy",
        "req_progress": 1,
    },
    {
        "id": "big_spender",
        "name": "Three Hundred Bucks",
        "desc": "Потратить суммарно 300+ монет в магазине",
        "icon": "💵",
        "reward": 200,
        "category": "economy",
        "req_progress": 300,
    },
    {
        "id": "gold_hoard",
        "name": "Золотой слиток",
        "desc": "Накопить баланс от 1000 монет",
        "icon": "💰",
        "reward": 250,
        "category": "economy",
        "req_progress": 1000,
    },
    {
        "id": "lord_of_gym",
        "name": "Boss of this Gym",
        "desc": "Накопить 5000 монет или купить VIP-статус",
        "icon": "👑",
        "reward": 1000,
        "category": "economy",
        "req_progress": 1,
    },
    # --- Инвентарь ---
    {
        "id": "first_gear",
        "name": "Первый лут",
        "desc": "Получить свой первый предмет в инвентарь",
        "icon": "📦",
        "reward": 50,
        "category": "inventory",
        "req_progress": 1,
    },
    {
        "id": "hoarder",
        "name": "Плюшкин подземелья",
        "desc": "Собрать 10 уникальных предметов в инвентаре",
        "icon": "🎒",
        "reward": 200,
        "category": "inventory",
        "req_progress": 10,
    },
    # --- НОВЫЕ ДОСТИЖЕНИЯ: Мини-игры (Элитные и Мастерские) ---
    {
        "id": "tower_titan",
        "name": "Титанический жим",
        "desc": "Построить башню от 40 этажей в Tower Stack",
        "icon": "🏛️",
        "reward": 350,
        "category": "minigames",
        "req_progress": 40,
    },
    {
        "id": "timber_legend",
        "name": "Реликтовый дровосек",
        "desc": "Набрать 100+ очков в Timberman",
        "icon": "🌲",
        "reward": 350,
        "category": "minigames",
        "req_progress": 100,
    },
    {
        "id": "knife_god",
        "name": "Виртуозный спанкинг",
        "desc": "Набрать 60+ очков в Knife Hit",
        "icon": "⚔️",
        "reward": 350,
        "category": "minigames",
        "req_progress": 60,
    },
    {
        "id": "hoop_allstar",
        "name": "Слэмданк Чемпион",
        "desc": "Забить 30+ мячей в Баскетболе",
        "icon": "🔥",
        "reward": 350,
        "category": "minigames",
        "req_progress": 30,
    },
    {
        "id": "brick_annihilator",
        "name": "Сокрушитель блоков",
        "desc": "Набрать 1500+ очков в Арканоиде",
        "icon": "💥",
        "reward": 350,
        "category": "minigames",
        "req_progress": 1500,
    },
    {
        "id": "color_master",
        "name": "Повелитель спектра",
        "desc": "Набрать 50+ очков в Color Switch",
        "icon": "🔮",
        "reward": 350,
        "category": "minigames",
        "req_progress": 50,
    },
    {
        "id": "hockey_legend",
        "name": "Ледовый Монарх",
        "desc": "Набрать 15+ очков в Аэрохоккее",
        "icon": "🏆",
        "reward": 350,
        "category": "minigames",
        "req_progress": 15,
    },
    {
        "id": "mole_terminator",
        "name": "Гроза всех Джаброни",
        "desc": "Набрать 80+ очков в Whack-a-Mole",
        "icon": "⚡",
        "reward": 350,
        "category": "minigames",
        "req_progress": 80,
    },
    {
        "id": "math_emperor",
        "name": "Магистр 4096",
        "desc": "Собрать плитку 4096 в 2048 Gym Power",
        "icon": "♾️",
        "reward": 600,
        "category": "minigames",
        "req_progress": 4096,
    },
    {
        "id": "arcade_god",
        "name": "Легенда игровых автоматов",
        "desc": "Сыграть суммарно 100 раз в мини-игры клуба",
        "icon": "👑",
        "reward": 500,
        "category": "minigames",
        "req_progress": 100,
    },
    # --- НОВЫЕ ДОСТИЖЕНИЯ: Общение и Чат ---
    {
        "id": "chat_legend",
        "name": "Голос Подземелья",
        "desc": "Написать 1000+ сообщений в чатах",
        "icon": "📢",
        "reward": 800,
        "category": "chat",
        "req_progress": 1000,
    },
    {
        "id": "lethal_gladiator",
        "name": "Смертоносный боец",
        "desc": "Совершить 5 смертельных ударов персонажам в ролевой игре",
        "icon": "💀",
        "reward": 300,
        "category": "chat",
        "req_progress": 5,
    },
    {
        "id": "early_bird",
        "name": "Утренняя разминка",
        "desc": "Общаться в чате ранним утром (с 06:00 до 09:00)",
        "icon": "🌅",
        "reward": 150,
        "category": "chat",
        "req_progress": 1,
    },
    {
        "id": "story_explorer",
        "name": "Исследователь судеб",
        "desc": "Опробовать 5 различных архетипов персонажей",
        "icon": "🎭",
        "reward": 250,
        "category": "chat",
        "req_progress": 5,
    },
    # --- НОВЫЕ ДОСТИЖЕНИЯ: Экономика и Магазин ---
    {
        "id": "streak_month",
        "name": "Стальной характер",
        "desc": "Стрик ежедневного входа 30 дней подряд",
        "icon": "💎",
        "reward": 1000,
        "category": "economy",
        "req_progress": 30,
    },
    {
        "id": "shopaholic",
        "name": "Постоянный клиент $300 Store",
        "desc": "Купить 5 различных товаров или розыгрышей в магазине",
        "icon": "🛍️",
        "reward": 300,
        "category": "economy",
        "req_progress": 5,
    },
    {
        "id": "millionaire_slave",
        "name": "Олигарх Качалки",
        "desc": "Накопить баланс от 3000 монет",
        "icon": "🏦",
        "reward": 500,
        "category": "economy",
        "req_progress": 3000,
    },
    {
        "id": "cup_champion",
        "name": "Покоритель Кубка",
        "desc": "Набрать 500+ турнирных очков в еженедельном кубке",
        "icon": "🏆",
        "reward": 500,
        "category": "economy",
        "req_progress": 500,
    },
    # --- НОВЫЕ ДОСТИЖЕНИЯ: Инвентарь и Коллекция ---
    {
        "id": "leather_collector",
        "name": "Коллекционер кожи",
        "desc": "Собрать 20 уникальных предметов в инвентаре",
        "icon": "🥋",
        "reward": 400,
        "category": "inventory",
        "req_progress": 20,
    },
    {
        "id": "generous_master",
        "name": "Щедрый Босс",
        "desc": "Передать предмет другому игроку через команду /giveitem",
        "icon": "🤝",
        "reward": 150,
        "category": "inventory",
        "req_progress": 1,
    },
]

ACHIEVEMENT_MAP = {ach["id"]: ach for ach in ACHIEVEMENTS_LIST}


def check_and_unlock_achievement(user_id: int, achievement_id: str) -> bool:
    """Проверяет и открывает достижение для пользователя, если оно еще не открыто."""
    if not user_id or achievement_id not in ACHIEVEMENT_MAP:
        return False
    now = int(time.time())
    try:
        with _connect() as conn:
            # Проверяем, существует ли уже разблокировка
            row = conn.execute(
                "SELECT id FROM user_achievements WHERE user_id = ? AND achievement_id = ?",
                (int(user_id), str(achievement_id)),
            ).fetchone()
            if row:
                return False  # Уже открыто

            conn.execute(
                """
                INSERT INTO user_achievements (user_id, achievement_id, unlocked_at, claimed)
                VALUES (?, ?, ?, 0)
                """,
                (int(user_id), str(achievement_id), now),
            )
            return True
    except Exception:
        return False


def get_user_achievements(user_id: int) -> list[dict]:
    """Возвращает полный список достижений с текущим статусом и прогрессом для пользователя."""
    if not user_id:
        return []

    unlocked_map = {}
    try:
        with _connect() as conn:
            rows = conn.execute(
                "SELECT achievement_id, unlocked_at, claimed FROM user_achievements WHERE user_id = ?",
                (int(user_id),),
            ).fetchall()
            for r in rows:
                unlocked_map[r[0]] = {
                    "unlocked_at": r[1],
                    "claimed": bool(r[2]),
                }
    except Exception:
        pass

    # Вычисляем прогресс по категориям
    progress_map = _calculate_user_achievement_progress(int(user_id))

    result = []
    for ach in ACHIEVEMENTS_LIST:
        ach_id = ach["id"]
        is_unlocked = ach_id in unlocked_map
        is_claimed = unlocked_map[ach_id]["claimed"] if is_unlocked else False
        unlocked_at = unlocked_map[ach_id]["unlocked_at"] if is_unlocked else 0
        curr_progress = progress_map.get(ach_id, 0)
        req_progress = ach.get("req_progress", 1)

        result.append({
            "id": ach_id,
            "name": ach["name"],
            "desc": ach["desc"],
            "icon": ach["icon"],
            "reward": ach["reward"],
            "category": ach["category"],
            "req_progress": req_progress,
            "current_progress": min(curr_progress, req_progress) if not is_unlocked else req_progress,
            "unlocked": is_unlocked,
            "claimed": is_claimed,
            "unlocked_at": unlocked_at,
        })
    return result


def _calculate_user_achievement_progress(user_id: int) -> dict:
    """Вспомогательная функция для подсчета текущего прогресса пользователя по всем ачивкам."""
    progress = {}
    try:
        with _connect() as conn:
            # 1. Лучшие рекорды по мини-играм
            scores = conn.execute(
                """
                SELECT COALESCE(game_id, game_name) as g_key, MAX(score)
                FROM game_scores
                WHERE user_id = ?
                GROUP BY g_key
                """,
                (user_id,),
            ).fetchall()
            game_bests = {r[0]: (r[1] or 0) for r in scores}
            total_games_played = conn.execute(
                "SELECT COUNT(*) FROM game_scores WHERE user_id = ?",
                (user_id,),
            ).fetchone()[0]

            progress["tower_master"] = game_bests.get("tower_stack", 0)
            progress["tower_titan"] = game_bests.get("tower_stack", 0)
            progress["timber_beast"] = game_bests.get("timberjack", 0)
            progress["timber_legend"] = game_bests.get("timberjack", 0)
            progress["knife_sniper"] = game_bests.get("knife_hit", 0)
            progress["knife_god"] = game_bests.get("knife_hit", 0)
            progress["hoop_legend"] = game_bests.get("swipe_basketball", 0)
            progress["hoop_allstar"] = game_bests.get("swipe_basketball", 0)
            progress["brick_breaker"] = game_bests.get("brick_breaker", 0)
            progress["brick_annihilator"] = game_bests.get("brick_breaker", 0)
            progress["color_god"] = game_bests.get("colorswitch", 0)
            progress["color_master"] = game_bests.get("colorswitch", 0)
            progress["hockey_pro"] = game_bests.get("air_hockey", 0)
            progress["hockey_legend"] = game_bests.get("air_hockey", 0)
            progress["mole_hunter"] = game_bests.get("whack_mole", 0)
            progress["mole_terminator"] = game_bests.get("whack_mole", 0)
            progress["math_genius"] = game_bests.get("game_2048", 0)
            progress["math_emperor"] = game_bests.get("game_2048", 0)

            # Универсальный атлет: количество уникальных сыгранных игр из 9
            unique_played = len([k for k in [
                "tower_stack", "timberjack", "knife_hit", "swipe_basketball",
                "brick_breaker", "colorswitch", "air_hockey", "whack_mole", "game_2048"
            ] if k in game_bests])
            progress["all_rounder"] = unique_played
            progress["game_champion"] = total_games_played
            progress["arcade_god"] = total_games_played

            # 2. Активность и чат
            msg_sum = conn.execute(
                "SELECT COALESCE(SUM(messages_count), 0) FROM chat_stats WHERE user_id = ?",
                (user_id,),
            ).fetchone()[0]
            lethal_sum = conn.execute(
                "SELECT COALESCE(SUM(lethal_strikes), 0) FROM chat_stats WHERE user_id = ?",
                (user_id,),
            ).fetchone()[0]
            archetypes_tried = conn.execute(
                "SELECT COUNT(DISTINCT key) FROM chat_archetypes WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            archetypes_count = (archetypes_tried[0] if archetypes_tried else 0) or 1

            econ = conn.execute(
                "SELECT coins, daily_streak, total_spent, total_messages FROM user_economy WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            total_msgs = max(msg_sum, econ[3] if econ and len(econ) > 3 and econ[3] else 0)

            progress["first_words"] = 1 if total_msgs >= 1 else 0
            progress["chat_warrior"] = total_msgs
            progress["chat_veteran"] = total_msgs
            progress["chat_legend"] = total_msgs
            progress["lethal_gladiator"] = lethal_sum
            progress["story_explorer"] = archetypes_count

            # 3. Экономика
            coins = econ[0] if econ and econ[0] else 0
            streak = econ[1] if econ and econ[1] else 0
            total_spent = econ[2] if econ and len(econ) > 2 and econ[2] else 0
            purchases_count = conn.execute(
                "SELECT COUNT(*) FROM user_perks WHERE user_id = ?",
                (user_id,),
            ).fetchone()[0]
            has_vip = conn.execute(
                "SELECT 1 FROM user_perks WHERE user_id = ? AND perk_id = 'vip_badge' AND active = 1",
                (user_id,),
            ).fetchone() is not None

            # Турнирные очки
            season_meta = _get_current_season_meta()
            season_pts_row = conn.execute(
                "SELECT SUM(points) FROM tournament_scores WHERE season_id = ? AND user_id = ?",
                (season_meta[0], user_id),
            ).fetchone()
            season_pts = (season_pts_row[0] if season_pts_row and season_pts_row[0] else 0)

            progress["streak_week"] = streak
            progress["streak_month"] = streak
            progress["first_purchase"] = 1 if purchases_count >= 1 else 0
            progress["shopaholic"] = purchases_count
            progress["big_spender"] = total_spent
            progress["gold_hoard"] = coins
            progress["millionaire_slave"] = coins
            progress["lord_of_gym"] = 1 if (coins >= 5000 or has_vip) else 0
            progress["cup_champion"] = season_pts

            # 4. Инвентарь
            inv_count = conn.execute(
                "SELECT COUNT(DISTINCT item_name) FROM inventory WHERE user_id = ?",
                (user_id,),
            ).fetchone()[0]
            progress["first_gear"] = min(1, inv_count)
            progress["hoarder"] = inv_count
            progress["leather_collector"] = inv_count
            progress["generous_master"] = 1 if total_spent > 0 or purchases_count > 0 else 0

    except Exception:
        pass
    return progress


def check_user_achievements(user_id: int) -> list[str]:
    """Проверяет все условия достижений пользователя и автоматически разблокирует выполненные.
    Возвращает список ID вновь разблокированных ачивок.
    """
    if not user_id:
        return []
    progress_map = _calculate_user_achievement_progress(int(user_id))
    unlocked_now = []

    # Специальная проверка ночного времени (02:00 - 05:00) и раннего утра (06:00 - 09:00)
    import datetime
    now_hour = datetime.datetime.now().hour
    if 2 <= now_hour < 5:
        progress_map["night_owl"] = 1
    if 6 <= now_hour < 9:
        progress_map["early_bird"] = 1

    for ach in ACHIEVEMENTS_LIST:
        ach_id = ach["id"]
        req = ach.get("req_progress", 1)
        curr = progress_map.get(ach_id, 0)
        if curr >= req:
            if check_and_unlock_achievement(user_id, ach_id):
                unlocked_now.append(ach_id)

    return unlocked_now


def claim_achievement_reward(user_id: int, achievement_id: str) -> dict:
    """Начисляет награду в монетах за выполненное достижение."""
    if not user_id:
        return {"success": False, "message": "Не указан пользователь"}
    ach = ACHIEVEMENT_MAP.get(achievement_id)
    if not ach:
        return {"success": False, "message": "Достижение не найдено"}

    try:
        with _connect() as conn:
            row = conn.execute(
                "SELECT claimed FROM user_achievements WHERE user_id = ? AND achievement_id = ?",
                (int(user_id), str(achievement_id)),
            ).fetchone()

            if not row:
                # Попробуем проверить, может оно выполнено прямо сейчас
                check_user_achievements(int(user_id))
                row = conn.execute(
                    "SELECT claimed FROM user_achievements WHERE user_id = ? AND achievement_id = ?",
                    (int(user_id), str(achievement_id)),
                ).fetchone()
                if not row:
                    return {"success": False, "message": "Достижение еще не выполнено!"}

            if row[0]:
                return {"success": False, "message": "Награда за это достижение уже получена!"}

            conn.execute(
                "UPDATE user_achievements SET claimed = 1 WHERE user_id = ? AND achievement_id = ?",
                (int(user_id), str(achievement_id)),
            )

        reward = ach["reward"]
        new_balance = add_coins(user_id, reward, reason=f"achievement:{achievement_id}")
        return {
            "success": True,
            "achievement_id": achievement_id,
            "reward": reward,
            "balance": new_balance,
            "message": f"🎉 Получена награда +{reward} 🪙 за «{ach['name']}»!",
        }
    except Exception as e:
        return {"success": False, "message": f"Ошибка клейма: {e}"}


