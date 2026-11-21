from collections import Counter
from datetime import UTC, datetime, timedelta

from agent_fleet.fleet import FleetView, Row, Status
from agent_fleet.render import (
    BRIGHT,
    MAX_CELLS,
    STATUS_COLORS,
    VISIBLE_ROWS,
    format_age,
    render,
)
from bar_kit import (
    BACK_DISPLAY,
    FRONT_DISPLAY,
    DisplayElement,
    DisplayName,
    RectangleElement,
    TextElement,
    overflowing_text,
)

NOW = datetime(2026, 10, 20, 9, 0, tzinfo=UTC)


def row(
    workspace: str,
    status: Status,
    detail: str | None = None,
    *,
    minutes: float = 0,
    selected: bool = False,
) -> Row:
    return Row(
        session_id=workspace,
        workspace=workspace,
        status=status,
        detail=detail or status,
        age=timedelta(minutes=minutes),
        selected=selected,
    )


def view_of(*rows: Row) -> FleetView:
    return FleetView(rows=rows, counts=Counter(item.status for item in rows))


def draw(view: FleetView) -> dict[str, DisplayElement]:
    elements = render(NOW, view, listening="127.0.0.1:8740")
    return {element.id: element for element in elements}


def text(elements: dict[str, DisplayElement], element_id: str) -> str:
    element = elements[element_id]
    assert isinstance(element, TextElement)
    return element.text


def test_waits_for_the_first_session() -> None:
    elements = draw(view_of())

    assert text(elements, "headline") == "NO AGENTS"
    assert text(elements, "summary") == "waiting for hooks"
    assert text(elements, "header") == "No sessions yet"
    assert text(elements, "hint") == "Hooks post to 127.0.0.1:8740"


def test_leads_with_how_many_sessions_need_you() -> None:
    elements = draw(
        view_of(
            row("quebec", "asking", "permit", minutes=3, selected=True),
            row("thimphu", "done", minutes=12),
            row("davis", "working", "pr-fix-ci", minutes=40),
        )
    )

    headline = elements["headline"]
    assert isinstance(headline, TextElement)
    assert headline.text == "2 NEED YOU"
    assert headline.color == STATUS_COLORS["asking"]
    assert text(elements, "summary") == "quebec permit"
    assert text(elements, "age") == "3m"
    assert [
        element.fill_colors[0]
        for element in elements.values()
        if isinstance(element, RectangleElement)
    ] == [STATUS_COLORS["asking"], STATUS_COLORS["done"], STATUS_COLORS["working"]]


def test_counts_a_single_session_in_the_singular() -> None:
    elements = draw(view_of(row("quebec", "working", minutes=1, selected=True)))

    assert text(elements, "header") == "0 need you, 1 session"


def test_lists_every_session_behind() -> None:
    elements = draw(
        view_of(
            row("quebec", "done", minutes=2, selected=True),
            row("davis", "working", "pr-fix-ci", minutes=75),
        )
    )

    assert text(elements, "header") == "1 need you, 2 sessions"
    assert text(elements, "row-0-marker") == ">"
    assert [
        (
            text(elements, f"row-{slot}-name"),
            text(elements, f"row-{slot}-detail"),
            text(elements, f"row-{slot}-age"),
        )
        for slot in (0, 1)
    ] == [("quebec", "done", "2m"), ("davis", "pr-fix-ci", "1h")]
    assert "row-1-marker" not in elements
    name = elements["row-0-name"]
    assert isinstance(name, TextElement)
    assert name.color == BRIGHT


def test_names_what_the_fleet_does_when_nothing_needs_you() -> None:
    cases: list[tuple[tuple[Row, ...], str]] = [
        ((row("a", "working"), row("b", "quiet")), "1 WORKING"),
        ((row("a", "quiet"), row("b", "background")), "1 QUIET"),
        ((row("a", "background"), row("b", "seen")), "1 WAITING"),
        ((row("a", "seen"),), "ALL SEEN"),
    ]
    for rows, headline in cases:
        assert text(draw(view_of(*rows)), "headline") == headline


def test_keeps_long_names_inside_the_displays() -> None:
    elements = draw(
        view_of(
            row(
                "kuala-lumpur-v12",
                "working",
                "very-long-skill-name-for-testing",
                minutes=59,
                selected=True,
            )
        )
    )

    assert [element.id for element in overflowing_text(elements.values())] == []
    assert text(elements, "summary").endswith("..")
    # Other elements start inside their display too.
    assert [
        element.id
        for element in elements.values()
        if element.x
        >= (
            FRONT_DISPLAY.width
            if element.display == DisplayName.FRONT
            else BACK_DISPLAY.width
        )
    ] == []


def test_scrolls_the_list_to_keep_the_highlight_visible() -> None:
    rows = tuple(
        row(f"ws{index}", "done", minutes=index, selected=index == 9)
        for index in range(12)
    )

    elements = draw(view_of(*rows))

    names = [
        text(elements, f"row-{slot}-name")
        for slot in range(VISIBLE_ROWS)
        if f"row-{slot}-name" in elements
    ]
    assert len(names) == VISIBLE_ROWS
    assert "ws9" in names
    assert names[-1] == "ws11"


def test_draws_one_cell_per_session_up_to_the_display_width() -> None:
    rows = tuple(row(f"ws{index}", "working") for index in range(MAX_CELLS + 3))

    cells = [
        element
        for element in draw(view_of(*rows)).values()
        if isinstance(element, RectangleElement)
    ]

    assert len(cells) == MAX_CELLS
    assert max(cell.x + cell.width for cell in cells) <= FRONT_DISPLAY.width


def test_formats_ages() -> None:
    assert [
        format_age(timedelta(seconds=seconds))
        for seconds in (0, 59, 60, 3599, 3600, 86_399, 86_400)
    ] == ["now", "now", "1m", "59m", "1h", "23h", "1d"]
