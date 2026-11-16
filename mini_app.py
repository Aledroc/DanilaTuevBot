"""Local Telegram Mini App service for inventory and character archetypes."""

import hashlib
import hmac
import json
from decimal import Decimal
import mimetypes
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import inventory
from archetypes import BASE_ARCHETYPES, DEFAULT_ARCHETYPES
try:
    import chat_manager
except Exception:
    chat_manager = None

ROOT = Path(__file__).resolve().parent
WEB_ROOT = ROOT / "miniapp"
BOT_TOKEN = os.getenv("TELEGRAM_TOKEN", "").strip()
if not BOT_TOKEN:
    try:
        import config
        BOT_TOKEN = getattr(config, "TELEGRAM_TOKEN", "").strip()
    except Exception:
        pass
if not BOT_TOKEN:
    BOT_TOKEN = "8849496078:AAHCpL3iUdTGDKOdAIwaVMon8nYOaV3qnxU"
BOT_USERNAME = os.getenv("MINIAPP_BOT_USERNAME", "").strip().lstrip("@")
DEV_MODE = os.getenv("MINIAPP_DEV_MODE", "0").lower() in {"1", "true", "yes"}
PORT = int(os.getenv("MINIAPP_PORT") or os.getenv("PORT") or "10178")


def _ai_item_ideas(item_name: str) -> list[str]:
    """Ask the model what this concrete item is good for.

    Runs in the bot process, where the AI client and its keys are already
    configured. A standalone Mini App (run_miniapp.bat) only loads this module,
    so the import is skipped there and the keyword fallback is used instead.
    """
    try:
        if "config" not in sys.modules:
            return []
        from ai_client import get_ai_response

        instruction = (
            "Ты помогаешь игроку в текстовой ролевой игре с инвентарём. "
            f"Предмет: «{item_name}». Предложи ровно три разных коротких действия "
            "(не больше шести слов каждое), которые можно совершить именно с этим "
            "предметом с учётом его свойств и назначения. Каждое действие — с новой "
            "строки, с глагола в повелительном наклонении, по-русски, без нумерации, "
            "кавычек и пояснений."
        )
        raw = get_ai_response(instruction, max_tokens=120, filter_leak=False) or ""
    except Exception:
        return []
    ideas = []
    for line in raw.splitlines():
        text = line.strip().strip("-—•*0123456789. )\t\"'«»").strip()
        text = re.sub(r"^[0-9]+[.)]\s*", "", text)
        text = " ".join(text.split()).strip(" .;:,-—!?\"'«»")
        if len(text) < 3 or len(text) > 80:
            continue
        if re.search(r"[A-Za-z]{4,}", text):
            continue
        if text.casefold() in {idea.casefold() for idea in ideas}:
            continue
        ideas.append(text)
        if len(ideas) == 3:
            break
    return ideas


def _get_default_fallback_user() -> dict:
    fallback_id = int(os.getenv("MINIAPP_DEV_USER_ID", "0"))
    if not fallback_id:
        try:
            with inventory._connect() as conn:
                row = conn.execute(
                    "SELECT user_id, display_name, username FROM chat_members WHERE user_id > 0 ORDER BY last_seen DESC LIMIT 1"
                ).fetchone()
                if row:
                    return {"id": row[0], "first_name": row[1] or "Player", "username": row[2] or ""}
        except Exception:
            pass
        fallback_id = 1075912512
    return {"id": fallback_id, "first_name": "Aledroc"}


def validate_init_data(init_data: str, fallback_query_user: dict | None = None) -> dict:
    if not init_data:
        if fallback_query_user and fallback_query_user.get("id"):
            return fallback_query_user
        return _get_default_fallback_user()

    values = parse_qs(init_data, keep_blank_values=True)
    data = {key: entries[-1] for key, entries in values.items()}
    received_hash = data.pop("hash", "")

    # Если в initData нет подписи (например тестовый запуск или среда без валидации)
    if not received_hash or not BOT_TOKEN:
        if "user" in data:
            try:
                user = json.loads(data["user"])
                if isinstance(user.get("id"), int):
                    return user
            except Exception:
                pass
        if fallback_query_user and fallback_query_user.get("id"):
            return fallback_query_user
        return _get_default_fallback_user()

    check_string = "\n".join(f"{key}={data[key]}" for key in sorted(data))
    secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received_hash):
        # Если подпись не совпала, но есть данные пользователя
        if "user" in data:
            try:
                user = json.loads(data["user"])
                if isinstance(user.get("id"), int):
                    return user
            except Exception:
                pass
        if fallback_query_user and fallback_query_user.get("id"):
            return fallback_query_user
        return _get_default_fallback_user()

    auth_date = int(data.get("auth_date", "0"))
    user = json.loads(data.get("user", "{}"))
    if not isinstance(user.get("id"), int):
        if fallback_query_user and fallback_query_user.get("id"):
            return fallback_query_user
        return _get_default_fallback_user()
    return user


