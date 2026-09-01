"""Timesheet weekly submission workflow."""

from datetime import date, timedelta

import pytest
from fastapi import HTTPException

import crud.clients as clients_crud
import crud.projects as projects_crud
import crud.sections as sections_crud
import crud.users as users_crud
from database.database import SessionLocal
from database.init_db import new_id
from database.models import User
from logic import timesheet_logic
from logic.schemas import TimesheetEntryCreate, TimesheetRejectBody, TimesheetSubmissionOut


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _seed_user(db, *, role: str, email: str, manager_id: str | None = None) -> User:
    uid = new_id("u")
    user = users_crud.create_user(
        db,
        user_id=uid,
        name=f"Test {role}",
        email=email,
        password_hash="x",
        role=role,
    )
    if manager_id:
        user = users_crud.set_manager_id(db, user, manager_id)
    return user


def _seed_project_with_member(db, user: User) -> tuple[str, str]:
    pid = new_id("p")
    sid = new_id("s")
    cid = new_id("c")
    clients_crud.create(db, client_id=cid, name="Test Client", created_at="2020-01-01")
    projects_crud.create_project(
        db,
        project_id=pid,
        name="P",
        description="",
        client_id=cid,
        created_by=user.id,
        created_at="2020-01-01",
    )
    sections_crud.create_section(db, section_id=sid, name="S", project_id=pid)
    projects_crud.add_member(db, pid, user.id)
    return pid, sid


def test_week_helpers():
    monday = date(2025, 6, 23)  # a Monday
    assert timesheet_logic.week_start_for(monday.isoformat()) == "2025-06-23"
    assert timesheet_logic.week_end_for("2025-06-23") == "2025-06-29"


def test_partial_week_submit_locks_only_selected_dates(db):
    suffix = new_id("t")
    mgr = _seed_user(db, role="manager", email=f"mgr-partial-{suffix}@example.com")
    emp = _seed_user(db, role="employee", email=f"emp-partial-{suffix}@example.com", manager_id=mgr.id)
    pid, sid = _seed_project_with_member(db, emp)
    ws = timesheet_logic.week_start_for(date.today().isoformat())
    monday = date.fromisoformat(ws)
    tuesday = (monday + timedelta(days=1)).isoformat()
    today = date.today().isoformat()

    timesheet_logic.create_entry(
        db, emp.id,
        TimesheetEntryCreate(
            workDate=today, projectId=pid, sectionId=sid,
            description="today", timeFrom="09:00", timeTo="10:00",
        ),
    )
    if tuesday != today:
        timesheet_logic.create_entry(
            db, emp.id,
            TimesheetEntryCreate(
                workDate=tuesday, projectId=pid, sectionId=sid,
                description="tue", timeFrom="11:00", timeTo="12:00",
            ),
        )

    sub = timesheet_logic.submit_week(db, emp.id, ws, [today])
    assert sub.status == "submitted"
    assert sub.submittedDates == [today]

    with pytest.raises(HTTPException) as exc:
        timesheet_logic.create_entry(
            db, emp.id,
            TimesheetEntryCreate(
                workDate=today, projectId=pid, sectionId=sid,
                description="blocked", timeFrom="13:00", timeTo="14:00",
            ),
        )
    assert exc.value.status_code == 409

    if tuesday != today:
        timesheet_logic.create_entry(
            db, emp.id,
            TimesheetEntryCreate(
                workDate=tuesday, projectId=pid, sectionId=sid,
                description="still ok", timeFrom="13:00", timeTo="14:00",
            ),
        )

    with pytest.raises(HTTPException) as exc:
        timesheet_logic.submit_week(db, emp.id, ws, [today])
    assert exc.value.status_code == 400

    sub2 = timesheet_logic.submit_week(db, emp.id, ws, [tuesday]) if tuesday != today else sub
    if tuesday != today:
        assert set(sub2.submittedDates) == {today, tuesday}


def test_submission_review_shows_only_submitted_dates(db):
    suffix = new_id("t")
    mgr = _seed_user(db, role="manager", email=f"mgr-review-partial-{suffix}@example.com")
    emp = _seed_user(db, role="employee", email=f"emp-review-partial-{suffix}@example.com", manager_id=mgr.id)
    pid, sid = _seed_project_with_member(db, emp)
    # Anchor to LAST week: create_entry refuses dates beyond tomorrow, so using the
    # current week made this test fail whenever it ran on a Monday or Tuesday.
    ws = timesheet_logic.week_start_for((date.today() - timedelta(days=7)).isoformat())
    monday = date.fromisoformat(ws)
    tuesday = (monday + timedelta(days=1)).isoformat()
    wednesday = (monday + timedelta(days=2)).isoformat()
    thursday = (monday + timedelta(days=3)).isoformat()

    for wd, desc in [(tuesday, "tue"), (wednesday, "wed"), (thursday, "thu")]:
        timesheet_logic.create_entry(
            db, emp.id,
            TimesheetEntryCreate(
                workDate=wd, projectId=pid, sectionId=sid,
                description=desc, timeFrom="09:00", timeTo="10:00",
            ),
        )

    sub = timesheet_logic.submit_week(db, emp.id, ws, [tuesday, wednesday, thursday])
    review = timesheet_logic.get_submission_review(db, mgr.id, sub.id)

    assert [d.workDate for d in review.days] == [tuesday, wednesday, thursday]
    assert review.totalSeconds == 3 * 3600
    assert ws not in {d.workDate for d in review.days}

