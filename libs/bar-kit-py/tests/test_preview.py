import io
import json

from busylib import types

from bar_kit import Preview, PreviewScene, PreviewStep, print_preview


def test_writes_the_preview_as_one_line_of_json() -> None:
    output = io.StringIO()
    preview = Preview(
        summary="Says hi.",
        steps=[PreviewStep(label="Draws", text="HI on the front")],
        scenes=[
            PreviewScene(
                title="Hello",
                caption="The only scene.",
                elements=[
                    types.TextElement(
                        id="hi",
                        display=types.DisplayName.FRONT,
                        text="HI",
                        font="normal",
                        x=2,
                        y=2,
                    )
                ],
            )
        ],
    )

    print_preview(preview, output)

    written = output.getvalue()
    assert written.count("\n") == 1
    assert json.loads(written) == {
        "summary": "Says hi.",
        "steps": [{"label": "Draws", "text": "HI on the front"}],
        "scenes": [
            {
                "title": "Hello",
                "caption": "The only scene.",
                "elements": [
                    {
                        "id": "hi",
                        "type": "text",
                        "display": "front",
                        "text": "HI",
                        "font": "normal",
                        "x": 2,
                        "y": 2,
                    }
                ],
            }
        ],
    }
