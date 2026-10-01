"""A lone UTF-16 surrogate in a JSON body is a 422, never a 500.

`{"note": "a\\ud800"}` is legal JSON, and Python decodes it into a str that cannot be
encoded as UTF-8. Pydantic's JSON mode refuses one in a plain `str` field itself, but not
a value that reaches the type through a `BeforeValidator` or an `Any`; that str then went
on to Postgres (a 500). And whichever validator refused it, the 422 handler crashed
echoing it back (another 500).

The bodies are sent as raw bytes: `json=` would have to encode the str itself, and cannot.

Mutations run to prove these are not decoration:
- dropping `dependencies=[Depends(_refuse_lone_surrogates)]` from the app turned the
  amount, preferences-key, echo-route and nested tests red (the echo routes with a 500:
  `PydanticSerializationError ... surrogates not allowed`);
- dropping `_scrub(...)` from `_validation_error` turned every refusal test red with that
  same `UnicodeEncodeError`, and the handler test with it.
"""

import json
from typing import Annotated, Any

import pytest
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, BeforeValidator

JSON = {"Content-Type": "application/json"}
ENTRY = b'"kind": "expense", "occurred_on": "2026-08-15", "category_name": "Food"'


def send(client, user, method: str, path: str, raw: bytes):
    headers = (user["headers"] if user else {}) | JSON
    return client.request(method, path, content=raw, headers=headers)


def assert_refused(response, loc: list):
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "validation"
    assert [error["loc"] for error in body["detail"]] == [loc]
    assert body["detail"][0]["type"] == "string_unicode"


@pytest.mark.parametrize(
    ("method", "path", "raw", "loc"),
    [
        (
            "POST",
            "/api/entries",
            b"{" + ENTRY + b', "amount": "1.00", "note": "a\\ud800"}',
            ["body", "note"],
        ),
        # Money is parsed by a BeforeValidator, which sees the str before any type does.
        ("POST", "/api/entries", b"{" + ENTRY + b', "amount": "1\\ud800"}', ["body", "amount"]),
        (
            "PUT",
            "/api/notes/6f1d9a0e-8f3c-4b8e-9c2a-1b2c3d4e5f60",
            b'{"kind": "text", "body": "a\\udfff"}',
            ["body", "body"],
        ),
        ("POST", "/api/categories", b'{"name": "a\\ud800", "kind": "expense"}', ["body", "name"]),
        # A key: before, the service's own "no module called ..." answered instead.
        (
            "PATCH",
            "/api/auth/me/preferences",
            b'{"modules": {"a\\udc00": true}}',
            ["body", "modules"],
        ),
    ],
)
def test_a_lone_surrogate_is_refused_with_422(client, user_a, method, path, raw, loc):
    assert_refused(send(client, user_a, method, path, raw), loc)


def test_a_properly_paired_surrogate_is_an_ordinary_character(client, user_a):
    """\\ud83d\\ude00 is one emoji, not two lone halves: it must still be written."""
    raw = b"{" + ENTRY + b', "amount": "1.00", "note": "ok \\ud83d\\ude00"}'
    response = send(client, user_a, "POST", "/api/entries", raw)
    assert response.status_code == 201, response.text
    assert response.json()["note"] == "ok \U0001f600"


class _Passthrough(BaseModel):
    value: Annotated[str, BeforeValidator(lambda v: v)]
    extra: list[Any] = []


@pytest.fixture
def echo_route(client):
    """A route of the shape that let a surrogate through: nothing on it refuses one.

    Registered on the real app, so it carries the app's dependencies like any router.
    """
    from app.main import app

    @app.post("/__test/echo")
    def echo(body: _Passthrough) -> _Passthrough:
        return body

    added = app.router.routes[-1]
    try:
        yield "/__test/echo"
    finally:
        app.router.routes.remove(added)


def test_a_lone_surrogate_nothing_refuses_still_never_gets_past_the_request(client, echo_route):
    assert_refused(
        send(client, None, "POST", echo_route, b'{"value": "a\\ud800"}'), ["body", "value"]
    )


def test_a_lone_surrogate_nested_in_a_list_is_found(client, echo_route):
    raw = b'{"value": "ok", "extra": [{"x": "ok"}, {"x": "a\\ud800"}]}'
    assert_refused(send(client, None, "POST", echo_route, raw), ["body", "extra", 1, "x"])


def test_the_validation_handler_renders_an_unencodable_input():
    """The handler itself, whatever raised it: a surrogate in `input` cannot crash it."""
    from app.main import _validation_error

    exc = RequestValidationError(
        [{"type": "string_too_long", "loc": ("body", "a\ud800"), "msg": "m", "input": "a\ud800"}]
    )
    response = _validation_error(None, exc)
    assert response.status_code == 422
    assert json.loads(response.body) == {
        "detail": [{"type": "string_too_long", "loc": ["body", "a�"], "msg": "m", "input": "a�"}],
        "code": "validation",
    }
