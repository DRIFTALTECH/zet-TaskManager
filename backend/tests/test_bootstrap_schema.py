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