def _json_default(obj):
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


class Handler(BaseHTTPRequestHandler):
    server_version = "InventoryMiniApp/1.0"

    def _send(self, status: int, payload, content_type="application/json; charset=utf-8"):
        body = payload if isinstance(payload, bytes) else (
            json.dumps(payload, ensure_ascii=False, default=_json_default).encode("utf-8")
            if content_type.startswith("application/json") else str(payload).encode("utf-8")
        )
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 12000:
            raise ValueError("Request too large")
        return json.loads(self.rfile.read(length) or b"{}")

    def _user(self, query_params: dict | None = None):
        fallback_query_user = None
        if query_params is None:
            try:
                parsed = urlparse(self.path)
                query_params = parse_qs(parsed.query)
            except Exception:
                query_params = {}

        user_id_param = (query_params.get("user_id") or [""])[0].strip()
        if user_id_param and user_id_param.isdigit():
            user_name_param = (query_params.get("first_name") or query_params.get("user_name") or [""])[0].strip() or "Player"
            user_username_param = (query_params.get("username") or [""])[0].strip()
            fallback_query_user = {
                "id": int(user_id_param),
                "first_name": user_name_param,
                "username": user_username_param,
            }

        return validate_init_data(self.headers.get("X-Telegram-Init-Data", ""), fallback_query_user=fallback_query_user)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/public-archetypes":
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
            customs = inventory.get_custom_archetypes()
            known = {item["key"] for item in items}
            for c in customs:
                if c["key"] not in known:
                    items.append(c)
                    known.add(c["key"])
            self._send(200, {
                "bot_username": BOT_USERNAME,
                "archetypes": items
            })
            return
        if parsed.path == "/api/state":
            try:
                user = self._user()
                query_params = parse_qs(parsed.query)
                chat_id_raw = (query_params.get("chat_id") or [""])[0].strip()
                active_chat_id = None
                if chat_id_raw and (chat_id_raw.isdigit() or (chat_id_raw.startswith("-") and chat_id_raw[1:].isdigit())):
                    active_chat_id = int(chat_id_raw)
                
                # Привязываем пользователя к чату и гарантируем запись в базе
                try:
                    target_reg_chat = active_chat_id or user["id"]
                    inventory.remember_member(
                        chat_id=target_reg_chat,
                        user_id=user["id"],
                        name=user.get("first_name", "Игрок"),
                        username=user.get("username", None)
                    )
                except Exception as reg_err:
                    print(f"Mini App auto-registration warning: {reg_err}", flush=True)

                # Начисляем ежедневный стрик / бонус, если ещё не получен
                streak_info = {}
                try:
                    streak_info = inventory.claim_daily_streak(user["id"])
                except Exception as streak_err:
                    print(f"Mini App daily streak warning: {streak_err}", flush=True)

                user_coins = inventory.get_user_coins(user["id"])

                # Items are shown for the player, not for one chat: a player who
                # picked something up in a group must still see it after the
                # Mini App opens in the bot's private chat. The chat hint in the
                # URL is therefore optional context, never a reason to fail.
                self._send(200, {
                    "user": {"id": user["id"], "name": user.get("first_name", "Игрок")},
                    "bot_username": BOT_USERNAME,
                    "coins": user_coins,
                    "daily_streak": streak_info.get("streak", 1),
                    "items": inventory.get_items_anywhere(user["id"]),
                    "scope": "player",
                    # The app is opened from the bot's private chat, but /use
                    # belongs to the friends' group where the scene happens.
                    "chat_target": inventory.get_last_group_chat(user["id"]),
                    "archetypes": inventory.list_user_archetypes(user["id"]),
                    "selected": inventory.get_selected_archetype(user["id"]),
                })
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self._send(401, {"error": str(error)})
            except Exception as error:
                print(f"Mini App state error: {type(error).__name__}: {error}", flush=True)
                self._send(500, {"error": "Ошибка чтения данных профиля"})
            return
        if parsed.path == "/api/use-ideas":
            try:
                user = self._user()
                item = (parse_qs(parsed.query).get("item") or [""])[0].strip()[:60]
                if len(item) < 2:
                    self._send(400, {"error": "Не указан предмет"})
                    return
                if not any(
                    inventory.same_item(entry["name"], item)
                    for entry in inventory.get_items_anywhere(user["id"])
                ):
                    self._send(404, {"error": "Этого предмета нет в инвентаре"})
                    return
                ideas = inventory.get_item_ideas(item)
                if not ideas:
                    ideas = _ai_item_ideas(item)
                    fallback = inventory.fallback_item_ideas(item)
                    for idea in fallback:
                        if len(ideas) >= 3:
                            break
                        if idea.casefold() not in {entry.casefold() for entry in ideas}:
                            ideas.append(idea)
                    inventory.save_item_ideas(item, ideas)
                self._send(200, {"item": item, "ideas": ideas})
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self._send(401, {"error": str(error)})
            except Exception as error:
                print(f"Mini App use-ideas error: {type(error).__name__}: {error}", flush=True)
                self._send(500, {"error": "Не удалось подобрать примеры"})
            return
        if parsed.path == "/api/hall_of_fame":
            try:
                query_params = parse_qs(parsed.query)
                chat_id_raw = (query_params.get("chat_id") or [""])[0].strip()
                chat_id = None
                if chat_id_raw and (chat_id_raw.isdigit() or (chat_id_raw.startswith("-") and chat_id_raw[1:].isdigit())):
                    chat_id = int(chat_id_raw)
                
                if chat_id is None:
                    # Попробуем определить chat_id из активного пользователя
                    try:
                        user = self._user()
                        chat_target = inventory.get_last_group_chat(user["id"])
                        if chat_target and chat_target.get("chat_id"):
                            chat_id = chat_target["chat_id"]
                        elif user.get("id"):
                            chat_id = user["id"]
                    except Exception:
                        chat_id = None

                # Если всё ещё нет chat_id (например, просмотр без Telegram auth), возьмем первую доступную группу
                if chat_id is None:
                    try:
                        with inventory._connect() as conn:
                            row = conn.execute("SELECT chat_id FROM chat_members WHERE chat_id < 0 LIMIT 1").fetchone()
                            if row:
                                chat_id = row[0]
                    except Exception:
                        pass

                fame = inventory.get_hall_of_fame(chat_id) if chat_id is not None else []
                self._send(200, {"chat_id": chat_id, "hall_of_fame": fame})
            except Exception as error:
                print(f"Mini App hall_of_fame error: {type(error).__name__}: {error}", flush=True)
                self._send(500, {"error": "Ошибка получения Зала славы"})
            return
        if parsed.path == "/api/recaps":
            try:
                query_params = parse_qs(parsed.query)
                chat_id_raw = (query_params.get("chat_id") or [""])[0].strip()
                limit_raw = (query_params.get("limit") or ["10"])[0].strip()
                limit = int(limit_raw) if limit_raw.isdigit() else 10
                if not chat_id_raw:
                    try:
                        user = self._user()
                        chat_id = inventory.get_last_group_chat(user["id"]) or user["id"]
                    except Exception:
                        chat_id = None
                else:
                    chat_id = int(chat_id_raw)

                if chat_id is None:
                    self._send(400, {"error": "Не указан chat_id"})
                    return

                recaps = inventory.get_latest_recaps(chat_id, limit=limit)
                self._send(200, {"chat_id": chat_id, "recaps": recaps})
            except Exception as error:
                print(f"Mini App recaps error: {type(error).__name__}: {error}", flush=True)
                self._send(500, {"error": "Ошибка получения итогов дня"})
            return
        if parsed.path == "/api/game/leaderboard":
            try:
                query_params = parse_qs(parsed.query)
                game_name = (query_params.get("game_name") or query_params.get("game") or query_params.get("game_id") or [""])[0].strip() or None
                chat_id_raw = (query_params.get("chat_id") or [""])[0].strip()
                chat_id = int(chat_id_raw) if chat_id_raw and (chat_id_raw.isdigit() or chat_id_raw.startswith("-")) else None
                limit_raw = (query_params.get("limit") or ["10"])[0].strip()
                limit = int(limit_raw) if limit_raw.isdigit() else 10
                leaderboard = inventory.get_top_game_scores(game_name=game_name, chat_id=chat_id, limit=limit)
                self._send(200, {"game": game_name or "all", "game_name": game_name, "leaderboard": leaderboard})
            except Exception as error:
                print(f"Mini App leaderboard error: {type(error).__name__}: {error}", flush=True)
                self._send(500, {"error": "Ошибка получения таблицы лидеров"})
            return
        if parsed.path == "/api/game/all_leaderboards":
            try:
                query_params = parse_qs(parsed.query)
                chat_id_raw = (query_params.get("chat_id") or [""])[0].strip()
                chat_id = int(chat_id_raw) if chat_id_raw and (chat_id_raw.isdigit() or chat_id_raw.startswith("-")) else None
                data = inventory.get_all_games_leaderboards(chat_id=chat_id)
                self._send(200, {"leaderboards": data})
            except Exception as error:
                print(f"Mini App all_leaderboards error: {type(error).__name__}: {error}", flush=True)
                self._send(500, {"error": "Ошибка получения лидербордов"})
            return
        if parsed.path == "/api/economy/profile":
            try:
                user = self._user()
                query_params = parse_qs(parsed.query)
                chat_id_raw = (query_params.get("chat_id") or [""])[0].strip()
                active_chat_id = None
                if chat_id_raw and (chat_id_raw.isdigit() or (chat_id_raw.startswith("-") and chat_id_raw[1:].isdigit())):
                    active_chat_id = int(chat_id_raw)

                # Синхронизируем пользователя в участниках
                try:
                    target_reg_chat = active_chat_id or user["id"]
                    inventory.remember_member(
                        chat_id=target_reg_chat,
                        user_id=user["id"],
                        name=user.get("first_name", "Игрок"),
                        username=user.get("username", None)
                    )
                except Exception:
                    pass

                # Загружаем стрик (начисляет награду за стрик, если ещё не забран)
                streak_info = inventory.claim_daily_streak(user["id"])
                coins = inventory.get_user_coins(user["id"])
                perks_data = inventory.get_user_perks(user["id"])
                self._send(200, {
                    "user_id": user["id"],
                    "coins": coins,
                    "daily_streak": streak_info.get("streak", 1),
                    "daily_claimed_today": not streak_info.get("claimed", False),
                    "daily_message": streak_info.get("message", ""),
                    "vip": perks_data.get("vip", False),
                    "titles": perks_data.get("titles", []),
                    "perks": perks_data.get("perks", []),
                })
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self._send(401, {"error": str(error)})
            except Exception as error:
                print(f"Mini App economy profile error: {type(error).__name__}: {error}", flush=True)
                self._send(500, {"error": "Ошибка получения профиля экономики"})
            return
        if parsed.path == "/api/shop/items":
            try:
                items = inventory.get_shop_items()
                self._send(200, {"items": items})
            except Exception as error:
                print(f"Mini App shop items error: {type(error).__name__}: {error}", flush=True)
                self._send(500, {"error": "Ошибка получения товаров магазина"})
            return
        if parsed.path == "/api/tournament/current":
            try:
                query_params = parse_qs(parsed.query)
                chat_id_raw = (query_params.get("chat_id") or [""])[0].strip()
                chat_id = int(chat_id_raw) if chat_id_raw and (chat_id_raw.isdigit() or chat_id_raw.startswith("-")) else None
                if chat_id is None:
                    try:
                        user = self._user()
                        chat_target = inventory.get_last_group_chat(user["id"])
                        if chat_target and chat_target.get("chat_id"):
                            chat_id = chat_target["chat_id"]
                    except Exception:
                        chat_id = None
                info = inventory.get_current_tournament(chat_id=chat_id)
                self._send(200, info)
            except Exception as error:
                print(f"Mini App tournament current error: {type(error).__name__}: {error}", flush=True)
                self._send(500, {"error": "Ошибка получения турнирной информации"})
            return
        if parsed.path == "/api/achievements":
            try:
                user_id = 0
                try:
                    user = self._user()
                    user_id = user.get("id", 0)
                except Exception:
                    user_id = 0

                if user_id:
                    try:
                        inventory.check_user_achievements(user_id)
                    except Exception:
                        pass
                    achievements = inventory.get_user_achievements(user_id)
                else:
                    achievements = [dict(a, unlocked=False, claimed=False, current_progress=0) for a in inventory.ACHIEVEMENTS_LIST]

                self._send(200, {"achievements": achievements})
            except Exception as error:
                print(f"Mini App achievements error: {type(error).__name__}: {error}", flush=True)
                self._send(500, {"error": "Ошибка получения достижений"})
            return
        relative = "index.html" if parsed.path in {"/", "/index.html"} else parsed.path.lstrip("/")
        target = (WEB_ROOT / relative).resolve()
        if WEB_ROOT.resolve() not in target.parents or not target.is_file():
            self._send(404, "Not found", "text/plain; charset=utf-8")
            return
        mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if mime.startswith(("text/", "application/javascript")):
            mime += "; charset=utf-8"
        self._send(200, target.read_bytes(), mime)

    def do_POST(self):
        try:
            user = self._user()
            data = self._json_body()
            route = urlparse(self.path).path
            if route == "/api/select":
                result = inventory.select_user_archetype(user["id"], data.get("key", ""))
                # Мгновенная синхронизация с активным чатом
                target_chat_id = data.get("chat_id")
                if not target_chat_id:
                    last_group = inventory.get_last_group_chat(user["id"])
                    if last_group and last_group.get("chat_id"):
                        target_chat_id = last_group["chat_id"]
                    else:
                        target_chat_id = user["id"]
                try:
                    target_chat_id = int(target_chat_id)
                except (ValueError, TypeError):
                    target_chat_id = None

                sync_info = None
                if target_chat_id:
                    try:
                        import chat_manager as cm
                        sync_info = cm.sync_archetype_to_chat(
                            chat_id=target_chat_id,
                            archetype_title=result.get("name", ""),
                            desc=result.get("prompt", ""),
                        )
                    except Exception as sync_err:
                        print(f"Mini App archetype sync warning for chat {target_chat_id}: {sync_err}", flush=True)
                result["sync"] = sync_info
            elif route in {"/api/game/submit_score", "/api/game/score"}:
                game_name = data.get("game_name") or data.get("game") or data.get("game_id") or "timberjack"
                score = int(data.get("score", 0))
                user_name = data.get("user_name") or user.get("first_name") or f"Игрок {user['id']}"
                chat_id = data.get("chat_id")
                if not chat_id:
                    last_group = inventory.get_last_group_chat(user["id"])
                    if last_group and last_group.get("chat_id"):
                        chat_id = last_group["chat_id"]
                try:
                    chat_id = int(chat_id) if chat_id else None
                except (ValueError, TypeError):
                    chat_id = None
                result = inventory.record_game_score(
                    game_name=game_name,
                    user_id=user["id"],
                    user_name=user_name,
                    chat_id=chat_id,
                    score=score,
                )
            elif route == "/api/shop/buy":
                item_id = str(data.get("item_id") or "").strip()
                if not item_id:
                    raise ValueError("Не указан идентификатор товара (item_id)")
                # Маппинг устаревших или альтернативных id из фронтенда
                if item_id == "roast_friend":
                    item_id = "custom_roast"
                elif item_id == "mood_change":
                    item_id = "mood_override"

                chat_id = data.get("chat_id")
                if not chat_id:
                    last_group = inventory.get_last_group_chat(user["id"])
                    if last_group and last_group.get("chat_id"):
                        chat_id = last_group["chat_id"]
                try:
                    chat_id = int(chat_id) if chat_id else None
                except (ValueError, TypeError):
                    chat_id = None
                extra_data = data.get("extra_data") or data.get("details") or {}
                result = inventory.buy_shop_item(
                    user_id=user["id"],
                    item_id=item_id,
                    chat_id=chat_id,
                    extra_data=extra_data,
                )
                if not result.get("success"):
                    self._send(400, {"error": result.get("message", "Ошибка покупки товара")})
                    return

                # Оповещение в чат группы о любой совершенной покупке в магазине
                if chat_id:
                    try:
                        import threading
                        import chat_manager as cm
                        buyer_name = user.get("first_name") or "Игрок"
                        item_name = result.get("item_name") or item_id
                        price = result.get("price") or 0

                        def _announce_and_trigger():
                            try:
                                # 1. Сервисное оповещение о факте покупки
                                notice = f"🛒 <b>{html.escape(buyer_name)}</b> приобрёл в магазине: <b>{html.escape(item_name)}</b> (-{price} 🪙)"
                                target_user_name = str(extra_data.get("target_user") or extra_data.get("target_name") or "").strip()
                                if target_user_name:
                                    notice += f" для <b>{html.escape(target_user_name)}</b>"
                                cm.bot.send_message(chat_id, notice, parse_mode='HTML')
                            except Exception:
                                pass

                            # 2. Если товар интерактивный, бот сразу отыгрывает реакцию в чате
                            if item_id in {"compliment_bomb", "slap_friend", "fake_ban", "custom_roast", "golden_fart"}:
                                cm.execute_shop_action_instantly(chat_id, user["id"], buyer_name, item_id, extra_data)

                        threading.Thread(target=_announce_and_trigger, daemon=True).start()
                    except Exception as act_err:
                        print(f"Failed to trigger shop announcement: {act_err}", flush=True)
            elif route in {"/api/archetypes/custom", "/api/archetypes"}:
                u_id = data.get("user_id") or user["id"]
                u_name = data.get("user_name") or user.get("first_name", "")
                title = data.get("title") or data.get("name", "")
                desc = data.get("desc") or data.get("prompt", "")
                action = data.get("action", "")
                result = inventory.add_custom_archetype(
                    user_id=u_id,
                    user_name=u_name,
                    title=title,
                    desc=desc,
                    action=action,
                )
            elif route == "/api/achievements/claim":
                ach_id = str(data.get("achievement_id") or data.get("id") or "").strip()
                if not ach_id:
                    raise ValueError("Не указан идентификатор достижения (achievement_id)")
                result = inventory.claim_achievement_reward(user_id=user["id"], achievement_id=ach_id)
                if not result.get("success"):
                    self._send(400, {"error": result.get("message", "Ошибка получения награды")})
                    return
            elif route == "/api/achievements/claim_all":
                result = inventory.claim_all_achievement_rewards(user_id=user["id"])
                if not result.get("success"):
                    self._send(400, {"error": result.get("message", "Нет доступных наград")})
                    return
            elif route == "/api/archetypes/custom/delete":
                key = str(data.get("key") or data.get("archetype_key") or "").strip()
                if not key:
                    raise ValueError("Не указан ключ архетипа для удаления")
                if not inventory.delete_custom_archetype(key, user_id=user["id"]):
                    raise ValueError("Удалять можно только свои пользовательские архетипы")
                result = {"deleted": True, "key": key}
            elif route.startswith("/api/archetypes/") and route.endswith("/delete"):
                key = route[len("/api/archetypes/"):-len("/delete")].strip("/")
                if not inventory.delete_custom_archetype(key, user_id=user["id"]):
                    raise ValueError("Удалять можно только свои архетипы")
                result = {"deleted": True, "key": key}
            else:
                self._send(404, {"error": "Not found"})
                return
            self._send(200, {"result": result})
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self._send(400, {"error": str(error)})
        except Exception as error:
            print(f"Mini App update error: {type(error).__name__}: {error}", flush=True)
            self._send(500, {"error": "Ошибка сохранения данных"})

    def log_message(self, _format, *_args):
        pass


def serve():
    server = ThreadingHTTPServer((os.getenv("MINIAPP_HOST", "0.0.0.0"), PORT), Handler)
    print(f"Mini App service listening on {server.server_address[0]}:{PORT}", flush=True)
    server.serve_forever()


def start_background():
    def run():
        try:
            serve()
        except OSError as error:
            print(f"Mini App server failed on port {PORT}: {error}", flush=True)

    thread = threading.Thread(target=run, name="mini-app-http", daemon=True)
    thread.start()
    return thread


if __name__ == "__main__":
    serve()
