"""Date shapes the Clockify importer must accept.

Exports arrive in whatever the exporting account's locale produced, so the
importer takes dashes, slashes, dots, two-digit years, month names and ISO. Only
the all-numeric forms are ambiguous; those are resolved per file.
"""

import pytest
from fastapi import HTTPException

from logic.clockify_import_logic import _detect_day_first, _parse_date


def _rows(*dates):
    return [{"Start Date": d} for d in dates]


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("13-08-2026", "2026-08-13"),      # dashes
        ("13/08/2026", "2026-08-13"),      # slashes
        ("13.08.2026", "2026-08-13"),      # dots
        ("13-08-26", "2026-08-13"),        # two-digit year
        ("13-Aug-2026", "2026-08-13"),     # short month name
        ("13 Aug 2026", "2026-08-13"),     # spaces
        ("13-September-2026", "2026-09-13"),  # long month name
        ("2026-08-13", "2026-08-13"),      # ISO
        ("3-8-2026", "2026-08-03"),        # single digits
        ("  13-08-2026  ", "2026-08-13"),  # padded
    ],
)
def test_day_first_shapes(raw, expected):
    assert _parse_date(raw, True) == expected


def test_month_first_file_still_parses():
    assert _parse_date("08/13/2026", False) == "2026-08-13"


def test_iso_ignores_the_day_first_flag():
    # ISO states its own order, so it must not flip with the file's setting.
    assert _parse_date("2026-08-13", True) == _parse_date("2026-08-13", False)


@pytest.mark.parametrize("raw", ["not-a-date", "", "13/13/2026", "32-01-2026", "13-Foo-2026"])
def test_rubbish_is_rejected(raw):
    with pytest.raises(ValueError):
        _parse_date(raw, True)


def test_detects_day_first_from_a_day_above_12():
    assert _detect_day_first(_rows("13-08-2026", "01-08-2026")) is True


def test_detects_month_first():
    assert _detect_day_first(_rows("08/13/2026", "01/08/2026")) is False


def test_unambiguous_files_need_no_detection():
    # Every row is ISO or month-named, so there is nothing to guess.
    assert _detect_day_first(_rows("2026-08-13", "2026-01-08")) is True
    assert _detect_day_first(_rows("13-Aug-2026", "01-Aug-2026")) is True


def test_refuses_a_file_it_cannot_read():
    # No day above 12 anywhere: guessing would silently file time under the wrong date.
    with pytest.raises(HTTPException) as e:
        _detect_day_first(_rows("01-02-2026", "03-04-2026"))
    assert e.value.status_code == 400


def test_refuses_a_file_that_mixes_both_orders():
    with pytest.raises(HTTPException) as e:
        _detect_day_first(_rows("13-08-2026", "08/25/2026"))
    assert e.value.status_code == 400
