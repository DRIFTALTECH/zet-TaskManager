from crud._base import Db, fetch_one


def get(db: Db, key: str) -> str | None:
    row = fetch_one(db, "SELECT value FROM app_settings WHERE key = %s", (key,))
    return row["value"] if row else None


def set(db: Db, key: str, value: str) -> None:
    row = fetch_one(db, "SELECT key FROM app_settings WHERE key = %s", (key,))
    if row:
        db.write("UPDATE app_settings SET value = %s WHERE key = %s", (value, key))
    else:
        db.write("INSERT INTO app_settings (key, value) VALUES (%s, %s)", (key, value))
