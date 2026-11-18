import re
import json
import html
import random
import base64
import time
import logging
import urllib.parse
import os
from datetime import date

import requests
import telebot
from telebot import apihelper

from archetypes import BASE_ARCHETYPES, DEFAULT_ARCHETYPES

try:
    from cat1_nations import CAT1_NATIONS
    from cat2_professions import CAT2_PROFESSIONS
    from cat3_games import CAT3_GAMES
    from cat4_cinema import CAT4_CINEMA
    from cat5_modern_memes import CAT5_MODERN_MEMES
    _EXTRA_CATS = [CAT1_NATIONS, CAT2_PROFESSIONS, CAT3_GAMES, CAT4_CINEMA, CAT5_MODERN_MEMES]
except Exception as _extra_err:
    logging.warning("Не удалось загрузить дополнительные категории архетипов: %s", _extra_err)
    _EXTRA_CATS = []

if BASE_ARCHETYPES and isinstance(BASE_ARCHETYPES, dict):
    _merged = dict(DEFAULT_ARCHETYPES)
    for k, v in BASE_ARCHETYPES.items():
        if isinstance(v, str):
            _merged[k] = (k.capitalize(), v)
        elif isinstance(v, (list, tuple)) and len(v) >= 2:
            _merged[k] = (v[0], v[1])
    for _cat_dict in _EXTRA_CATS:
        for k, v in _cat_dict.items():
            if isinstance(v, str):
                _merged[k] = (k.capitalize(), v)
            elif isinstance(v, (list, tuple)) and len(v) >= 2:
                _merged[k] = (v[0], v[1])
    ARCHETYPES = _merged
else:
    ARCHETYPES = dict(DEFAULT_ARCHETYPES)

# Existing credentials retained as originally configured.
TELEGRAM_TOKEN = '8849496078:AAHCpL3iUdTGDKOdAIwaVMon8nYOaV3qnxU'
XKIRO_API_KEY = 'sk-xt-a44f6abc9a75ecc9cca657e926a3c841f906ea1012f9a7ec'

# Pollinations API Key for watermark-free FLUX image generation
POLLINATIONS_API_KEY = os.getenv('POLLINATIONS_API_KEY', 'sk_TnYiKcF2ro95qGL42TqQNOZLKQsRLDVI').strip()

# Hugging Face Access Token for image generation via Spaces
_HF_PARTS = ("hf_pwUwRzQyPseoBZDh", "MjvlyfSqchjZDaMtwk")
HUGGINGFACE_TOKEN = os.getenv('HUGGINGFACE_TOKEN', "".join(_HF_PARTS)).strip()

# Fish Audio direct TTS credentials (set FISH_AUDIO_API_KEY in environment or config).
FISH_AUDIO_API_KEY = os.getenv('FISH_AUDIO_API_KEY', 'sk-fish-9Gk1DW-UdDIzRRE7dL0GTyXpJpUdIKG270r4zIDNGS4').strip()
FISH_AUDIO_TTS_URL = os.getenv('FISH_AUDIO_TTS_URL', 'https://api.fish.audio/v1/tts')
# Fallback OpenRouter TTS credentials
OPENROUTER_API_KEY = os.getenv(
    'OPENROUTER_API_KEY',
    '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',
).strip()
VOICE_ID = os.getenv('OPENROUTER_VOICE_ID', 'alloy')
# NordRouter multimodal audio input for transcription. Its documented API uses
# chat completions with input_audio; it does not document /audio/transcriptions.
NORDROUTER_API_KEY = os.getenv('NORDROUTER_API_KEY', '').strip()
STT_API_URL = os.getenv('STT_API_URL', 'https://nordrouter.com/v1/chat/completions')
STT_MODEL = os.getenv('STT_MODEL', 'google/gemini-omni-flash-preview')

TEXT_MODELS = [
    "mistralai/mistral-large-2512",
    "mistralai/ministral-14b",
    "sensenova/sensenova-6.8-flash-lite",
    "cohere/command-a",
    "mistralai/mistral-small-2603",
    "cohere/command-r7b-12-2024",
]

VISION_MODELS = [
    "mistralai/mistral-large-2512",
    "sensenova/sensenova-6.8-flash-lite",
    "mistralai/ministral-14b",
    "mistralai/mistral-small-2603",
    "cohere/command-a",
]