def test_submit_approve_reject_flow(db):
    suffix = new_id("t")
    mgr = _seed_user(db, role="manager", email=f"mgr-ts-{suffix}@example.com")
    emp = _seed_user(db, role="employee", email=f"emp-ts-{suffix}@example.com", manager_id=mgr.id)
    pid, sid = _seed_project_with_member(db, emp)
    ws = timesheet_logic.week_start_for(date.today().isoformat())

    draft = timesheet_logic.get_week_status(db, emp.id, ws)
    assert draft.status == "draft"

    timesheet_logic.create_entry(
        db,
        emp.id,
        TimesheetEntryCreate(
            workDate=date.today().isoformat(),
            projectId=pid,
            sectionId=sid,
            description="work",
            timeFrom="09:00",
            timeTo="10:00",
        ),
    )

    sub = timesheet_logic.submit_week(db, emp.id, ws)
    assert sub.status == "submitted"
    assert sub.reviewerId == mgr.id

    with pytest.raises(HTTPException) as exc:
        timesheet_logic.create_entry(
            db,
            emp.id,
            TimesheetEntryCreate(
                workDate=date.today().isoformat(),
                projectId=pid,
                sectionId=sid,
                description="blocked",
                timeFrom="11:00",
                timeTo="12:00",
            ),
        )
    assert exc.value.status_code == 409

    pending = timesheet_logic.list_pending_approvals(db, mgr.id)
    assert any(p.id == sub.id for p in pending)

    rejected = timesheet_logic.reject_submission(
        db, mgr.id, sub.id, TimesheetRejectBody(comment="fix hours"),
    )
    assert rejected.status == "rejected"
    assert rejected.rejectionNote == "fix hours"

    timesheet_logic.create_entry(
        db,
        emp.id,
        TimesheetEntryCreate(
            workDate=date.today().isoformat(),
            projectId=pid,
            sectionId=sid,
            description="after reject",
            timeFrom="13:00",
            timeTo="14:00",
        ),
    )

    resub = timesheet_logic.submit_week(db, emp.id, ws)
    assert resub.status == "submitted"

    approved = timesheet_logic.approve_submission(db, mgr.id, resub.id)
    assert approved.status == "approved"
    assert approved.reviewerId == mgr.id
    assert approved.reviewerName == mgr.name
    assert approved.reviewedAt is not None

    timesheet_logic.create_entry(
        db,
        emp.id,
        TimesheetEntryCreate(
            workDate=date.today().isoformat(),
            projectId=pid,
            sectionId=sid,
            description="after approve",
            timeFrom="15:00",
            timeTo="16:00",
        ),
    )
    again = timesheet_logic.submit_week(db, emp.id, ws)
    assert again.status == "submitted"


def test_manager_submissions_listing(db):
    suffix = new_id("t")
    mgr = _seed_user(db, role="manager", email=f"mgr-list-{suffix}@example.com")
    emp = _seed_user(db, role="employee", email=f"emp-list-{suffix}@example.com", manager_id=mgr.id)
    other = _seed_user(db, role="employee", email=f"other-list-{suffix}@example.com", manager_id=mgr.id)
    emp_pid, emp_sid = _seed_project_with_member(db, emp)
    other_pid, other_sid = _seed_project_with_member(db, other)
    ws = timesheet_logic.week_start_for(date.today().isoformat())
    prev_ws = (date.fromisoformat(ws) - timedelta(days=7)).isoformat()

    def submit_for(user: User, week: str, project_id: str, section_id: str) -> TimesheetSubmissionOut:
        timesheet_logic.create_entry(
            db, user.id,
            TimesheetEntryCreate(
                workDate=week, projectId=project_id, sectionId=section_id,
                description="work", timeFrom="09:00", timeTo="10:00",
            ),
        )
        return timesheet_logic.submit_week(db, user.id, week)

    sub_a = submit_for(emp, ws, emp_pid, emp_sid)
    sub_b = submit_for(other, prev_ws, other_pid, other_sid)
    timesheet_logic.approve_submission(db, mgr.id, sub_b.id)

    sub_c = submit_for(emp, prev_ws, emp_pid, emp_sid)
    timesheet_logic.reject_submission(db, mgr.id, sub_c.id, TimesheetRejectBody(comment="nope"))

    all_rows = timesheet_logic.list_manager_submissions(db, mgr.id)
    ids = [r.id for r in all_rows]
    assert sub_a.id in ids
    assert sub_b.id in ids
    assert sub_c.id in ids
    assert ids.index(sub_a.id) < ids.index(sub_c.id) < ids.index(sub_b.id)

    pending_only = timesheet_logic.list_pending_approvals(db, mgr.id)
    assert [p.id for p in pending_only] == [sub_a.id]

    assert len(timesheet_logic.list_manager_submissions(db, mgr.id, submission_status="approved")) == 1
    assert timesheet_logic.list_manager_submissions(db, mgr.id, user_id=emp.id)[0].id == sub_a.id
    prev_week_rows = timesheet_logic.list_manager_submissions(db, mgr.id, week_start=prev_ws)
    assert {r.id for r in prev_week_rows} == {sub_b.id, sub_c.id}


