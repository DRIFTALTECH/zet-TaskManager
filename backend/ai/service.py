"""
AI service layer — LangChain, Groq primary + Ollama fallback.

Public helpers:
  complete()              → plain text response
  complete_structured()   → Pydantic model via with_structured_output()
  complete_structured_strict() → constrained decoding (Groq json_schema)
  bind_agent(tools)       → tool-bound chat runnable for the Zani agent
  transcribe()            → speech-to-text via Groq Whisper (stubbed)

Every call uses Groq first and automatically falls back to a local Ollama model
if Groq fails (deprecated model, quota, bad key, outage). Fallback activates only
when Ollama is reachable and `langchain-ollama` is installed.
"""

import os
from typing import TypeVar, Type

from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import Runnable
from pydantic import BaseModel

# ── Models ────────────────────────────────────────────────────────────────────
# Groq retires models on a schedule (the Llama-4 line was decommissioned in 2026 in
# favour of openai/gpt-oss). Defaults are current as of 2026 and overridable via env.
#   GROQ_MODEL / GROQ_AGENT_MODEL / GROQ_STRICT_MODEL  — Groq model ids
#   OLLAMA_MODEL / OLLAMA_BASE_URL                     — local fallback
#   AI_OLLAMA_FALLBACK=0                               — disable fallback
_DEFAULT_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
_AGENT_MODEL = os.getenv("GROQ_AGENT_MODEL", "llama-3.3-70b-versatile")
_STRICT_MODEL = os.getenv("GROQ_STRICT_MODEL", "llama-3.3-70b-versatile")

# Ollama fallback — local (http://localhost:11434) OR Ollama Cloud (https://ollama.com
# with an API key). When OLLAMA_API_KEY is set we default to the cloud endpoint + a
# cloud-hosted model and send the Bearer header on every request.
OLLAMA_API_KEY = os.getenv("OLLAMA_API_KEY", "").strip()
OLLAMA_BASE_URL = os.getenv(
    "OLLAMA_BASE_URL", "https://ollama.com" if OLLAMA_API_KEY else "http://localhost:11434"
)
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gpt-oss:120b" if OLLAMA_API_KEY else "llama3.3:70b")


def _supports_strict_json_schema(model: str) -> bool:
    """Only some Groq models support constrained decoding (method='json_schema').
    Llama-3.3 does not — for those we use ordinary structured output instead."""
    m = (model or "").lower()
    return "gpt-oss" in m or "llama-4" in m or "kimi" in m
_FALLBACK_ENABLED = os.getenv("AI_OLLAMA_FALLBACK", "1").lower() not in ("0", "false", "no", "")

# Don't let a hung provider wedge a request thread.
_LLM_TIMEOUT = float(os.getenv("AI_REQUEST_TIMEOUT", "45"))
_LLM_MAX_RETRIES = int(os.getenv("AI_MAX_RETRIES", "2"))

T = TypeVar("T", bound=BaseModel)


# ── Providers ──────────────────────────────────────────────────────────────────

