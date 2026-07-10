import os
from pathlib import Path
from dotenv import load_dotenv

# Load env from current directory
env_path = Path(__file__).resolve().parent / ".env"
if env_path.is_file():
    load_dotenv(env_path)

CLOCKIFY_API_KEY = os.environ.get("CLOCKIFY_API_KEY", "").strip()
CLOCKIFY_WORKSPACE_ID = os.environ.get("CLOCKIFY_WORKSPACE_ID", "").strip()
CLOCKIFY_BASE_URL = os.environ.get("CLOCKIFY_BASE_URL", "https://api.clockify.me/api/v1").strip()

def clockify_configured() -> bool:
    return bool(CLOCKIFY_API_KEY and CLOCKIFY_WORKSPACE_ID)
