"""The Aurora bootstrap must describe the same schema the models do.

A fresh server is built from `scripts/bootstrap_aurora.sql`, but the app runs as
a role with no DDL rights — so anything the bootstrap forgets can never be added
later at runtime. That failure shows up in production as a missing-column error,
which is why the two are compared here instead.
"""
import pathlib
import re

from database.models import Base

_SQL = pathlib.Path(__file__).resolve().parent.parent / "scripts" / "bootstrap_aurora.sql"
_NOT_A_COLUMN = {"PRIMARY", "CONSTRAINT", "UNIQUE", "FOREIGN", "CHECK"}


def _declared_tables() -> dict[str, set[str]]:
    sql = _SQL.read_text()
    out: dict[str, set[str]] = {}
    for table, body in re.findall(r"CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);", sql):
        cols = set()
        for line in body.splitlines():
            line = line.strip()
            if not line or line.startswith("--"):
                continue
            m = re.match(r"([a-z_]+)\s", line)
            if m and m.group(1).upper() not in _NOT_A_COLUMN:
                cols.add(m.group(1))
        out[table] = cols
    return out


def test_bootstrap_declares_every_model_table_and_column():
    declared = _declared_tables()
    missing: list[str] = []
    for table, tbl in sorted(Base.metadata.tables.items()):
        if table not in declared:
            missing.append(f"{table} (whole table)")
            continue
        for col in tbl.columns:
            if col.name not in declared[table]:
                missing.append(f"{table}.{col.name}")
    assert not missing, (
        "scripts/bootstrap_aurora.sql is behind the models: " + ", ".join(missing)
    )


def test_every_table_is_created_before_the_grants():
    """A table declared after the GRANT block is unreadable by the service.

    `GRANT ... ON ALL TABLES` applies to the tables that exist when it runs, and
    ALTER DEFAULT PRIVILEGES only covers tables created afterwards by the role
    that set it. work_items was originally declared at the end of this file,
    below the grants, so the owner created it and the service could not read it:
    every request died with "permission denied for table work_items".
    """
    sql = _SQL.read_text()
    grant = sql.index("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES")
    late = [
        m.group(1)
        for m in re.finditer(r"CREATE TABLE IF NOT EXISTS (\w+)", sql)
        if m.start() > grant
    ]
    assert not late, (
        "declared after the GRANT block, so app_user cannot read them: " + ", ".join(late)
    )