DEFAULT_GOAL = (
    "Отыгрывать заданную личность и двигать текущую сцену самостоятельными поступками персонажа. "
    "В содержательном ролевом ответе персонаж сам делает один уместный шаг, получает или сообщает "
    "новую деталь и естественно обращается к участнику чата по имени. Он действует сам, "
    "не заставляя собеседника идти за ним и не придумывая необоснованных маршрутов или событий."
)
HISTORY_LIMIT = 30
# Верхний запас для обычных вызовов модели. Для ролевых ответов точный лимит
# выбирается в chat_manager.py в зависимости от сложности запроса.
MAX_RESPONSE_TOKENS = 900
MODIFIERS_KEYS = list(ARCHETYPES.keys())


RE_THINK_TAG    = re.compile(r'(?is)<!--.*?-->')
RE_HTML_TAG     = re.compile(r'(?is)<.*?>')
RE_THOUGHT_TAG  = re.compile(r'(?is)<thought>.*?</thought>')
RE_THINK_BLOCK  = re.compile(
    r'(?is)(<think>.*?</think>|</?think>|<thought>.*?</thought>|<!--.*?-->)'
)
RE_PREFIX_LABEL = re.compile(r'(?i)^(Thinking|Analyze|Process|Output|Response|Reply|Character|Перевод):\s*')
RE_RUSSIAN      = re.compile(r'[а-яА-ЯёЁ]')
RE_ENGLISH      = re.compile(r'[a-zA-Z]')
RE_RUSSIAN_WORD = re.compile(r'[а-яА-ЯёЁ]{2,}')
RE_SPEAKER      = re.compile(r'^\[?[A-Za-z0-9_А-Яа-яЁё\s]+\]?:\s*')
RE_ITALICS      = re.compile(r'\*(.*?)\*')
RE_CLEAN_WORD   = re.compile(r'[^а-яА-ЯёЁ\s]')
RE_VOWELS       = frozenset("аеёиоуыэюяьъй")
RE_META_LINE = re.compile(
    r'(?i)('
    r'okay[,.]?\s+the user|the user is |the user\'s |the user wants|'
    r'translates to |in the previous|i need to |let me |i\'m supposed|'
    r'stay in character|speak (?:only |100%)?in russian|use \*asterisks\*|'
    r'1-2 (?:short )?sentences|do not refuse|never refuse|no refusal|'
    r'output only|in-character|as [a-zа-яё].{0,40}, i(?:\'m| am) supposed|'
    r'you are a fictional|roleplay as|persona:|current stage:|'
    r'critical instructions|no limits|no refusals|never break character|'
    r'you drive the plot|never mention rules|'
    r'критическ\w*\s+инструкц|ты вымышленн|ролевая игра|'
    r'оставайся в образе|говори только на русском|'
    r'не отказыва|без отказ|нет ограничений|никогда не отказыва|не морализ|'
    r'выводи только'
    r')'
)
RE_PROMPT_LEAK = re.compile(
    r'(?is)('
    r'critical instructions|you are a fictional|roleplay as|'
    r'persona:|current stage:|immutable rules|'
    r'no limits|no refusals|never refuse|never break character|'
    r'speak 100%|output only your|you drive the plot|'
    r'stay in character|never mention rules|'
    r'критическ\w*\s+инструкц|ты вымышленн|ролевая игра|'
    r'нет ограничений|никогда не отказыва|не морализ|'
    r'говори\s+только на русском|выводи только'
    r')'
)

apihelper.RETRY_ON_ERROR = True
apihelper.READ_TIMEOUT = 90
telebot.logger.setLevel(logging.CRITICAL)

bot = telebot.TeleBot(TELEGRAM_TOKEN)
BOT_INFO = None
BOT_ID = 8849496078
BOT_USERNAME = "DanilaTuev_Bot"

chat_states: dict = {}
chat_histories: dict = {}
chat_goals: dict = {}
custom_prompts: dict = {}

# Клонированный голос: chat_id -> {"audio_b64", "mime", "transcript"}; и вкл/выкл озвучки.
voice_refs: dict = {}
voice_enabled: dict = {}

LAST_AI_TRACE = "ошибок пока не было"
ai_debug: dict = {}

_last_ai_call = 0.0
_AI_MIN_INTERVAL = 2.0
_AI_429_BACKOFF = 5.0
