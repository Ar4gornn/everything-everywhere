"""AD-54 — invites issued from the web client, by an admin only."""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.config import get_settings


@pytest.fixture
def invite_only(monkeypatch):
    monkeypatch.setenv("REGISTRATION_MODE", "invite")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def make_admin(owner_engine, user_id: uuid.UUID) -> None:
    """The way `backend/admin.py` does it — as the owner."""
    with owner_engine.begin() as conn:
        conn.execute(text("UPDATE users SET is_admin = true WHERE id = :id"), {"id": user_id})


@pytest.fixture
def admin(user_a, owner_engine):
    make_admin(owner_engine, user_a["id"])
    return user_a


def create(client, who, **body):
    return client.post("/api/admin/invites", json=body, headers=who["headers"])


# --- the gate -----------------------------------------------------------------------------


def test_me_says_who_is_an_admin(client, admin, user_b):
    assert client.get("/api/auth/me", headers=admin["headers"]).json()["is_admin"] is True
    assert client.get("/api/auth/me", headers=user_b["headers"]).json()["is_admin"] is False


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/admin/invites"),
        ("post", "/api/admin/invites"),
        ("post", f"/api/admin/invites/{uuid.uuid4()}/revoke"),
    ],
)
def test_a_non_admin_is_told_nothing_exists(client, user_b, method, path):
    kwargs = {"json": {}} if method == "post" else {}
    response = getattr(client, method)(path, headers=user_b["headers"], **kwargs)
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_signed_out_is_401(client):
    assert client.get("/api/admin/invites").status_code == 401


def test_the_database_refuses_a_non_admin_mint(runtime_connection, user_b):
    """The route's check is a courtesy; `invite_issue` is the lock."""
    conn = runtime_connection(user_b["id"])
    try:
        with pytest.raises(DBAPIError) as caught:
            conn.execute(text("SELECT invite_issue('h', null, 7)"))
        assert caught.value.orig.sqlstate == "42501"
    finally:
        conn.close()


def test_the_database_refuses_a_mint_with_no_tenant(runtime_connection):
    conn = runtime_connection(None)
    try:
        with pytest.raises(DBAPIError):
            conn.execute(text("SELECT invite_issue('h', null, 7)"))
    finally:
        conn.close()


def test_the_runtime_role_still_cannot_insert_an_invite(runtime_connection, admin):
    conn = runtime_connection(admin["id"])
    try:
        with pytest.raises(DBAPIError):
            conn.execute(
                text("INSERT INTO invites (code_hash, expires_at) VALUES ('h', now())")
            )
    finally:
        conn.close()


def test_the_runtime_role_cannot_make_itself_an_admin(runtime_connection, user_b):
    conn = runtime_connection(user_b["id"])
    try:
        with pytest.raises(DBAPIError):
            conn.execute(text("UPDATE users SET is_admin = true"))
    finally:
        conn.close()


# --- issuing ------------------------------------------------------------------------------


def test_an_admin_issues_a_code_that_registers_once(client, admin, invite_only):
    response = create(client, admin, note="  sam  ", days=7)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["note"] == "sam"
    assert len(body["code"]) >= 26

    body_reg = {"email": "sam@example.com", "password": "correct-horse-battery"}
    first = client.post("/api/auth/register", json={**body_reg, "invite_code": body["code"]})
    assert first.status_code == 201, first.text
    second = client.post(
        "/api/auth/register",
        json={**body_reg, "email": "other@example.com", "invite_code": body["code"]},
    )
    assert second.status_code == 403


def test_only_the_hash_is_stored_and_the_issuer_recorded(client, admin, owner_engine):
    code = create(client, admin).json()["code"]
    with owner_engine.connect() as conn:
        row = conn.execute(text("SELECT code_hash, created_by FROM invites")).one()
    assert code not in row.code_hash
    assert row.created_by == admin["id"]


@pytest.mark.parametrize("days", [0, 91, -1, "14", 14.5])
def test_days_out_of_range_or_not_an_integer_is_422(client, admin, days):
    assert create(client, admin, days=days).status_code == 422


def test_a_blank_note_is_no_note(client, admin):
    assert create(client, admin, note="   ").json()["note"] is None


# --- the list and revoking ----------------------------------------------------------------


def test_the_list_shows_state_and_never_a_code_or_hash(client, admin, invite_only):
    open_one = create(client, admin, note="open").json()
    used_one = create(client, admin, note="used").json()
    client.post(
        "/api/auth/register",
        json={
            "email": "u@example.com",
            "password": "correct-horse-battery",
            "invite_code": used_one["code"],
        },
    )
    items = client.get("/api/admin/invites", headers=admin["headers"]).json()["items"]
    states = {i["note"]: i["state"] for i in items}
    assert states == {"open": "open", "used": "used"}
    for item in items:
        assert "code" not in item and "code_hash" not in item
    assert open_one["code"] not in str(items)


def test_revoking_ends_an_open_invite(client, admin, invite_only):
    issued = create(client, admin).json()
    path = f"/api/admin/invites/{issued['id']}/revoke"
    assert client.post(path, headers=admin["headers"]).status_code == 204
    # Nothing open left by that id.
    assert client.post(path, headers=admin["headers"]).status_code == 404

    items = client.get("/api/admin/invites", headers=admin["headers"]).json()["items"]
    assert items[0]["state"] == "expired"
    refused = client.post(
        "/api/auth/register",
        json={
            "email": "late@example.com",
            "password": "correct-horse-battery",
            "invite_code": issued["code"],
        },
    )
    assert refused.status_code == 403


def test_revoking_a_used_invite_is_404(client, admin, invite_only):
    issued = create(client, admin).json()
    client.post(
        "/api/auth/register",
        json={
            "email": "u@example.com",
            "password": "correct-horse-battery",
            "invite_code": issued["code"],
        },
    )
    path = f"/api/admin/invites/{issued['id']}/revoke"
    assert client.post(path, headers=admin["headers"]).status_code == 404
