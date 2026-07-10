"""Recommendation engine helpers in task_forecast_logic."""

from datetime import date

from logic.task_forecast_logic import (
    _build_recommendation_score,
    _infer_skills_from_text,
    _pick_best_recommendation,
    _rank_recommendation_pick,
    _recommendation_why_bullets,
    _resolve_task_required_skills,
    _skill_match_parts,
)


def test_infer_skills_from_text():
    known = ["React", "TypeScript", "Python", "SQL"]
    assert _infer_skills_from_text("Build React dashboard", "", known) == ["React"]
    assert _infer_skills_from_text(
        "API work",
        "Needs Python and SQL queries",
        known,
    ) == ["Python", "SQL"]


def test_resolve_task_required_skills_prefers_explicit():
    known = ["React", "Python"]
    explicit = {"t1": ["React", "TypeScript"]}
    assert _resolve_task_required_skills(
        "t1",
        "Unrelated title",
        "",
        task_skills_map=explicit,
        known_skills=known,
    ) == ["React", "TypeScript"]
    assert _resolve_task_required_skills(
        "t2",
        "Build React UI",
        "",
        task_skills_map=explicit,
        known_skills=known,
    ) == ["React"]


def test_skill_match_parts():
    pct, matched, missing = _skill_match_parts(
        ["React", "Node.js"],
        ["React", "TypeScript"],
    )
    assert pct == 50
    assert matched == ["React"]
    assert missing == ["TypeScript"]

    no_req_pct, no_matched, no_missing = _skill_match_parts(["React"], [])
    assert no_req_pct is None
    assert no_matched == []
    assert no_missing == []


def test_build_recommendation_score_no_skill_hallucination():
    """Without identifiable task skills, overall equals availability only."""
    score = _build_recommendation_score(skill_match=None, availability=44, has_skill_requirements=False)
    assert score["overallMatch"] == 44
    assert score["skillApplicable"] is False
    assert score["skillMatch"] is None
    assert "don't know what skills" in score["overallFormula"]


def test_build_recommendation_score_weighted():
    score = _build_recommendation_score(skill_match=80, availability=60, has_skill_requirements=True)
    # 50% × 60 + 50% × 80 = 30 + 40 = 70
    assert score["overallMatch"] == 70
    assert score["skillApplicable"] is True
    assert score["factors"][0]["weight"] == 0.5
    assert score["factors"][1]["weight"] == 0.5
    assert "50%" in score["overallFormula"]


def test_rank_prefers_higher_overall_match():
    better = {"score": {"overallMatch": 85, "availability": 90, "skillMatch": 80}, "load": 2}
    worse = {"score": {"overallMatch": 60, "availability": 100, "skillMatch": 0}, "load": 0}
    assert _rank_recommendation_pick(better, worse)


def test_rank_prefers_skill_over_availability_when_overall_tied():
    skill_heavy = {
        "score": {"overallMatch": 70, "availability": 50, "skillMatch": 90},
        "load": 1,
    }
    avail_heavy = {
        "score": {"overallMatch": 70, "availability": 95, "skillMatch": 50},
        "load": 0,
    }
    assert _rank_recommendation_pick(skill_heavy, avail_heavy)


def test_pick_distributes_across_tied_candidates():
    a = {
        "suggestedAssigneeId": "u1",
        "score": {"overallMatch": 80, "availability": 90, "skillMatch": 70},
        "load": 1,
    }
    b = {
        "suggestedAssigneeId": "u2",
        "score": {"overallMatch": 80, "availability": 90, "skillMatch": 70},
        "load": 1,
    }
    counts: dict[str, int] = {}
    first = _pick_best_recommendation([a, b], assignment_counts=counts, task_id="t1", today=date(2026, 7, 9))
    assert first
    counts[first["suggestedAssigneeId"]] = counts.get(first["suggestedAssigneeId"], 0) + 1
    second = _pick_best_recommendation([a, b], assignment_counts=counts, task_id="t2", today=date(2026, 7, 9))
    assert second
    assert first["suggestedAssigneeId"] != second["suggestedAssigneeId"]


def test_recommendation_why_bullets():
    bullets = _recommendation_why_bullets(
        required_skills=["React", "TypeScript"],
        matched_skills=["React"],
        missing_skills=["TypeScript"],
        slip_days=0,
        free_before_due=date(2026, 7, 10),
        due=date(2026, 7, 15),
        today=date(2026, 7, 6),
    )
    assert any("required skills" in b for b in bullets)
    assert any("free time" in b for b in bullets)


def test_build_recommendation_score_labels():
    excellent = _build_recommendation_score(skill_match=90, availability=95, has_skill_requirements=True)
    assert excellent["overallLabel"] == "Excellent Match"
    fair = _build_recommendation_score(skill_match=40, availability=50, has_skill_requirements=True)
    assert fair["overallLabel"] == "Fair Match"
    assert len(fair["factors"]) >= 2
