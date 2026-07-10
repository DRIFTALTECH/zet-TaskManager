from crud._base import Db, fetch_all, fetch_one, row_to_model, rows_to_models

from database.models import PersonalAccessToken


def create(db: Db, token: PersonalAccessToken) -> PersonalAccessToken:
    db.write(
        """INSERT INTO personal_access_tokens (
               id, user_id, name, token_hash, prefix, created_at, last_used_at, revoked
           ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            token.id,
            token.user_id,
            token.name,
            token.token_hash,
            token.prefix,
            token.created_at,
            token.last_used_at,
            token.revoked,
        ),
    )
    row = fetch_one(db, "SELECT * FROM personal_access_tokens WHERE id = %s", (token.id,))
    result = row_to_model(PersonalAccessToken, row)
    assert result is not None
    return result


def get_by_hash(db: Db, token_hash: str) -> PersonalAccessToken | None:
    row = fetch_one(
        db,
        "SELECT * FROM personal_access_tokens WHERE token_hash = %s AND revoked = FALSE LIMIT 1",
        (token_hash,),
    )
    return row_to_model(PersonalAccessToken, row)


def get_for_user(db: Db, token_id: str, user_id: str) -> PersonalAccessToken | None:
    row = fetch_one(
        db,
        "SELECT * FROM personal_access_tokens WHERE id = %s AND user_id = %s LIMIT 1",
        (token_id, user_id),
    )
    return row_to_model(PersonalAccessToken, row)


def list_for_user(db: Db, user_id: str) -> list[PersonalAccessToken]:
    rows = fetch_all(
        db,
        """SELECT * FROM personal_access_tokens
           WHERE user_id = %s AND revoked = FALSE
           ORDER BY created_at DESC""",
        (user_id,),
    )
    return rows_to_models(PersonalAccessToken, rows)


def update(db: Db, token: PersonalAccessToken) -> PersonalAccessToken:
    db.write(
        """UPDATE personal_access_tokens SET
               user_id = %s, name = %s, token_hash = %s, prefix = %s,
               created_at = %s, last_used_at = %s, revoked = %s
           WHERE id = %s""",
        (
            token.user_id,
            token.name,
            token.token_hash,
            token.prefix,
            token.created_at,
            token.last_used_at,
            token.revoked,
            token.id,
        ),
    )
    row = fetch_one(db, "SELECT * FROM personal_access_tokens WHERE id = %s", (token.id,))
    result = row_to_model(PersonalAccessToken, row)
    assert result is not None
    return result


def touch_last_used(db: Db, token: PersonalAccessToken, when: str) -> None:
    db.write(
        "UPDATE personal_access_tokens SET last_used_at = %s WHERE id = %s",
        (when, token.id),
    )
