"""
AI service layer — LangChain + DeepSeek V4 Flash (OpenAI-compatible API).

Public helpers:
  complete()              → plain text response
  complete_structured()   → Pydantic model via with_structured_output()
  complete_structured_strict() → structured output (same path; DeepSeek has no Groq json_schema)
  bind_agent(tools)       → tool-bound chat runnable for the Zani agent
  parse_message_content() → strip reasoning from any LLM message/result
  transcribe()            → speech-to-text via Groq Whisper (unchanged)

Chat, agent, and structured-output calls use DeepSeek only. Override via:
  DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL
  DEEPSEEK_AGENT_MODEL / DEEPSEEK_STRICT_MODEL
"""

import os
from typing import TypeVar, Type

from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import Runnable
from pydantic import BaseModel

from ai.response_parser import extract_final_answer, message_to_text, sanitize_model_strings

# ── Models ────────────────────────────────────────────────────────────────────
# Official API id: deepseek-v4-flash (serves the latest V4 Flash snapshot).
_FLASH = "deepseek-v4-flash"
_DEFAULT_MODEL = os.getenv("DEEPSEEK_MODEL", _FLASH)
_AGENT_MODEL = os.getenv("DEEPSEEK_AGENT_MODEL", _DEFAULT_MODEL)
_STRICT_MODEL = os.getenv("DEEPSEEK_STRICT_MODEL", _DEFAULT_MODEL)
_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
# Flash spends tokens on hidden reasoning first; keep a floor so the visible answer is not empty.
_MAX_TOKENS = int(os.getenv("DEEPSEEK_MAX_TOKENS", "8192"))

# Don't let a hung provider wedge a request thread.
_LLM_TIMEOUT = float(os.getenv("AI_REQUEST_TIMEOUT", "45"))
_LLM_MAX_RETRIES = int(os.getenv("AI_MAX_RETRIES", "2"))

T = TypeVar("T", bound=BaseModel)


def _api_key() -> str:
    return (os.getenv("DEEPSEEK_API_KEY") or "").strip()


def _deepseek(model: str, temperature: float) -> ChatOpenAI | None:
    """DeepSeek chat model, or None if no API key is configured."""
    key = _api_key()
    if not key:
        return None
    return ChatOpenAI(
        model=model,
        temperature=temperature,
        api_key=key,
        base_url=_BASE_URL,
        timeout=_LLM_TIMEOUT,
        max_retries=_LLM_MAX_RETRIES,
        max_tokens=_MAX_TOKENS,
    )


def fallback_available() -> bool:
    """No secondary LLM. Kept so /ai/health stays stable."""
    return False


def _no_provider() -> RuntimeError:
    return RuntimeError(
        "No AI provider available. Set DEEPSEEK_API_KEY in backend/.env "
        f"(model '{_DEFAULT_MODEL}' at {_BASE_URL})."
    )


def _require(llm: ChatOpenAI | None) -> ChatOpenAI:
    if llm is None:
        raise _no_provider()
    return llm


def parse_message_content(result) -> str:
    """Normalize any LLM invoke result and return only the user-facing answer."""
    return extract_final_answer(message_to_text(result))


# ── Client (agent) ──────────────────────────────────────────────────────────────

def bind_agent(tools: list) -> Runnable:
    """Tool-bound chat runnable for the Zani agent (DeepSeek V4 Flash)."""
    return _require(_deepseek(_AGENT_MODEL, 0)).bind_tools(tools)


def get_llm_for_agent() -> ChatOpenAI:
    return _require(_deepseek(_AGENT_MODEL, 0))


# ── Public helpers ────────────────────────────────────────────────────────────

def complete(prompt: ChatPromptTemplate, variables: dict) -> str:
    """Invoke a prompt template and return plain text (description, summarization)."""
    llm = _require(_deepseek(_DEFAULT_MODEL, 0.4))
    return parse_message_content((prompt | llm).invoke(variables))


def complete_structured(
    prompt: ChatPromptTemplate,
    variables: dict,
    schema: Type[T],
) -> T:
    """Invoke a prompt template and return a validated Pydantic model (tool-calling)."""
    llm = _require(_deepseek(_DEFAULT_MODEL, 0.1))
    runnable = prompt | llm.with_structured_output(schema)
    return sanitize_model_strings(runnable.invoke(variables))


def complete_structured_strict(
    prompt: ChatPromptTemplate,
    variables: dict,
    schema: Type[T],
    *,
    model: str | None = None,
    temperature: float = 0,
) -> T:
    """
    Structured output via DeepSeek tool-calling.
    The schema should be "strict-clean": every field required, extra="forbid".
    """
    llm = _require(_deepseek(model or _STRICT_MODEL, temperature))
    runnable = prompt | llm.with_structured_output(schema)
    return sanitize_model_strings(runnable.invoke(variables))


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
