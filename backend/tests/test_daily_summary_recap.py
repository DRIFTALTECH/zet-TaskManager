"""Your Day Wrapped recap sanitization — mirrors insight_logic pipeline."""

from logic.daily_summary_logic import _is_valid_recap, _sanitize_recap


def test_sanitize_recap_strips_thinking():
    raw = (
        "<think>First, I need to review the log.</think>"
        "You wrapped up a solid day.\n- Shipped the feature"
    )
    assert _sanitize_recap(raw) == "You wrapped up a solid day.\n- Shipped the feature"


def test_sanitize_recap_drops_reasoning_lines():
    raw = (
        "Let's see what they did today.\n"
        "The user wants a recap.\n"
        "You made great progress today.\n- Closed two tasks"
    )
    assert _sanitize_recap(raw) == "You made great progress today.\n- Closed two tasks"


def test_is_valid_recap_rejects_leaks():
    assert not _is_valid_recap("Let me structure the answer")
    assert _is_valid_recap("You finished strong today.")


def test_generate_recap_uses_fallback_on_failure(monkeypatch):
    import ai.chains as chains
    from logic.daily_summary_logic import _FALLBACK_RECAP, _generate_recap

    def boom(*_):
        raise RuntimeError("nope")

    monkeypatch.setattr(chains, "summarize_day", boom)
    assert _generate_recap("2026-06-29", "Tasks worked on today: none.") == _FALLBACK_RECAP
