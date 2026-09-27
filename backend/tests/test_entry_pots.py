"""Epic 35, Story 35.2 (AD-51) — an expense paid from a pot.

The expense counts as spending and its withdrawal lowers the pot; the two are one write,
and the withdrawal belongs to the entry: it moves with it, goes with it, and is refused
any edit of its own.
"""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError


def _type(client, user, name="vacation"):
    items = client.get("/api/savings/types", headers=user["headers"]).json()["items"]
    return next(t for t in items if t["name"] == name)


def _deposit(client, user, type_id, amount, on="2026-09-01"):
    response = client.post(
        "/api/savings/contributions",
        json={"savings_type_id": type_id, "amount": amount, "occurred_on": on},
        headers=user["headers"],
    )
    assert response.status_code == 201, response.text
    return response.json()


def _expense(client, user, amount, pot=None, on="2026-09-10", kind="expense"):
    body = {"kind": kind, "amount": amount, "occurred_on": on, "category_name": "Travel"}
    if pot is not None:
        body["savings_type_id"] = pot
    return client.post("/api/entries", json=body, headers=user["headers"])


def _balance(client, user, type_id):
    overview = client.get(
        "/api/savings/overview", params={"month": "2026-09"}, headers=user["headers"]
    ).json()
    return next(p for p in overview["pots"] if p["savings_type_id"] == type_id)["balance"]


def _withdrawals(client, user):
    items = client.get("/api/savings/contributions", headers=user["headers"]).json()["items"]
    return [c for c in items if c["kind"] == "withdrawal"]


def _entries(client, user):
    return client.get("/api/entries", headers=user["headers"]).json()["items"]


# ------------------------------------------------------------------- creating


def test_an_expense_paid_from_a_pot_writes_its_withdrawal(client, user_a):
    pot = _type(client, user_a)
    _deposit(client, user_a, pot["id"], "100.00")

    created = _expense(client, user_a, "30.00", pot=pot["id"])

    assert created.status_code == 201, created.text
    entry = created.json()
    assert entry["savings_type_id"] == pot["id"]
    [withdrawal] = _withdrawals(client, user_a)
    assert withdrawal["entry_id"] == entry["id"]
    assert withdrawal["amount"] == "30.00"
    assert withdrawal["occurred_on"] == "2026-09-10"
    assert _balance(client, user_a, pot["id"]) == "70.00"
    # It is still spending: the list carries it, and so does the dashboard's month.
    assert [e["id"] for e in _entries(client, user_a)] == [entry["id"]]
    summary = client.get(
        "/api/dashboard/summary", params={"month": "2026-09"}, headers=user_a["headers"]
    ).json()
    assert summary["expense"] == "30.00"


def test_an_expense_without_a_pot_is_unchanged(client, user_a):
    created = _expense(client, user_a, "30.00")
    assert created.status_code == 201
    assert created.json()["savings_type_id"] is None
    assert _withdrawals(client, user_a) == []


def test_a_pot_that_cannot_cover_it_refuses_the_whole_write(client, user_a):
    pot = _type(client, user_a)
    _deposit(client, user_a, pot["id"], "20.00")

    refused = _expense(client, user_a, "20.01", pot=pot["id"])

    assert refused.status_code == 409
    assert refused.json()["code"] == "savings_balance_negative"
    assert _entries(client, user_a) == []
    assert _withdrawals(client, user_a) == []
    assert _balance(client, user_a, pot["id"]) == "20.00"


def test_income_cannot_be_paid_from_a_pot(client, user_a):
    pot = _type(client, user_a)
    _deposit(client, user_a, pot["id"], "100.00")
    assert _expense(client, user_a, "5.00", pot=pot["id"], kind="income").status_code == 422
    assert _entries(client, user_a) == []


def test_another_accounts_pot_is_a_404_and_nothing_is_written(client, user_a, user_b):
    pot_a = _type(client, user_a)
    _deposit(client, user_a, pot_a["id"], "100.00")

    refused = _expense(client, user_b, "5.00", pot=pot_a["id"])

    assert refused.status_code == 404
    assert _entries(client, user_b) == []
    assert _balance(client, user_a, pot_a["id"]) == "100.00"


# -------------------------------------------------------------------- editing


def _patch(client, user, entry_id, body):
    return client.patch(f"/api/entries/{entry_id}", json=body, headers=user["headers"])


