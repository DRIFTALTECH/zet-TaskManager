"""
AI service layer — LangChain + DeepSeek V4 Flash (OpenAI-compatible API).

Public helpers:
  complete()              → plain text response
  parse_structured()      → payload (text/dict/list) → validated Pydantic model
  complete_structured()   → plain completion + parse_structured (no response_format)
  complete_structured_strict() → same path
  bind_agent(tools)       → tool-bound chat runnable for the Zani agent
  parse_message_content() → strip reasoning from any LLM message/result
  transcribe()            → speech-to-text via Groq Whisper (unchanged)

Chat, agent, and structured-output calls use DeepSeek only. Override via:
  DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL
  DEEPSEEK_AGENT_MODEL / DEEPSEEK_STRICT_MODEL
"""

import json
import logging
import os
from typing import TypeVar, Type

from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import Runnable
from pydantic import BaseModel

from ai.response_parser import extract_final_answer, message_to_text
from ai.structured import parse_structured as parse_structured

log = logging.getLogger("zet.ai")

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


def _deepseek(model: str, temperature: float, timeout: float | None = None) -> ChatOpenAI | None:
    """DeepSeek chat model, or None if no API key is configured."""
    key = _api_key()
    if not key:
        return None
    return ChatOpenAI(
        model=model,
        temperature=temperature,
        api_key=key,
        base_url=_BASE_URL,
        timeout=timeout if timeout is not None else _LLM_TIMEOUT,
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


def _with_json_instruction(prompt: ChatPromptTemplate, schema: Type[BaseModel]) -> ChatPromptTemplate:
    """Ask for JSON in the prompt. Never send response_format — DeepSeek V4 rejects it."""
    schema_txt = json.dumps(schema.model_json_schema(), indent=2).replace("{", "{{").replace("}", "}}")
    extra = (
        "Return a single JSON object only that matches this schema. "
        "No markdown fences and no commentary.\n" + schema_txt
    )
    return ChatPromptTemplate.from_messages([*prompt.messages, ("human", extra)])


# Asked for on a second attempt, when the first answer came back unusable.
_JSON_ONLY_RETRY = (
    "Your previous answer could not be read as JSON. Reply with the JSON object "
    "alone — no explanation before or after it, no markdown fences. Keep it "
    "short enough to finish: prefer fewer entries over an answer that gets cut off."
)


def complete_structured(
    prompt: ChatPromptTemplate,
    variables: dict,
    schema: Type[T],
    *,
    timeout: float | None = None,
) -> T:
    """Plain completion + parse_structured. Does not send response_format.

    Retries once when the answer parses as nothing usable. The client's own
    retries never cover this: a model that replies with prose, or stops before
    finishing a single entry, has still returned HTTP 200 — nothing failed at
    the transport layer, so nothing is retried. That left the one failure that
    actually happens as the one failure nobody retried.
    """
    llm = _require(_deepseek(_DEFAULT_MODEL, 0.1, timeout=timeout))
    chain = _with_json_instruction(prompt, schema) | llm
    try:
        return parse_structured(parse_message_content(chain.invoke(variables)), schema)
    except ValueError:
        log.warning("structured parse failed for %s; asking again for JSON only", schema.__name__)
    retry_prompt = ChatPromptTemplate.from_messages(
        [*_with_json_instruction(prompt, schema).messages, ("human", _JSON_ONLY_RETRY)]
    )
    return parse_structured(parse_message_content((retry_prompt | llm).invoke(variables)), schema)


def complete_structured_strict(
    prompt: ChatPromptTemplate,
    variables: dict,
    schema: Type[T],
    *,
    model: str | None = None,
    temperature: float = 0,
    timeout: float | None = None,
) -> T:
    """Same as complete_structured (DeepSeek has no json_schema constrained decode)."""
    llm = _require(_deepseek(model or _STRICT_MODEL, temperature, timeout=timeout))
    text = parse_message_content((_with_json_instruction(prompt, schema) | llm).invoke(variables))
    return parse_structured(text, schema)


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