def test_submission_review(db):
    suffix = new_id("t")
    mgr = _seed_user(db, role="manager", email=f"mgr-review-{suffix}@example.com")
    other_mgr = _seed_user(db, role="manager", email=f"other-mgr-{suffix}@example.com")
    emp = _seed_user(db, role="employee", email=f"emp-review-{suffix}@example.com", manager_id=mgr.id)
    superadmin = _seed_user(db, role="superadmin", email=f"superadmin-review-{suffix}@example.com")
    pid, sid = _seed_project_with_member(db, emp)
    ws = timesheet_logic.week_start_for(date.today().isoformat())
    monday = date.fromisoformat(ws)
    tuesday = (monday + timedelta(days=1)).isoformat()

    timesheet_logic.create_entry(
        db, emp.id,
        TimesheetEntryCreate(
            workDate=ws, projectId=pid, sectionId=sid,
            description="mon", timeFrom="09:00", timeTo="10:30", billable=True,
        ),
    )
    timesheet_logic.create_entry(
        db, emp.id,
        TimesheetEntryCreate(
            workDate=tuesday, projectId=pid, sectionId=sid,
            description="tue", timeFrom="14:00", timeTo="15:00", billable=False,
        ),
    )
    sub = timesheet_logic.submit_week(db, emp.id, ws)

    review = timesheet_logic.get_submission_review(db, mgr.id, sub.id)
    assert review.submission.id == sub.id
    assert review.totalSeconds == 5400 + 3600
    assert len(review.days) == 7
    mon_day = next(d for d in review.days if d.workDate == ws)
    assert mon_day.totalSeconds == 5400
    assert len(mon_day.entries) == 1
    assert mon_day.entries[0].projectName == "P"
    assert mon_day.entries[0].sectionName == "S"
    assert mon_day.entries[0].billable is True

    timesheet_logic.get_submission_review(db, superadmin.id, sub.id)

    review_other = timesheet_logic.get_submission_review(db, other_mgr.id, sub.id)
    assert review_other.submission.id == sub.id

    approved_by_other = timesheet_logic.approve_submission(db, other_mgr.id, sub.id)
    assert approved_by_other.reviewerId == other_mgr.id
    assert approved_by_other.reviewerName == other_mgr.name

    own_review = timesheet_logic.get_submission_review(db, emp.id, sub.id)
    assert own_review.submission.id == sub.id

    with pytest.raises(HTTPException) as exc:
        timesheet_logic.approve_submission(db, emp.id, sub.id)
    assert exc.value.status_code == 403


def test_employee_submissions_scoped_to_self(db):
    suffix = new_id("t")
    mgr = _seed_user(db, role="manager", email=f"mgr-emp-scope-{suffix}@example.com")
    emp = _seed_user(db, role="employee", email=f"emp-scope-{suffix}@example.com", manager_id=mgr.id)
    other = _seed_user(db, role="employee", email=f"other-scope-{suffix}@example.com", manager_id=mgr.id)
    emp_pid, emp_sid = _seed_project_with_member(db, emp)
    other_pid, other_sid = _seed_project_with_member(db, other)
    ws = timesheet_logic.week_start_for(date.today().isoformat())

    def submit_for(user: User, project_id: str, section_id: str) -> TimesheetSubmissionOut:
        timesheet_logic.create_entry(
            db, user.id,
            TimesheetEntryCreate(
                workDate=ws, projectId=project_id, sectionId=section_id,
                description="work", timeFrom="09:00", timeTo="10:00",
            ),
        )
        return timesheet_logic.submit_week(db, user.id, ws)

    own = submit_for(emp, emp_pid, emp_sid)
    submit_for(other, other_pid, other_sid)

    rows = timesheet_logic.list_manager_submissions(db, emp.id)
    assert [r.id for r in rows] == [own.id]

    with pytest.raises(HTTPException) as exc:
        timesheet_logic.list_manager_submissions(db, emp.id, user_id=other.id)
    assert exc.value.status_code == 403