def test_the_withdrawal_follows_the_entrys_amount_and_date(client, user_a):
    pot = _type(client, user_a)
    _deposit(client, user_a, pot["id"], "100.00")
    entry = _expense(client, user_a, "30.00", pot=pot["id"]).json()

    edited = _patch(client, user_a, entry["id"], {"amount": "45.50", "occurred_on": "2026-09-12"})

    assert edited.status_code == 200, edited.text
    assert edited.json()["savings_type_id"] == pot["id"]
    [withdrawal] = _withdrawals(client, user_a)
    assert (withdrawal["amount"], withdrawal["occurred_on"]) == ("45.50", "2026-09-12")
    assert _balance(client, user_a, pot["id"]) == "54.50"


def test_an_edit_the_pot_cannot_cover_is_refused_and_nothing_changes(client, user_a):
    pot = _type(client, user_a)
    _deposit(client, user_a, pot["id"], "50.00")
    entry = _expense(client, user_a, "30.00", pot=pot["id"]).json()

    refused = _patch(client, user_a, entry["id"], {"amount": "50.01"})

    assert refused.status_code == 409
    assert refused.json()["code"] == "savings_balance_negative"
    assert _entries(client, user_a)[0]["amount"] == "30.00"
    assert _balance(client, user_a, pot["id"]) == "20.00"


def test_an_edit_that_leaves_the_pot_alone_keeps_the_link(client, user_a):
    pot = _type(client, user_a)
    _deposit(client, user_a, pot["id"], "100.00")
    entry = _expense(client, user_a, "30.00", pot=pot["id"]).json()

    edited = _patch(client, user_a, entry["id"], {"note": "train"})

    assert edited.json()["savings_type_id"] == pot["id"]
    assert len(_withdrawals(client, user_a)) == 1
    assert _balance(client, user_a, pot["id"]) == "70.00"


def test_moving_the_expense_to_another_pot_moves_its_withdrawal(client, user_a):
    first, second = _type(client, user_a), _type(client, user_a, "startup")
    _deposit(client, user_a, first["id"], "100.00")
    _deposit(client, user_a, second["id"], "100.00")
    entry = _expense(client, user_a, "30.00", pot=first["id"]).json()

    moved = _patch(client, user_a, entry["id"], {"savings_type_id": second["id"]})

    assert moved.status_code == 200
    assert moved.json()["savings_type_id"] == second["id"]
    assert _balance(client, user_a, first["id"]) == "100.00"
    assert _balance(client, user_a, second["id"]) == "70.00"
    assert len(_withdrawals(client, user_a)) == 1


def test_moving_to_a_pot_that_cannot_cover_it_is_refused(client, user_a):
    first, second = _type(client, user_a), _type(client, user_a, "startup")
    _deposit(client, user_a, first["id"], "100.00")
    _deposit(client, user_a, second["id"], "10.00")
    entry = _expense(client, user_a, "30.00", pot=first["id"]).json()

    refused = _patch(client, user_a, entry["id"], {"savings_type_id": second["id"]})

    assert refused.status_code == 409
    assert _entries(client, user_a)[0]["savings_type_id"] == first["id"]
    assert _balance(client, user_a, first["id"]) == "70.00"
    assert _balance(client, user_a, second["id"]) == "10.00"


def test_an_explicit_null_stops_paying_from_the_pot(client, user_a):
    pot = _type(client, user_a)
    _deposit(client, user_a, pot["id"], "100.00")
    entry = _expense(client, user_a, "30.00", pot=pot["id"]).json()

    cleared = _patch(client, user_a, entry["id"], {"savings_type_id": None})

    assert cleared.status_code == 200
    assert cleared.json()["savings_type_id"] is None
    assert cleared.json()["amount"] == "30.00"  # still spending
    assert _withdrawals(client, user_a) == []
    assert _balance(client, user_a, pot["id"]) == "100.00"


def test_an_existing_expense_can_be_paid_from_a_pot_afterwards(client, user_a):
    pot = _type(client, user_a)
    _deposit(client, user_a, pot["id"], "100.00")
    entry = _expense(client, user_a, "30.00").json()

    linked = _patch(client, user_a, entry["id"], {"savings_type_id": pot["id"]})

    assert linked.status_code == 200
    assert linked.json()["savings_type_id"] == pot["id"]
    assert _balance(client, user_a, pot["id"]) == "70.00"


def test_an_income_cannot_be_linked_to_a_pot_afterwards(client, user_a):
    pot = _type(client, user_a)
    _deposit(client, user_a, pot["id"], "100.00")
    income = _expense(client, user_a, "30.00", kind="income").json()

    refused = _patch(client, user_a, income["id"], {"savings_type_id": pot["id"]})

    assert refused.status_code == 422
    assert refused.json()["code"] == "savings_expense_only"
    assert _withdrawals(client, user_a) == []


