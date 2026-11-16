"""Database adapter for DanilaTuev_Bot supporting SQLite and MySQL transparently."""

import os
import re
import urllib.parse
from contextlib import contextmanager
from pathlib import Path

# По умолчанию используется MySQL база данных пользователя
DEFAULT_DATABASE_URL = "mysql://u6670_7nMa3Tbvlf:Vj.+xYq^Tnz^Lp48tJnEii2u@157.90.211.250:3306/s6670_storage"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL).strip()

_DATA_DIR = Path(os.getenv("BOT_DATA_DIR") or Path(__file__).resolve().parent)
_SQLITE_PATH = _DATA_DIR / "bot_data.sqlite3"


class MySQLCursorWrapper:
    """Обертка над курсором PyMySQL, приводящая его интерфейс к sqlite3.Cursor."""
    def __init__(self, raw_cursor):
        self._raw = raw_cursor

    def fetchone(self):
        row = self._raw.fetchone()
        if row is None:
            return None
        return row

    def fetchall(self):
        return self._raw.fetchall()

    def fetchmany(self, size=None):
        return self._raw.fetchmany(size)

    @property
    def rowcount(self):
        return self._raw.rowcount

    @property
    def lastrowid(self):
        return self._raw.lastrowid

    def __iter__(self):
        return iter(self._raw)


class MySQLConnectionWrapper:
    """Обертка над соединением PyMySQL для совместимости с кодом sqlite3."""
    def __init__(self, raw_conn):
        self._raw = raw_conn

    def _convert_sql(self, sql: str) -> str:
        """Транслирует SQL-запросы SQLite в эквивалентные запросы MySQL."""
        # 1. Замена параметров '?' на '%s'
        converted = re.sub(r'\?', '%s', sql)

        # 2. Удаление SQLite-специфичного 'COLLATE NOCASE' (в MySQL utf8mb4 по умолчанию уже case-insensitive)
        converted = re.sub(r'\bCOLLATE\s+NOCASE\b', '', converted, flags=re.IGNORECASE)

        # 3. Трансляция ON CONFLICT(...) DO UPDATE SET ...
        if "ON CONFLICT" in converted.upper():
            def _replace_on_conflict(match):
                action = match.group(1).strip()
                if action.upper().startswith("DO NOTHING"):
                    return "ON DUPLICATE KEY UPDATE updated_at=updated_at" if "updated_at" in converted.lower() else "ON DUPLICATE KEY UPDATE user_id=user_id"
                elif action.upper().startswith("DO UPDATE SET"):
                    update_part = action[len("DO UPDATE SET"):].strip()
                    update_part = re.sub(r'\bexcluded\.([a-zA-Z0-9_]+)', r'VALUES(\1)', update_part)
                    return f"ON DUPLICATE KEY UPDATE {update_part}"
                return match.group(0)

            converted = re.sub(r'ON\s+CONFLICT\s*\([^)]*\)\s*(DO\s+[^;]+)', _replace_on_conflict, converted, flags=re.IGNORECASE)

        return converted

    def execute(self, sql: str, params=None):
        sql_trans = self._convert_sql(sql)
        cursor = self._raw.cursor()
        if params is None:
            cursor.execute(sql_trans)
        else:
            cursor.execute(sql_trans, params)
        return MySQLCursorWrapper(cursor)

    def executemany(self, sql: str, seq_of_params):
        sql_trans = self._convert_sql(sql)
        cursor = self._raw.cursor()
        cursor.executemany(sql_trans, seq_of_params)
        return MySQLCursorWrapper(cursor)

    def commit(self):
        self._raw.commit()

    def rollback(self):
        self._raw.rollback()

    def close(self):
        self._raw.close()


@contextmanager
def get_db_connection():
    """Возвращает контекстное соединение к MySQL или SQLite."""
    use_mysql = False
    if DATABASE_URL.startswith("mysql://") or DATABASE_URL.startswith("mysql+pymysql://"):
        use_mysql = True

    if use_mysql:
        import pymysql
        parsed = urllib.parse.urlparse(DATABASE_URL)
        conn = pymysql.connect(
            host=parsed.hostname or "127.0.0.1",
            port=parsed.port or 3306,
            user=parsed.username or "root",
            password=parsed.password or "",
            database=parsed.path.lstrip("/"),
            charset="utf8mb4",
            connect_timeout=10,
            autocommit=False,
        )
        wrapped = MySQLConnectionWrapper(conn)
        try:
            yield wrapped
            wrapped.commit()
        except Exception:
            wrapped.rollback()
            raise
        finally:
            wrapped.close()
        return

    # Fallback на локальный SQLite
    import sqlite3
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_SQLITE_PATH, timeout=10)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
