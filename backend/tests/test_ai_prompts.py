"""The instructions sent to the model can be edited without a deploy.

Only edits are stored: an untouched install has an empty table and behaves
exactly as `ai/prompts.py` reads. Deleting a row is how a prompt is reset.
"""
from ai import prompts


def test_only_a_superadmin_may_read_them(client, manager, employee, superadmin):
    _, MH = manager
    _, EH = employee
    _, SH = superadmin
    assert client.get("/ai/prompts", headers=EH).status_code == 403
    assert client.get("/ai/prompts", headers=MH).status_code == 403
    assert client.get("/ai/prompts", headers=SH).status_code == 200


def test_only_a_superadmin_may_change_them(client, manager, superadmin):
    _, MH = manager
    _, SH = superadmin
    body = {"body": "Manager wording"}
    assert client.put("/ai/prompts/EXTRACT_PRD_PROMPT", json=body, headers=MH).status_code == 403
    assert client.put("/ai/prompts/EXTRACT_PRD_PROMPT", json=body, headers=SH).status_code == 200


def test_every_prompt_is_listed_with_its_shipped_wording(client, superadmin):
    _, H = superadmin
    rows = client.get("/ai/prompts", headers=H).json()
    assert {r["key"] for r in rows} == set(prompts.DEFAULTS)
    for r in rows:
        assert r["defaultBody"], r["key"]
        # Nothing edited yet, so what is in force is what shipped.
        assert r["isCustom"] is False
        assert r["body"] == r["defaultBody"]


def test_an_edit_reaches_the_prompt_the_model_is_given(client, superadmin):
    _, H = superadmin
    r = client.put(
        "/ai/prompts/EXTRACT_PRD_PROMPT",
        json={"body": "Only ever return two stories about {projects}"},
        headers=H,
    )
    assert r.status_code == 200, r.text
    assert r.json()["isCustom"] is True

    live = prompts.EXTRACT_PRD_PROMPT.messages[0].prompt.template
    assert live == "Only ever return two stories about {projects}"
    # The human turn is structure, not wording, so it survives the edit.
    assert "{text}" in prompts.EXTRACT_PRD_PROMPT.messages[1].prompt.template


def test_resetting_gives_the_shipped_wording_back(client, superadmin):
    _, H = superadmin
    client.put("/ai/prompts/OUTLINE_PRD_PROMPT", json={"body": "Custom"}, headers=H)
    assert prompts.is_overridden("OUTLINE_PRD_PROMPT")

    r = client.delete("/ai/prompts/OUTLINE_PRD_PROMPT", headers=H)
    assert r.status_code == 200
    assert r.json()["isCustom"] is False
    assert prompts.OUTLINE_PRD_PROMPT.messages[0].prompt.template == prompts.DEFAULTS["OUTLINE_PRD_PROMPT"]


def test_saving_the_default_back_is_a_reset_not_an_edit(client, superadmin):
    """Otherwise today's wording freezes against every future change to it."""
    _, H = superadmin
    r = client.put(
        "/ai/prompts/MOM_PARSE_PROMPT",
        json={"body": prompts.DEFAULTS["MOM_PARSE_PROMPT"]},
        headers=H,
    )
    assert r.json()["isCustom"] is False


def test_an_empty_prompt_is_refused(client, superadmin):
    _, H = superadmin
    r = client.put("/ai/prompts/CHAT_ANY", json={"body": "   "}, headers=H)
    assert r.status_code in (400, 404)
    r = client.put("/ai/prompts/AGENT_SYSTEM", json={"body": "   "}, headers=H)
    assert r.status_code == 400


def test_an_unknown_prompt_is_a_404(client, superadmin):
    _, H = superadmin
    assert client.put("/ai/prompts/NOPE", json={"body": "x"}, headers=H).status_code == 404


def test_a_plain_string_prompt_can_be_edited_too(client, superadmin):
    _, H = superadmin
    client.put("/ai/prompts/AGENT_SYSTEM", json={"body": "You are terse."}, headers=H)
    assert prompts.AGENT_SYSTEM == "You are terse."
    client.delete("/ai/prompts/AGENT_SYSTEM", headers=H)
    assert prompts.AGENT_SYSTEM == prompts.DEFAULTS["AGENT_SYSTEM"]


