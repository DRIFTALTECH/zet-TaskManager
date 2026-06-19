from pathlib import Path

from dotenv import load_dotenv

# Load backend/.env before routes import auth_logic (which reads MICROSOFT_CLIENT_ID at import time).
load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from database.init_db import init_db
from logic.project_logic import PROJECT_MEDIA_DIR
from mcp_app import build_mcp_asgi
from routes import register_routes

init_db()

# Embedded MCP server — same process and port, mounted at /mcp.
mcp_asgi, mcp_lifespan = build_mcp_asgi()

app = FastAPI(title="ZET Backend API", version="1.0.1", lifespan=mcp_lifespan)

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
# Project background / photo files (served publicly; referenced by /projects payloads).
app.mount("/project-media", StaticFiles(directory=str(PROJECT_MEDIA_DIR)), name="project-media")
# MCP endpoint lives at /mcp on the same server (clients connect to http://<host>:8000/mcp/).
app.mount("/mcp", mcp_asgi)
