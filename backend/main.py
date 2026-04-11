from pathlib import Path

from dotenv import load_dotenv

# Load backend/.env before routes import auth_logic (which reads MICROSOFT_CLIENT_ID at import time).
load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database.init_db import init_db
from routes import register_routes

init_db()

app = FastAPI(title="ZET API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(register_routes())
