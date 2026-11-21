import pytest
from contract import text_cases

from bar_kit import to_bar_text

TEXT_CASES = text_cases()


def test_has_the_shared_cases_to_check() -> None:
    assert TEXT_CASES


@pytest.mark.parametrize(("text", "expected"), TEXT_CASES)
def test_turns_text_into_printable_ascii(text: str, expected: str) -> None:
    assert to_bar_text(text) == expected
