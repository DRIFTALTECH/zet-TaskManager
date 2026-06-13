"""
AI service layer — LangChain + Groq.

Three public helpers:
  complete()          → plain text response
  complete_structured()  → Pydantic model via with_structured_output()
  transcribe()        → speech-to-text via Groq Whisper (stubbed, ready to activate)

To swap provider: replace ChatGroq with ChatGoogleGenerativeAI / ChatCerebras
and update the model string. Everything else stays identical.
"""

import os
from typing import TypeVar, Type

from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel

# ── Client ────────────────────────────────────────────────────────────────────

def get_llm_for_agent() -> ChatGroq:
    """Return an LLM instance configured for tool-calling agent use."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set. Add it to backend/.env")
    return ChatGroq(
        model="meta-llama/llama-4-scout-17b-16e-instruct",
        temperature=0,   # 0 = deterministic; minimises hallucinated IDs / names
        api_key=api_key,
    )


def _get_llm(temperature: float = 0.4) -> ChatGroq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY is not set. Add it to backend/.env"
        )
    return ChatGroq(
        model="llama-3.3-70b-versatile",
        temperature=temperature,
        api_key=api_key,
    )


# ── Public helpers ────────────────────────────────────────────────────────────

def complete(prompt: ChatPromptTemplate, variables: dict) -> str:
    """
    Invoke a prompt template and return plain text.
    Used for: description generation, summarization.
    """
    llm = _get_llm()
    chain = prompt | llm
    result = chain.invoke(variables)
    return result.content.strip()


T = TypeVar("T", bound=BaseModel)

def complete_structured(
    prompt: ChatPromptTemplate,
    variables: dict,
    schema: Type[T],
) -> T:
    """
    Invoke a prompt template and return a validated Pydantic model.
    Uses LangChain's with_structured_output() — enforces JSON schema via tool calling.
    Used for: task parsing, meeting extraction.
    """
    llm = _get_llm(temperature=0.1)   # lower temp for structured extraction
    structured_llm = llm.with_structured_output(schema)
    chain = prompt | structured_llm
    return chain.invoke(variables)


def complete_structured_strict(
    prompt: ChatPromptTemplate,
    variables: dict,
    schema: Type[T],
    *,
    model: str = "meta-llama/llama-4-scout-17b-16e-instruct",
    temperature: float = 0,
) -> T:
    """
    Like complete_structured(), but uses constrained decoding via
    method="json_schema", strict=True. The provider forces the model output to
    conform to the JSON schema during generation, so the result is guaranteed
    valid against `schema` — no stringified scalars, no extra keys.

    Requires a model that supports strict structured outputs on Groq
    (llama-4-scout, gpt-oss, kimi-k2 — NOT llama-3.3-70b-versatile).

    The schema must be "strict-clean": every field required (no defaults),
    no numeric bounds (ge/le), and extra="forbid". See StrictTimesheet* schemas.
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set. Add it to backend/.env")
    llm = ChatGroq(model=model, temperature=temperature, api_key=api_key)
    structured_llm = llm.with_structured_output(schema, method="json_schema", strict=True)
    chain = prompt | structured_llm
    return chain.invoke(variables)


def transcribe(audio_bytes: bytes, filename: str = "audio.mp3") -> str:
    """
    Transcribe audio using Groq Whisper (whisper-large-v3).
    Stubbed — activate when the meeting ingestion feature is built.

    Usage:
        from groq import Groq
        client = Groq(api_key=os.getenv("GROQ_API_KEY"))
        transcript = client.audio.transcriptions.create(
            model="whisper-large-v3",
            file=(filename, audio_bytes),
        )
        return transcript.text
    """
    raise NotImplementedError(
        "transcribe() is reserved for the meeting ingestion feature. "
        "Install `groq` package and uncomment the implementation above."
    )
