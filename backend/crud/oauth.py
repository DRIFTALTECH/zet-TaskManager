import time

from crud._base import Db, fetch_one, row_to_model

from database.models import OAuthGrant


# ── Clients ────────────────────────────────────────────────────────────────────

def put_client(db: Db, client_id: str, data_json: str, created_at: str) -> None:
    row = fetch_one(db, "SELECT client_id FROM oauth_clients WHERE client_id = %s", (client_id,))
    if row:
        db.write("UPDATE oauth_clients SET data = %s WHERE client_id = %s", (data_json, client_id))
    else:
        db.write(
            "INSERT INTO oauth_clients (client_id, data, created_at) VALUES (%s, %s, %s)",
            (client_id, data_json, created_at),
        )


def get_client(db: Db, client_id: str) -> str | None:
    row = fetch_one(db, "SELECT data FROM oauth_clients WHERE client_id = %s", (client_id,))
    return row["data"] if row else None


# ── Grants (pending / code / refresh) ─────────────────────────────────────────

def put_grant(db: Db, *, key: str, kind: str, client_id: str, user_id: str,
              data_json: str, expires_at: float | None) -> None:
    row = fetch_one(db, "SELECT key FROM oauth_grants WHERE key = %s", (key,))
    if row:
        db.write(
            """UPDATE oauth_grants SET
                   kind = %s, client_id = %s, user_id = %s, data = %s, expires_at = %s
               WHERE key = %s""",
            (kind, client_id, user_id, data_json, expires_at, key),
        )
    else:
        db.write(
            """INSERT INTO oauth_grants (key, kind, client_id, user_id, data, expires_at)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (key, kind, client_id, user_id, data_json, expires_at),
        )


def get_grant(db: Db, key: str, kind: str) -> OAuthGrant | None:
    row = fetch_one(db, "SELECT * FROM oauth_grants WHERE key = %s", (key,))
    if not row:
        return None
    grant = row_to_model(OAuthGrant, row)
    if grant is None or grant.kind != kind:
        return None
    if grant.expires_at is not None and grant.expires_at < time.time():
        db.write("DELETE FROM oauth_grants WHERE key = %s", (key,))
        return None
    return grant


def delete_grant(db: Db, key: str) -> None:
    row = fetch_one(db, "SELECT key FROM oauth_grants WHERE key = %s", (key,))
    if row:
        db.write("DELETE FROM oauth_grants WHERE key = %s", (key,))
