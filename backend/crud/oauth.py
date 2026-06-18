import time

from sqlalchemy.orm import Session

from database.models import OAuthClient, OAuthGrant


# ── Clients ────────────────────────────────────────────────────────────────────

def put_client(db: Session, client_id: str, data_json: str, created_at: str) -> None:
    row = db.get(OAuthClient, client_id)
    if row:
        row.data = data_json
    else:
        db.add(OAuthClient(client_id=client_id, data=data_json, created_at=created_at))
    db.commit()


def get_client(db: Session, client_id: str) -> str | None:
    row = db.get(OAuthClient, client_id)
    return row.data if row else None


# ── Grants (pending / code / refresh) ─────────────────────────────────────────

def put_grant(db: Session, *, key: str, kind: str, client_id: str, user_id: str,
              data_json: str, expires_at: float | None) -> None:
    row = db.get(OAuthGrant, key)
    if row:
        row.kind, row.client_id, row.user_id, row.data, row.expires_at = (
            kind, client_id, user_id, data_json, expires_at)
    else:
        db.add(OAuthGrant(key=key, kind=kind, client_id=client_id, user_id=user_id,
                          data=data_json, expires_at=expires_at))
    db.commit()


def get_grant(db: Session, key: str, kind: str) -> OAuthGrant | None:
    row = db.get(OAuthGrant, key)
    if not row or row.kind != kind:
        return None
    if row.expires_at is not None and row.expires_at < time.time():
        db.delete(row)
        db.commit()
        return None
    return row


def delete_grant(db: Session, key: str) -> None:
    row = db.get(OAuthGrant, key)
    if row:
        db.delete(row)
        db.commit()
