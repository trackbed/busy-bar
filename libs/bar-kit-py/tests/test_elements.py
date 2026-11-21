from bar_kit import (
    FOOTER_Y,
    FRONT_DISPLAY,
    PALETTE,
    SUMMARY_Y,
    DisplayName,
    RectangleElement,
    TextElement,
    solid_rectangle,
    status_cells,
    text_element,
)


def test_gives_each_role_the_colour_the_typescript_kit_gives_it() -> None:
    assert PALETTE.bright == "#FFFFFFFF"
    assert PALETTE.text == "#C8C8C8FF"
    assert PALETTE.dim == "#787878FF"
    assert PALETTE.idle == "#6E6E6EFF"
    assert PALETTE.good == "#00C85AFF"
    assert PALETTE.warn == "#FFAA00FF"
    assert PALETTE.bad == "#FF3C3CFF"
    assert PALETTE.info == "#3C82FFFF"


def test_puts_the_summary_under_the_headline_and_the_footer_on_the_last_rows() -> None:
    assert SUMMARY_Y == 9
    assert FOOTER_Y == 73


def test_draws_body_text_at_the_bar_default_alignment() -> None:
    element = text_element(
        element_id="title",
        text="HI",
        display=DisplayName.BACK,
        font="small",
        x=3,
        y=4,
    )

    assert element == TextElement(
        id="title",
        display=DisplayName.BACK,
        text="HI",
        font="small",
        color=PALETTE.text,
        x=3,
        y=4,
    )
    assert element.align is None


def test_takes_a_colour_and_an_alignment() -> None:
    element = text_element(
        element_id="age",
        text="5m",
        display=DisplayName.FRONT,
        font="tiny",
        x=FRONT_DISPLAY.width - 1,
        y=SUMMARY_Y,
        color=PALETTE.warn,
        align="top_right",
    )

    assert (element.color, element.align) == (PALETTE.warn, "top_right")


def test_fills_a_rectangle_with_one_colour_without_a_border() -> None:
    assert solid_rectangle(
        element_id="bar",
        display=DisplayName.FRONT,
        x=1,
        y=2,
        width=3,
        height=4,
        color=PALETTE.good,
    ) == RectangleElement(
        id="bar",
        display=DisplayName.FRONT,
        x=1,
        y=2,
        width=3,
        height=4,
        fill="solid",
        fill_colors=[PALETTE.good],
        border_width=0,
    )


def test_draws_one_cell_per_colour_along_the_front_bottom_row() -> None:
    cells = status_cells([PALETTE.good, PALETTE.bad], pitch=4, width=3)

    assert [(cell.id, cell.x, cell.y, cell.width, cell.height) for cell in cells] == [
        ("cell-0", 0, 15, 3, 1),
        ("cell-1", 4, 15, 3, 1),
    ]
    assert [cell.fill_colors for cell in cells] == [[PALETTE.good], [PALETTE.bad]]
