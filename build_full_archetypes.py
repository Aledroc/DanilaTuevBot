# -*- coding: utf-8 -*-
"""Скрипт сборки финального archetypes.py из 7 категорий (560 архетипов)."""

import ast
import re

from cat1_communal_trash import CAT1_COMMUNAL_TRASH
from cat2_yard_and_garages import CAT2_YARD_GARAGES
from cat3_street_service import CAT3_STREET_SERVICE
from cat4_family_feasts import CAT4_FAMILY_FEASTS
from cat5_internet_freaks import CAT5_INTERNET_FREAKS
from cat6_gamer_trash import CAT6_GAMER_TRASH
from cat7_provincial_folklore import CAT7_PROVINCIAL_FOLKLORE

CATEGORIES = [
    ("1. ОБЩАЖНЫЙ, КОММУНАЛЬНЫЙ И КВАРТИРНЫЙ ТРЕШ (80 АРХЕТИПОВ)", CAT1_COMMUNAL_TRASH),
    ("2. ДВОР, ГАРАЖИ, ПОДЪЕЗД И СПАЛЬНЫЙ РАЙОН (80 АРХЕТИПОВ)", CAT2_YARD_GARAGES),
    ("3. СЕРВИСНЫЙ, УЛИЧНЫЙ И БАЗАРНЫЙ КОЛОРИТ (80 АРХЕТИПОВ)", CAT3_STREET_SERVICE),
    ("4. СЕМЕЙНЫЙ, ЗАСТОЛЬНЫЙ И БЫТОВОЙ ТРЭШ (80 АРХЕТИПОВ)", CAT4_FAMILY_FEASTS),
    ("5. ИНТЕРНЕТ-ФРИКИ, ТЕМЩИКИ И СОЦСЕТЕВОЙ УГАР (80 АРХЕТИПОВ)", CAT5_INTERNET_FREAKS),
    ("6. ГЕЙМЕРСКИЙ ЖИТЕЙСКИЙ ТРЭШ И УГАР В ГОЛОСОВЫХ ЧАТАХ (80 АРХЕТИПОВ)", CAT6_GAMER_TRASH),
    ("7. АБСУРДНЫЙ ДЕРЕВЕНСКИЙ ФОЛЬКЛОР И ПОТУСТОРОННИЙ ТРЭШ (80 АРХЕТИПОВ)", CAT7_PROVINCIAL_FOLKLORE),
]

def build():
    lines = []
    lines.append('"""Масштабная база уникальных, абсурдных, жизненных и мемных ролевых архетипов (560 штук).')
    lines.append('')
    lines.append('Чистый житейский треш, гаражный колорит, коммунальный угар, базарные кадры,')
    lines.append('интернет-фрики, геймерские мемы и деревенские байки.')
    lines.append('У каждого архетипа есть характерная манера речи, действие в звездочках (*...*)')
    lines.append('и мгновенный импульс втянуть собеседника в тупой и смешной интерактив.')
    lines.append('"""')
    lines.append('')
    lines.append('BASE_ARCHETYPES = {')

    total_count = 0
    for cat_title, cat_dict in CATEGORIES:
        lines.append('    # ' + '=' * 73)
        lines.append(f'    # {cat_title}')
        lines.append('    # ' + '=' * 73)
        for key, (name, prompt) in cat_dict.items():
            total_count += 1
            # escape double quotes and backslashes if any
            name_escaped = name.replace('\\', '\\\\').replace('"', '\\"')
            prompt_escaped = prompt.replace('\\', '\\\\').replace('"', '\\"')
            lines.append(f'    "{key}": (')
            lines.append(f'        "{name_escaped}",')
            lines.append(f'        "{prompt_escaped}",')
            lines.append('    ),')
        lines.append('')

    lines.append('}')
    lines.append('')
    lines.append('# DEFAULT_ARCHETYPES: самые яркие 25 архетипов для быстрого выбора')
    lines.append('DEFAULT_ARCHETYPES = {')
    lines.append('    key: (value[0], value[1]) for key, value in list(BASE_ARCHETYPES.items())[:25]')
    lines.append('}')
    lines.append('')

    content = '\n'.join(lines)

    # Validate with AST
    parsed = ast.parse(content)
    print(f'AST validation successful! Nodes count: {len(parsed.body)}')
    print(f'Total archetypes written: {total_count}')

    target_path = r'c:\Users\Aledroc\Desktop\Бот\archetypes.py'
    with open(target_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'Successfully wrote {target_path} ({len(content)} bytes, {len(lines)} lines)')

if __name__ == '__main__':
    build()