def test_another_accounts_pot_cannot_be_linked_afterwards(client, user_a, user_b):
    pot_a = _type(client, user_a)
    _deposit(client, user_a, pot_a["id"], "100.00")
    entry = _expense(client, user_b, "5.00").json()

    refused = _patch(client, user_b, entry["id"], {"savings_type_id": pot_a["id"]})

    assert refused.status_code == 404
    assert _balance(client, user_a, pot_a["id"]) == "100.00"


# ------------------------------------------------------------------- deleting


def test_deleting_the_expense_takes_its_withdrawal_with_it(client, user_a):
    pot = _type(client, user_a)
    _deposit(client, user_a, pot["id"], "100.00")
    entry = _expense(client, user_a, "30.00", pot=pot["id"]).json()

    deleted = client.delete(f"/api/entries/{entry['id']}", headers=user_a["headers"])

    assert deleted.status_code == 204
    assert _withdrawals(client, user_a) == []
    assert _balance(client, user_a, pot["id"]) == "100.00"


def test_the_withdrawal_cannot_be_edited_or_deleted_on_its_own(client, user_a):
    pot = _type(client, user_a)
    _deposit(client, user_a, pot["id"], "100.00")
    _expense(client, user_a, "30.00", pot=pot["id"])
    [withdrawal] = _withdrawals(client, user_a)
    url = f"/api/savings/contributions/{withdrawal['id']}"

    patched = client.patch(url, json={"amount": "1.00"}, headers=user_a["headers"])
    deleted = client.delete(url, headers=user_a["headers"])

    for refused in (patched, deleted):
        assert refused.status_code == 409
        assert refused.json()["code"] == "savings_contribution_from_entry"
    assert _withdrawals(client, user_a) == [withdrawal]


def test_a_pot_that_paid_for_an_expense_cannot_be_deleted(client, user_a):
    pot = _type(client, user_a)
    _deposit(client, user_a, pot["id"], "100.00")
    _expense(client, user_a, "30.00", pot=pot["id"])

    refused = client.delete(f"/api/savings/types/{pot['id']}", headers=user_a["headers"])

    assert refused.status_code == 409
    assert refused.json()["code"] == "savings_type_in_use"


def test_the_contribution_endpoint_cannot_link_an_entry(client, user_a):
    pot = _type(client, user_a)
    _deposit(client, user_a, pot["id"], "100.00")
    entry = _expense(client, user_a, "30.00").json()
    client.post(
        "/api/savings/contributions",
        json={
            "savings_type_id": pot["id"],
            "kind": "withdrawal",
            "amount": "1.00",
            "occurred_on": "2026-09-10",
            "entry_id": entry["id"],
        },
        headers=user_a["headers"],
    )
    assert all(c["entry_id"] is None for c in _withdrawals(client, user_a))


# ------------------------------------------------------------------- database


def _insert(conn, user_id, type_id, entry_id, kind="withdrawal"):
    conn.execute(
        text(
            "INSERT INTO savings_contributions "
            "(user_id, savings_type_id, kind, amount, occurred_on, entry_id) "
            "VALUES (:uid, :sid, :kind, 1, DATE '2026-09-01', :eid)"
        ),
        {"uid": str(user_id), "sid": type_id, "kind": kind, "eid": entry_id},
    )


def test_a_withdrawal_cannot_reference_another_accounts_entry(
    client, user_a, user_b, runtime_connection
):
    entry_a = _expense(client, user_a, "30.00").json()
    pot_b = _type(client, user_b)
    conn = runtime_connection(user_b["id"])
    try:
        with pytest.raises(IntegrityError) as error:
            _insert(conn, user_b["id"], pot_b["id"], entry_a["id"])
        assert "savings_contributions_entry_fkey" in str(error.value)
    finally:
        conn.close()


def test_the_database_refuses_a_deposit_that_paid_for_an_entry(
    client, user_a, runtime_connection
):
    entry = _expense(client, user_a, "30.00").json()
    pot = _type(client, user_a)
    conn = runtime_connection(user_a["id"])
    try:
        with pytest.raises(IntegrityError) as error:
            _insert(conn, user_a["id"], pot["id"], entry["id"], kind="deposit")
        assert "savings_contributions_entry_is_withdrawal" in str(error.value)
    finally:
        conn.close()


def test_the_database_refuses_two_withdrawals_for_one_entry(client, user_a, runtime_connection):
    pot = _type(client, user_a)
    _deposit(client, user_a, pot["id"], "100.00")
    entry = _expense(client, user_a, "30.00", pot=pot["id"]).json()
    conn = runtime_connection(user_a["id"])
    try:
        with pytest.raises(IntegrityError) as error:
            _insert(conn, user_a["id"], pot["id"], entry["id"])
        assert "savings_contributions_entry_id_key" in str(error.value)
    finally:
        conn.close()
