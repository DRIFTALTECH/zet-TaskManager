import sys
from pathlib import Path

# Add backend directory to sys.path to reuse db_wrapper and crud modules
repo_root = Path(__file__).resolve().parents[1]
backend_dir = repo_root / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

# Force loading backend's .env first if it exists, to get db environment overrides (like ZET_TEST_SQLITE)
backend_env = backend_dir / ".env"
if backend_env.is_file():
    from dotenv import load_dotenv
    load_dotenv(backend_env)

# Import DatabaseWrapper and get_database from the existing db_wrapper package
from db_wrapper import get_database, DatabaseWrapper

Db = DatabaseWrapper

def get_db() -> DatabaseWrapper:
    db = get_database()
    return db
