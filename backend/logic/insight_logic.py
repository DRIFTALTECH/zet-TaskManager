"""
logic/insight_logic.py — AI insight generation (single pipeline for all analytics views).
"""
from __future__ import annotations

import json
import logging
from typing import Any, Literal

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

log = logging.getLogger("zet.insights")

InsightScope = Literal[
    "project_risks",
    "workload",
    "client_summary",
    "manager_summary",
    "executive_summary",
    "overview_team_summary",
    "recommendations",
    "bottlenecks",
    "timesheet_analytics",
    "capacity_forecast",
    "delivery_risk",
    "team_structure",
    "employee_work",
    "deadline_forecast",
    "smart_task_reassignment",
]


class InsightsRequest(BaseModel):
    scope: InsightScope
    context: dict[str, Any]


class InsightsResponse(BaseModel):
    scope: str
    available: bool = True
    decision: str = ""
    why: str = ""
    evidence: list[str] = []
    recommendation: str = ""
    fallbackUsed: bool = False


class _InsightLLMOutput(BaseModel):
    decision: str = Field(description="One grounded judgment based only on Metrics")
    why: str = Field(description="1-2 short sentences explaining the decision")
    evidence: list[str] = Field(description="3-6 exact facts from Metrics")
    recommendation: str = Field(description="One practical next step from the evidence")


_FORBIDDEN_WORDS = (
    "utilization, allocation, capacity, spare hours, spare capacity, expected hours, "
    "predicted hours, forecast hours, resilience, workforce, engagement, "
    "strategic risk, optimization, throughput, benchmark, bottleneck, deliverable, "
    "project health, health score, health rating, bench, demand gap"
)

_CONDITION_LABELS = "Doing well, On track, Needs attention, At risk"

_SCOPE_HINTS: dict[str, str] = {
    "deadline_forecast": (
        "Pre-computed deadline forecast with suggested teammates for at-risk tasks. "
        "Explain recommendations in very simple English (1-3 short sentences). "
        "Compare people by skills vs free time when teammatesWithFreeTime or multiple suggestions exist. "
        "Use matchingSkills, workload (Light/Medium/Busy), availableFrom, and reasons only. "
        "Never mention percentages, scores, weights, or match ratings. "
        "Never suggest auto-assigning tasks — the manager decides. "
        "Do not invent people, skills, or dates."
    ),
    "smart_task_reassignment": (
        "Pre-computed reassignment list. "
        "Explain each suggestion in simple English using whyBullets, matchedSkills, workload, and availableFrom. "
        "Never mention scores or percentages. "
        "Never suggest auto-assigning tasks."
    ),
}

_INSIGHT_PROMPT = """You explain work in simple English for a non-PM colleague.

Rules:
- ONLY use numbers and facts from the Metrics JSON below. Never invent data.
- If a metric is missing, do not mention it.
- Never use: {forbidden_words}
- Never mention percentages (%) or numeric health scores.
- If an overall condition is provided, use that plain label only ({condition_labels}).
- Evidence must cite exact facts from Metrics (names, skills, workload labels, dates — no match percentages).
- Output ONLY the four JSON fields. No reasoning, instructions, or preamble.

View: {scope}
{scope_hint}

Metrics:
{context}"""

from ai.response_parser import extract_final_answer

_LEAK_MARKERS = (
    "recommendation should",
    "avoid using",
    "let me structure",
    "let me ",
    "strict rules",
    "write your answer",
    "use these labels only",
    "<one clear sentence",
    "3 to 6 bullets",
    "metrics below",
    "never invent",
    "never use these words",
    "output only",
    "json fields",
    "chain-of-thought",
    "redacted_thinking",
)


def _looks_like_leak(text: str) -> bool:
    lower = extract_final_answer(text).lower().strip()
    if not lower:
        return True
    return any(marker in lower for marker in _LEAK_MARKERS)


def _sanitize_text(text: str) -> str:
    cleaned = extract_final_answer(text)
    parts = [ln.strip() for ln in cleaned.splitlines() if ln.strip() and not _looks_like_leak(ln)]
    if parts:
        return " ".join(parts).strip()
    single = cleaned.strip()
    return "" if _looks_like_leak(single) else single


def _sanitize_evidence(items: list[str]) -> list[str]:
    out: list[str] = []
    for item in items:
        s = _sanitize_text(item.lstrip("-• ").strip())
        if s and not _looks_like_leak(s):
            out.append(s)
        if len(out) >= 6:
            break
    return out


def _to_response(raw: _InsightLLMOutput, scope: str) -> InsightsResponse:
    return InsightsResponse(
        scope=scope,
        available=True,
        decision=_sanitize_text(raw.decision),
        why=_sanitize_text(raw.why),
        evidence=_sanitize_evidence(raw.evidence),
        recommendation=_sanitize_text(raw.recommendation),
        fallbackUsed=False,
    )


def _is_valid_response(resp: InsightsResponse) -> bool:
    if not resp.decision or _looks_like_leak(resp.decision):
        return False
    for field in (resp.why, resp.recommendation):
        if field and _looks_like_leak(field):
            return False
    for item in resp.evidence:
        if _looks_like_leak(item):
            return False
    return True


def _unavailable(scope: str) -> InsightsResponse:
    return InsightsResponse(scope=scope, available=False, fallbackUsed=True)


def _call_llm(scope: str, context: dict[str, Any]) -> _InsightLLMOutput:
    from ai import service as ai_service

    context_str = json.dumps(context, indent=2)
    prompt = ChatPromptTemplate.from_messages([("human", _INSIGHT_PROMPT)])
    return ai_service.complete_structured(
        prompt,
        {
            "scope": scope.replace("_", " "),
            "scope_hint": _SCOPE_HINTS.get(scope, ""),
            "context": context_str,
            "forbidden_words": _FORBIDDEN_WORDS,
            "condition_labels": _CONDITION_LABELS,
        },
        _InsightLLMOutput,
    )


def generate_insights(scope: InsightScope, context: dict[str, Any]) -> InsightsResponse:
    """Generate sanitized structured insights; retry once on invalid or leaked output."""
    last_exc: Exception | None = None
    for attempt in range(2):
        try:
            raw = _call_llm(scope, context)
            resp = _to_response(raw, scope)
            if _is_valid_response(resp):
                return resp
            log.warning("AI insight invalid/leaked scope=%s attempt=%s", scope, attempt + 1)
        except Exception as exc:
            last_exc = exc
            log.warning("AI insight failed scope=%s attempt=%s: %s", scope, attempt + 1, exc)
    if last_exc:
        log.error("AI insights generation failed scope=%s: %s", scope, last_exc)
    return _unavailable(scope)


def _demo() -> None:
    assert _sanitize_text("Let me structure the answer") == ""
    assert _sanitize_text("The team has overdue work.") == "The team has overdue work."
    assert extract_final_answer("</think>Done") == "Done"
    leaked = InsightsResponse(
        scope="x",
        decision="Recommendation should be short",
        why="",
        evidence=[],
        recommendation="",
    )
    assert not _is_valid_response(leaked)
    good = InsightsResponse(
        scope="overview_team_summary",
        decision="The team has overdue work that needs attention first.",
        why="Several tasks are past due.",
        evidence=["5 overdue tasks", "3 active projects"],
        recommendation="Finish overdue tasks first.",
    )
    assert _is_valid_response(good)
    u = _unavailable("delivery_risk")
    assert u.available is False and u.fallbackUsed is True


if __name__ == "__main__":
    _demo()
    print("insight_logic: ok")