def _groq(model: str, temperature: float):
    """Groq chat model, or None if no API key is configured."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return None
    return ChatGroq(
        model=model, temperature=temperature, api_key=api_key,
        timeout=_LLM_TIMEOUT, max_retries=_LLM_MAX_RETRIES,
    )


def _ollama(temperature: float):
    """Ollama chat model fallback (local or Ollama Cloud), or None if disabled/unavailable."""
    if not _FALLBACK_ENABLED:
        return None
    try:
        from langchain_ollama import ChatOllama
    except Exception:
        return None
    kwargs: dict = {"model": OLLAMA_MODEL, "base_url": OLLAMA_BASE_URL, "temperature": temperature, "timeout": _LLM_TIMEOUT}
    if OLLAMA_API_KEY:
        # Ollama Cloud auth — Bearer header on the underlying client.
        kwargs["client_kwargs"] = {"headers": {"Authorization": f"Bearer {OLLAMA_API_KEY}"}}
    return ChatOllama(**kwargs)


def fallback_available() -> bool:
    return _ollama(0) is not None


def _no_provider() -> RuntimeError:
    return RuntimeError(
        "No AI provider available. Set GROQ_API_KEY, or run Ollama "
        f"(model '{OLLAMA_MODEL}' at {OLLAMA_BASE_URL})."
    )


def _with_fallback(primary: Runnable | None, fallbacks: list[Runnable]) -> Runnable:
    """Chain a primary runnable with one or more fallbacks (Groq → Ollama)."""
    chain = [r for r in [primary, *fallbacks] if r is not None]
    if not chain:
        raise _no_provider()
    return chain[0] if len(chain) == 1 else chain[0].with_fallbacks(chain[1:])


# ── Client (agent) ──────────────────────────────────────────────────────────────

def bind_agent(tools: list) -> Runnable:
    """Tool-bound chat runnable for the Zani agent: Groq primary, Ollama fallback."""
    g = _groq(_AGENT_MODEL, 0)
    o = _ollama(0)
    primary = g.bind_tools(tools) if g is not None else None
    fb = [o.bind_tools(tools)] if o is not None else []
    return _with_fallback(primary, fb)


# Back-compat: a plain Groq agent LLM (no fallback). Prefer bind_agent().
def get_llm_for_agent() -> ChatGroq:
    g = _groq(_AGENT_MODEL, 0)
    if g is None:
        raise RuntimeError("GROQ_API_KEY is not set. Add it to backend/.env")
    return g


# ── Public helpers ────────────────────────────────────────────────────────────

def complete(prompt: ChatPromptTemplate, variables: dict) -> str:
    """Invoke a prompt template and return plain text (description, summarization)."""
    g = _groq(_DEFAULT_MODEL, 0.4)
    o = _ollama(0.4)
    runnable = _with_fallback(
        (prompt | g) if g is not None else None,
        [prompt | o] if o is not None else [],
    )
    result = runnable.invoke(variables)
    return result.content.strip()


def complete_structured(
    prompt: ChatPromptTemplate,
    variables: dict,
    schema: Type[T],
) -> T:
    """Invoke a prompt template and return a validated Pydantic model (tool-calling)."""
    g = _groq(_DEFAULT_MODEL, 0.1)
    o = _ollama(0.1)
    runnable = _with_fallback(
        (prompt | g.with_structured_output(schema)) if g is not None else None,
        [prompt | o.with_structured_output(schema)] if o is not None else [],
    )
    return runnable.invoke(variables)


def complete_structured_strict(
    prompt: ChatPromptTemplate,
    variables: dict,
    schema: Type[T],
    *,
    model: str | None = None,
    temperature: float = 0,
) -> T:
    """
    Groq constrained decoding (method="json_schema", strict=True) with an Ollama
    fallback that uses ordinary structured output (the strict kwarg is Groq-specific).
    The schema must be "strict-clean": every field required, no bounds, extra="forbid".
    """
    chosen = model or _STRICT_MODEL
    g = _groq(chosen, temperature)
    o = _ollama(temperature)
    if g is not None and _supports_strict_json_schema(chosen):
        primary = prompt | g.with_structured_output(schema, method="json_schema", strict=True)
    elif g is not None:
        # Llama (and others) don't support json_schema strict → ordinary structured output.
        primary = prompt | g.with_structured_output(schema)
    else:
        primary = None
    runnable = _with_fallback(
        primary,
        [prompt | o.with_structured_output(schema)] if o is not None else [],
    )
    return runnable.invoke(variables)


def transcribe(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """Speech-to-text via Groq Whisper (whisper-large-v3-turbo — fast + free tier).
    Model overridable via GROQ_WHISPER_MODEL."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set. Add it to backend/.env")
    from groq import Groq

    client = Groq(api_key=api_key)
    result = client.audio.transcriptions.create(
        model=os.getenv("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo"),
        file=(filename or "audio.webm", audio_bytes),
    )
    return (result.text or "").strip()
