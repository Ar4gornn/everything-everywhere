"""Epic 35, Story 35.3 (AD-51) — a category's default pot.

An expense category can name the pot its expenses are usually paid from. The server only
stores it: the entry form pre-fills from it, and no entry is written, moved or rewritten
because it changed.
"""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError


def _type(client, user, name="vacation"):
    items = client.get("/api/savings/types", headers=user["headers"]).json()["items"]
    return next(t for t in items if t["name"] == name)


def _category(client, user, name="Travel", kind="expense"):
    response = client.post(
        "/api/categories", json={"name": name, "kind": kind}, headers=user["headers"]
    )
    assert response.status_code == 201, response.text
    return response.json()


def _patch(client, user, category_id, body):
    return client.patch(f"/api/categories/{category_id}", json=body, headers=user["headers"])


def _listed(client, user, category_id):
    items = client.get("/api/categories", headers=user["headers"]).json()["items"]
    return next(c for c in items if c["id"] == category_id)


# -------------------------------------------------------------------- setting


def test_a_new_category_has_no_default_pot(client, user_a):
    assert _category(client, user_a)["default_savings_type_id"] is None


def test_an_expense_category_can_name_a_pot(client, user_a):
    category = _category(client, user_a)
    pot = _type(client, user_a)

    response = _patch(client, user_a, category["id"], {"default_savings_type_id": pot["id"]})

    assert response.status_code == 200, response.text
    assert response.json()["default_savings_type_id"] == pot["id"]
    assert _listed(client, user_a, category["id"])["default_savings_type_id"] == pot["id"]


def test_null_clears_the_default_pot(client, user_a):
    category = _category(client, user_a)
    pot = _type(client, user_a)
    _patch(client, user_a, category["id"], {"default_savings_type_id": pot["id"]})

    response = _patch(client, user_a, category["id"], {"default_savings_type_id": None})

    assert response.status_code == 200
    assert _listed(client, user_a, category["id"])["default_savings_type_id"] is None


def test_the_key_is_required_and_nothing_else_is_accepted(client, user_a):
    category = _category(client, user_a)

    assert _patch(client, user_a, category["id"], {}).status_code == 422
    assert _patch(client, user_a, category["id"], {"name": "Trips"}).status_code == 422
    assert (
        _patch(client, user_a, category["id"], {"default_savings_type_id": "nope"}).status_code
        == 422
    )


def test_an_income_category_cannot_name_a_pot(client, user_a):
    category = _category(client, user_a, "Salary", kind="income")
    pot = _type(client, user_a)

    response = _patch(client, user_a, category["id"], {"default_savings_type_id": pot["id"]})

    assert response.status_code == 422
    assert response.json()["code"] == "savings_expense_only"
    assert _listed(client, user_a, category["id"])["default_savings_type_id"] is None


def test_clearing_an_income_category_is_harmless(client, user_a):
    category = _category(client, user_a, "Salary", kind="income")

    response = _patch(client, user_a, category["id"], {"default_savings_type_id": None})

    assert response.status_code == 200


def test_an_unknown_category_is_a_404(client, user_a):
    missing = "00000000-0000-0000-0000-000000000000"
    response = _patch(client, user_a, missing, {"default_savings_type_id": None})
    assert response.status_code == 404


# ------------------------------------------------------------------- isolation


def test_another_accounts_pot_is_a_404(client, user_a, user_b):
    pot_a = _type(client, user_a)
    category_b = _category(client, user_b)

    response = _patch(client, user_b, category_b["id"], {"default_savings_type_id": pot_a["id"]})

    assert response.status_code == 404
    assert _listed(client, user_b, category_b["id"])["default_savings_type_id"] is None


def test_another_accounts_category_is_a_404(client, user_a, user_b):
    category_a = _category(client, user_a)
    pot_b = _type(client, user_b)

    response = _patch(client, user_b, category_a["id"], {"default_savings_type_id": pot_b["id"]})

    assert response.status_code == 404
    assert _listed(client, user_a, category_a["id"])["default_savings_type_id"] is None


def _set_directly(conn, category_id, pot_id):
    conn.execute(
        text("UPDATE categories SET default_savings_type_id = :pot WHERE id = :id"),
        {"pot": str(pot_id), "id": str(category_id)},
    )


def test_the_database_refuses_another_accounts_pot(
    client, user_a, user_b, runtime_connection
):
    """Lab note: FK checks bypass RLS, so only a composite key stops this."""
    pot_a = _type(client, user_a)
    category_b = _category(client, user_b)
    conn = runtime_connection(user_b["id"])
    try:
        with pytest.raises(IntegrityError) as error:
            _set_directly(conn, category_b["id"], pot_a["id"])
        assert "categories_default_pot_fkey" in str(error.value)
    finally:
        conn.close()


def test_the_database_refuses_a_pot_on_income(client, user_a, runtime_connection):
    category = _category(client, user_a, "Salary", kind="income")
    pot = _type(client, user_a)
    conn = runtime_connection(user_a["id"])
    try:
        with pytest.raises(IntegrityError) as error:
            _set_directly(conn, category["id"], pot["id"])
        assert "categories_default_pot_expense_only" in str(error.value)
    finally:
        conn.close()


# --------------------------------------------------------------------- effects


def test_deleting_the_pot_forgets_the_default_and_keeps_the_category(client, user_a):
    category = _category(client, user_a)
    pot = _type(client, user_a)
    _patch(client, user_a, category["id"], {"default_savings_type_id": pot["id"]})

    deleted = client.delete(f"/api/savings/types/{pot['id']}", headers=user_a["headers"])

    assert deleted.status_code == 204, deleted.text
    assert _listed(client, user_a, category["id"])["default_savings_type_id"] is None


def test_a_default_pot_does_not_pay_for_an_entry_on_its_own(client, user_a):
    """It pre-fills the form. An entry sent without a pot is paid from nothing."""
    category = _category(client, user_a)
    pot = _type(client, user_a)
    _patch(client, user_a, category["id"], {"default_savings_type_id": pot["id"]})

    created = client.post(
        "/api/entries",
        json={
            "kind": "expense",
            "amount": "10.00",
            "occurred_on": "2026-09-10",
            "category_id": category["id"],
        },
        headers=user_a["headers"],
    )

    assert created.status_code == 201, created.text
    assert created.json()["savings_type_id"] is None


def test_setting_a_default_rewrites_no_existing_entry(client, user_a):
    category = _category(client, user_a)
    pot = _type(client, user_a)
    client.post(
        "/api/savings/contributions",
        json={"savings_type_id": pot["id"], "amount": "100.00", "occurred_on": "2026-09-01"},
        headers=user_a["headers"],
    )
    entry = client.post(
        "/api/entries",
        json={
            "kind": "expense",
            "amount": "10.00",
            "occurred_on": "2026-09-10",
            "category_id": category["id"],
        },
        headers=user_a["headers"],
    ).json()

    _patch(client, user_a, category["id"], {"default_savings_type_id": pot["id"]})
    _patch(client, user_a, category["id"], {"default_savings_type_id": None})

    entries = client.get("/api/entries", headers=user_a["headers"]).json()["items"]
    assert next(e for e in entries if e["id"] == entry["id"])["savings_type_id"] is None
    withdrawals = [
        c
        for c in client.get("/api/savings/contributions", headers=user_a["headers"]).json()[
            "items"
        ]
        if c["kind"] == "withdrawal"
    ]
    assert withdrawals == []
