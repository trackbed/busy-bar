import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from agent_fleet.controls import Chime, Controls
from agent_fleet.fleet import Fleet
from agent_fleet.render_showtime import render_showtime
from agent_fleet.settings import load_settings
from agent_fleet.showtime import Showtime
from bar_kit import (
    PALETTE,
    ButtonEvent,
    EncoderEvent,
    RectangleElement,
    color_of,
    elements_by_id,
    overflowing_text,
    text_of,
)

NOW = datetime(2026, 11, 24, 12, tzinfo=UTC)


def workspace(name: str, group: str, reason: str) -> dict[str, str]:
    return {"id": name, "name": name, "group": group, "reason": reason}


def write_board(path: Path, *rows: dict[str, str], now: datetime = NOW) -> None:
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "scope": "trackbed/skills",
                "observedAt": now.isoformat(),
                "workspaces": rows,
            }
        )
    )


def text(board: Showtime, key: str = "headline", now: datetime = NOW) -> str | None:
    frame = render_showtime(now, board)
    assert overflowing_text(frame) == []
    return text_of(elements_by_id(frame), key)


def test_attention_lifecycle_tracks_workspaces_across_passes(tmp_path: Path) -> None:
    path = tmp_path / "showtime.json"
    assert load_settings({"AGENT_FLEET_SHOWTIME": str(path)}).showtime == path
    board = Showtime(path)
    assert text(board) == "NO DATA"
    assert not board.refresh(NOW)
    write_board(path)
    assert not board.refresh(NOW)
    assert text(board) == "CLEAR"
    ready = workspace("a", "merge_ready", "Merge-ready")
    working = workspace("b", "working", "Running")
    blocked = workspace("b", "needs_me", "Decision")
    write_board(path, ready, working)
    assert not board.refresh(NOW)
    assert text(board) == "READY"
    assert text(board, "badge") == "1"
    write_board(path, ready, blocked)
    assert board.refresh(NOW)
    assert text(board) == "NEEDS ME"
    controls = Controls(
        Fleet(),
        Chime(lambda _: None, on_screen=lambda: True),
        on_screen=lambda: True,
        showtime=board,
    )
    controls.handle(EncoderEvent(delta=1))
    controls.handle(ButtonEvent(button="ok", action="press"))
    assert text(board, "row-0") == "* b"
    assert text(board, "reason-0") == "Decision"
    assert not board.refresh(NOW)
    assert text(board) == "NEEDS ME"
    assert text(board, now=NOW + timedelta(minutes=15)) == "STALE"
    path.write_text("bad")
    assert not board.refresh(NOW)
    assert text(board, "footer") == "Read failed / Checked now"
    write_board(path, working)
    assert not board.refresh(NOW)
    assert not board.seen
    write_board(path, blocked)
    assert board.refresh(NOW)
    restarted = Showtime(path)
    assert not restarted.refresh(NOW)
    assert text(restarted) == "NEEDS ME"


def test_selected_review_reads_phases_and_stays_dated(tmp_path: Path) -> None:
    path = tmp_path / "showtime.json"
    write_board(path, workspace("w", "working", "Agent working"))
    board = Showtime(path)
    board.refresh(NOW)
    controls = Controls(
        Fleet(),
        Chime(lambda _: None, on_screen=lambda: True),
        on_screen=lambda: True,
        showtime=board,
    )
    start = ButtonEvent(button="start", action="press")
    controls.handle(start)
    board.refresh(NOW)
    assert text(board) == "NO REVIEW"
    progress = tmp_path / "review-w.json"
    record = {
        "version": 1,
        "workspace": "w",
        "startedAt": NOW.isoformat(),
        "observedAt": NOW.isoformat(),
        "workItem": "W-12",
        "phase": "review",
        "round": 2,
        "cycles": 1,
        "lastGate": "Code review",
    }
    for phase, headline in (
        ("review", "REVIEW"),
        ("fixing", "FIXING"),
        ("verify", "VERIFY"),
        ("done", "DONE"),
        ("blocked", "BLOCKED"),
    ):
        progress.write_text(json.dumps({**record, "phase": phase}))
        assert not board.refresh(NOW)
        assert text(board) == headline
        assert text(board, "gate") == "Last gate: Code review"
        assert text(board, "badge") == "2"
        frame = elements_by_id(render_showtime(NOW, board))
        if phase in ("done", "blocked"):
            assert text_of(frame, "outcome") == headline
            assert "phase-link" not in frame
        else:
            active = frame[f"phase-rail-{phase}"]
            assert isinstance(active, RectangleElement)
            assert active.fill_colors == [PALETTE.bright]
            assert "outcome" not in frame
    progress.write_text(json.dumps({**record, "round": 0, "cycles": 0, "lastGate": ""}))
    board.refresh(NOW)
    assert text(board) == "REVIEW"
    assert text(board, "cycles") == "Fix cycles: 0"
    later = NOW + timedelta(minutes=16)
    assert text(board, now=later) == "LAST REVIEW"
    progress.write_text(json.dumps({**record, "workspace": "another"}))
    board.refresh(later)
    assert text(board, "footer", later) == "Read failed / Updated 16m"
    controls.handle(start)
    assert text(board) == "WORKING"
    write_board(path)
    board.refresh(later)
    assert text(board) == "CLEAR"


@pytest.mark.parametrize(
    "bad",
    [
        None,
        {"version": True},
        {"version": 1},
        {"workspaces": [1]},
        {"workspaces": [{}]},
        {"workspaces": [workspace("../escape", "working", "Running")]},
        {"observedAt": "2026-11-24"},
        {"workspaces": [workspace("w", "new-group", "Running")]},
    ],
)
def test_bad_input_cannot_clear_the_last_pass(tmp_path: Path, bad: object) -> None:
    path = tmp_path / "showtime.json"
    write_board(path, workspace("r", "working", "Running"))
    board = Showtime(path)
    board.refresh(NOW)
    good = json.loads(path.read_text())
    path.write_text(
        json.dumps(
            {**good, **bad}
            if isinstance(bad, dict) and bad.get("version") != 1
            else bad
        )
    )
    assert not board.refresh(NOW)
    assert board.failed
    assert text(board) == "WORKING"


def test_wheel_expands_only_the_selected_row_and_keeps_its_reason_visible(
    tmp_path: Path,
) -> None:
    path = tmp_path / "showtime.json"
    rows = [workspace(f"w{i}", "needs_me", "Decision needed") for i in range(7)]
    rows[-1]["name"] = "L" * 80
    rows[-1]["reason"] = "Permission required " * 20
    write_board(path, *rows)
    board = Showtime(path)
    board.refresh(NOW)
    board.move(4)
    frame = elements_by_id(render_showtime(NOW, board))
    selection = frame["selection"]
    assert isinstance(selection, RectangleElement)
    assert selection.y == frame["row-2"].y
    assert frame["reason-2"].y > frame["row-2"].y
    assert frame["reason-1"].y == frame["row-1"].y
    assert color_of(frame, "row-2") != color_of(frame, "row-1")
    assert "row-5" not in frame
    assert text(board, "badge") == "7"
    assert text(board) == "NEED ME"
    board.move(-4)
    assert (text(board, "row-0") or "").endswith("..")
    assert (text(board, "reason-0") or "").endswith("..")
