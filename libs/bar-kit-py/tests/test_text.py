import pytest

from bar_kit import to_bar_text


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Plain ASCII stays as it is", "Plain ASCII stays as it is"),
        ("Nørreport", "Noerreport"),
        ("Århus Æblegård", "Aarhus Aeblegaard"),
        ("ÅRHUS ØSTERBRO", "AARHUS OESTERBRO"),
        ("Straße", "Strasse"),
        ("Café crème", "Cafe creme"),
        ("Łódź", "Lodz"),
        (
            "\N{LEFT DOUBLE QUOTATION MARK}Quoted\N{RIGHT DOUBLE QUOTATION MARK}"
            " \N{EN DASH} it\N{RIGHT SINGLE QUOTATION MARK}s done"
            "\N{HORIZONTAL ELLIPSIS}",
            '"Quoted" - it\'s done...',
        ),
        ("Fix `to_bar_text`", "Fix 'to_bar_text'"),
        ("\N{ROCKET} Launch day \N{PARTY POPPER}", "Launch day"),
        ("  tabs\tand\nnewlines  ", "tabs and newlines"),
        ("non\N{NO-BREAK SPACE}breaking", "non breaking"),
        ("東京 Tokyo", "Tokyo"),
        ("", ""),
    ],
)
def test_turns_text_into_printable_ascii(text: str, expected: str) -> None:
    assert to_bar_text(text) == expected


def test_spells_out_a_danish_letter_written_as_a_base_letter_and_a_ring() -> None:
    assert to_bar_text("a\N{COMBINING RING ABOVE}bo") == "aabo"