def test_manager_sees_all_submissions_including_own(db):
    suffix = new_id("t")
    senior_mgr = _seed_user(db, role="manager", email=f"senior-mgr-{suffix}@example.com")
    mgr = _seed_user(db, role="manager", email=f"mgr-all-{suffix}@example.com", manager_id=senior_mgr.id)
    emp = _seed_user(db, role="employee", email=f"emp-all-{suffix}@example.com", manager_id=mgr.id)
    other_mgr = _seed_user(db, role="manager", email=f"other-mgr-all-{suffix}@example.com")
    other_emp = _seed_user(db, role="employee", email=f"other-emp-all-{suffix}@example.com", manager_id=other_mgr.id)
    mgr_pid, mgr_sid = _seed_project_with_member(db, mgr)
    emp_pid, emp_sid = _seed_project_with_member(db, emp)
    other_pid, other_sid = _seed_project_with_member(db, other_emp)
    ws = timesheet_logic.week_start_for(date.today().isoformat())

    def submit_for(user: User, project_id: str, section_id: str) -> TimesheetSubmissionOut:
        timesheet_logic.create_entry(
            db, user.id,
            TimesheetEntryCreate(
                workDate=ws, projectId=project_id, sectionId=section_id,
                description="work", timeFrom="09:00", timeTo="10:00",
            ),
        )
        return timesheet_logic.submit_week(db, user.id, ws)

    mgr_sub = submit_for(mgr, mgr_pid, mgr_sid)
    emp_sub = submit_for(emp, emp_pid, emp_sid)
    other_sub = submit_for(other_emp, other_pid, other_sid)

    all_rows = timesheet_logic.list_manager_submissions(db, mgr.id)
    ids = {r.id for r in all_rows}
    assert mgr_sub.id in ids
    assert emp_sub.id in ids
    assert other_sub.id in ids

    self_approved = timesheet_logic.approve_submission(db, mgr.id, mgr_sub.id)
    assert self_approved.status == "approved"
    assert self_approved.reviewerId == mgr.id


def test_manager_reopen_and_reject_transitions(db):
    suffix = new_id("t")
    mgr = _seed_user(db, role="manager", email=f"mgr-x-{suffix}@example.com")
    emp = _seed_user(db, role="employee", email=f"emp-x-{suffix}@example.com", manager_id=mgr.id)
    pid, sid = _seed_project_with_member(db, emp)
    ws = timesheet_logic.week_start_for(date.today().isoformat())

    timesheet_logic.create_entry(
        db, emp.id,
        TimesheetEntryCreate(
            workDate=date.today().isoformat(), projectId=pid, sectionId=sid,
            description="work", timeFrom="09:00", timeTo="10:00",
        ),
    )
    sub = timesheet_logic.submit_week(db, emp.id, ws)
    approved = timesheet_logic.approve_submission(db, mgr.id, sub.id)
    assert approved.status == "approved"

    timesheet_logic.create_entry(
        db, emp.id,
        TimesheetEntryCreate(
            workDate=date.today().isoformat(), projectId=pid, sectionId=sid,
            description="after approve", timeFrom="11:00", timeTo="12:00",
        ),
    )

    reopened = timesheet_logic.reopen_submission(db, mgr.id, sub.id)
    assert reopened.status == "submitted"
    assert reopened.rejectionNote in (None, "")

    with pytest.raises(HTTPException) as exc:
        timesheet_logic.create_entry(
            db, emp.id,
            TimesheetEntryCreate(
                workDate=date.today().isoformat(), projectId=pid, sectionId=sid,
                description="still blocked", timeFrom="11:00", timeTo="12:00",
            ),
        )
    assert exc.value.status_code == 409

    timesheet_logic.approve_submission(db, mgr.id, sub.id)
    rejected = timesheet_logic.reject_submission(
        db, mgr.id, sub.id, TimesheetRejectBody(comment="after approval"),
    )
    assert rejected.status == "rejected"

    timesheet_logic.create_entry(
        db, emp.id,
        TimesheetEntryCreate(
            workDate=date.today().isoformat(), projectId=pid, sectionId=sid,
            description="editable", timeFrom="13:00", timeTo="14:00",
        ),
    )

    reopened2 = timesheet_logic.reopen_submission(db, mgr.id, sub.id)
    assert reopened2.status == "submitted"
