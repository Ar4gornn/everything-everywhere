"""Epic 44 — the second-user proof for ``GET /api/entries/quick-picks``.

User A has categories, a repeat combo and a vendor; user B must see none of it, through the
API and through the service run on B's own runtime connection (so RLS alone, plus the
explicit ``user_id`` filter, is what is under test).
"""

import datetime as dt

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.clock import get_now
from app.models.ledger import EntryKind
from app.services import quick_picks as service

NOW = dt.datetime(2031, 6, 15, 12, 0, tzinfo=dt.UTC)
TODAY = dt.date(2031, 6, 15)


@pytest.fixture(autouse=True)
def clock(client):
    from app.main import app

    app.dependency_overrides[get_now] = lambda: NOW
    yield
    app.dependency_overrides.pop(get_now, None)


def _seed_a(client, user):
    headers = user["headers"]
    for kind, name in (("expense", "A-Food"), ("income", "A-Pay")):
        client.post("/api/categories", json={"name": name, "kind": kind}, headers=headers)
    for kind, cat in (("expense", "A-Food"), ("income", "A-Pay")):
        response = client.post(
            "/api/entries",
            json={
                "kind": kind,
                "amount": "12.00",
                "occurred_on": "2031-06-10",
                "category_name": cat,
                "vendor_name": "A-Shop" if kind == "expense" else None,
            },
            headers=headers,
        )
        assert response.status_code == 201, response.text


def test_b_sees_nothing_of_a_through_the_api(client, user_a, user_b):
    _seed_a(client, user_a)
    own = client.get("/api/entries/quick-picks", headers=user_a["headers"]).json()
    assert own["expense"]["categories"] and own["expense"]["combos"]
    assert own["income"]["categories"] and own["vendors"]

    body = client.get("/api/entries/quick-picks", headers=user_b["headers"]).json()
    assert body == {
        "expense": {"categories": [], "combos": []},
        "income": {"categories": [], "combos": []},
        "vendors": [],
    }


def test_b_padding_does_not_borrow_a_categories(client, user_a, user_b):
    _seed_a(client, user_a)
    client.post(
        "/api/categories", json={"name": "B-Own", "kind": "expense"}, headers=user_b["headers"]
    )
    body = client.get("/api/entries/quick-picks", headers=user_b["headers"]).json()
    assert [c["name"] for c in body["expense"]["categories"]] == ["B-Own"]


def test_service_on_bs_runtime_connection_returns_nothing_of_a(
    client, user_a, user_b, runtime_connection
):
    _seed_a(client, user_a)
    conn = runtime_connection(user_b["id"])
    try:
        session = Session(bind=conn)
        out = service.quick_picks(session, user_b["id"], TODAY)
        assert out.expense.categories == [] and out.expense.combos == []
        assert out.income.categories == [] and out.income.combos == []
        assert out.vendors == []
    finally:
        conn.close()


def test_explicit_user_filter_holds_without_rls(client, user_a, user_b, owner_engine):
    """On the owner connection RLS does not apply, so only the explicit ``user_id`` filter
    stands between B's request and A's rows (AD-1 defence in depth)."""
    _seed_a(client, user_a)
    with Session(owner_engine) as session:
        assert service.category_picks(session, user_b["id"], EntryKind.expense, TODAY) == []
        assert service.combo_picks(session, user_b["id"], EntryKind.expense, TODAY) == []
        assert service.vendor_picks(session, user_b["id"]) == []
        assert [c.name for c in service.category_picks(
            session, user_a["id"], EntryKind.expense, TODAY
        )] == ["A-Food"]
    with owner_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM entries")).scalar_one() == 2