# ── Placeholders ────────────────────────────────────────────────────────────
#
# Anything in single braces is read as a value to be filled in at run time. A
# JSON example pasted into a prompt therefore asks for a value nothing supplies,
# and every call using that prompt died with a KeyError about template variables
# — naming neither the prompt nor the person who changed it.


def test_a_json_example_in_a_prompt_is_refused_with_advice(client, superadmin):
    _, H = superadmin
    r = client.put(
        "/ai/prompts/EXPAND_STORY_TASKS_PROMPT",
        json={"body": 'Work on {title}. On failure return {"error": null}.'},
        headers=H,
    )
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    assert '{"error"}' in detail          # says which one
    assert "{title}" in detail            # says what is allowed
    assert "{{like this}}" in detail      # says how to fix it


def test_doubling_the_braces_makes_it_text_and_is_accepted(client, superadmin):
    _, H = superadmin
    r = client.put(
        "/ai/prompts/EXPAND_STORY_TASKS_PROMPT",
        json={"body": 'Work on {title}. On failure return {{"error": null}}.'},
        headers=H,
    )
    assert r.status_code == 200, r.text
    assert prompts.EXPAND_STORY_TASKS_PROMPT.input_variables


def test_the_placeholders_a_prompt_may_use_are_the_ones_it_is_given(client, superadmin):
    _, H = superadmin
    ok = client.put(
        "/ai/prompts/EXTRACT_PRD_PROMPT",
        json={"body": "Only ever use {projects}"},
        headers=H,
    )
    assert ok.status_code == 200
    bad = client.put(
        "/ai/prompts/EXTRACT_PRD_PROMPT",
        json={"body": "Use {something_nobody_supplies}"},
        headers=H,
    )
    assert bad.status_code == 400


def test_dropping_a_placeholder_is_allowed(client, superadmin):
    """Using fewer of the values on offer is a choice, not a mistake."""
    _, H = superadmin
    r = client.put(
        "/ai/prompts/EXTRACT_PRD_PROMPT",
        json={"body": "Ignore the project list entirely."},
        headers=H,
    )
    assert r.status_code == 200


def test_a_prompt_stored_before_this_check_falls_back_instead_of_failing(client, superadmin):
    """The run-time guard, for anything already saved when the check went in."""
    from crud import ai_prompts as prompts_crud
    from database.database import SessionLocal
    from logic import prompt_logic

    db = SessionLocal()
    try:
        prompts_crud.upsert(
            db, "EXPAND_STORY_TASKS_PROMPT", 'broken {"error"}', "2026-01-01", "u"
        )
        db.commit()
        prompt_logic.load_into_memory(db)
    finally:
        db.close()

    # Unusable, so the shipped wording is used rather than every call failing.
    assert prompts.EXPAND_STORY_TASKS_PROMPT.messages[0].prompt.template == (
        prompts.DEFAULTS["EXPAND_STORY_TASKS_PROMPT"]
    )


def test_the_names_a_prompt_may_use_are_reported_with_it(client, superadmin):
    """The editor must not have to work them out.

    They come from the whole template, and several prompts declare all of theirs
    in the human turn — a caller reading only the system text finds none, and
    then rejects every placeholder including the ones that do work.
    """
    _, H = superadmin
    rows = {r["key"]: r for r in client.get("/ai/prompts", headers=H).json()}

    generate = rows["GENERATE_DESCRIPTION_PROMPT"]
    assert generate["placeholders"] == ["context", "project_name", "section_name", "title"]
    # None of them appear in the wording being edited, which is the trap.
    assert "{title}" not in generate["defaultBody"]

    assert rows["EXTRACT_PRD_PROMPT"]["placeholders"] == ["projects", "text"]
    assert rows["AGENT_SYSTEM"]["placeholders"] == []


def test_a_placeholder_from_the_human_turn_is_accepted_in_the_system_text(client, superadmin):
    """It was refused before, because nothing had told the editor about it."""
    _, H = superadmin
    r = client.put(
        "/ai/prompts/GENERATE_DESCRIPTION_PROMPT",
        json={"body": "Write a long description for {title} in {project_name}."},
        headers=H,
    )
    assert r.status_code == 200, r.text
    assert r.json()["isCustom"] is True
