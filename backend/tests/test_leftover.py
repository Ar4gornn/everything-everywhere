"""Epic 35, Story 35.4 (AD-51) — what a closed month left over.

The last closed budget month's `income − expenses − net savings`, proposed on the dashboard
as a deposit. Nothing is recorded by reading it; a deposit dated in that month answers it by
arithmetic, and "not this time" is the one thing stored.
"""

import datetime as dt

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.months import add_months, format_month, month_of, month_range, parse_month


def _closed(start_day=1):
    """The label and first/last day of the last closed budget month, from today."""
    current = month_of(dt.date.today(), start_day)
    label = format_month(add_months(parse_month(current), -1))
    start, end = month_range(label, start_day)
    return label, start, end - dt.timedelta(days=1)


def _pot(client, user, name="vacation"):
    items = client.get("/api/savings/types", headers=user["headers"]).json()["items"]
    return next(t for t in items if t["name"] == name)["id"]


def _entry(client, user, kind, amount, on, pot=None):
    body = {
        "kind": kind,
        "amount": amount,
        "occurred_on": on.isoformat(),
        "category_name": "Salary" if kind == "income" else "Travel",
    }
    if pot is not None:
        body["savings_type_id"] = pot
    response = client.post("/api/entries", json=body, headers=user["headers"])
    assert response.status_code == 201, response.text
    return response.json()


def _move(client, user, pot, amount, on, kind="deposit"):
    response = client.post(
        "/api/savings/contributions",
        json={
            "savings_type_id": pot,
            "kind": kind,
            "amount": amount,
            "occurred_on": on.isoformat(),
        },
        headers=user["headers"],
    )
    assert response.status_code == 201, response.text
    return response.json()


def _leftover(client, user):
    response = client.get("/api/dashboard/leftover", headers=user["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def _dismiss(client, user, month):
    return client.put(f"/api/dashboard/leftover/{month}/dismissed", headers=user["headers"])


# -------------------------------------------------------------------- the figure


def test_an_empty_account_left_nothing(client, user_a):
    label, start, end = _closed()

    body = _leftover(client, user_a)

    assert body == {
        "month": label,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "income": "0.00",
        "expense": "0.00",
        "saved": "0.00",
        "leftover": "0.00",
        "dismissed": False,
    }


def test_income_less_expenses_less_net_savings(client, user_a):
    _, start, end = _closed()
    pot = _pot(client, user_a)
    _entry(client, user_a, "income", "2000.00", start)
    _entry(client, user_a, "expense", "1200.00", end)
    _move(client, user_a, pot, "300.00", start)
    _move(client, user_a, pot, "50.00", end, kind="withdrawal")

    body = _leftover(client, user_a)

    assert (body["income"], body["expense"], body["saved"]) == ("2000.00", "1200.00", "250.00")
    assert body["leftover"] == "550.00"


def test_it_agrees_with_the_summary_of_that_month(client, user_a):
    label, start, end = _closed()
    pot = _pot(client, user_a)
    _entry(client, user_a, "income", "900.00", start)
    _entry(client, user_a, "expense", "123.45", end)
    _move(client, user_a, pot, "100.00", end)

    summary = client.get(
        "/api/dashboard/summary", params={"month": label}, headers=user_a["headers"]
    ).json()
    body = _leftover(client, user_a)

    assert (body["income"], body["expense"], body["saved"]) == (
        summary["income"],
        summary["expense"],
        summary["saved"],
    )


def test_a_pot_funded_expense_cancels_out(client, user_a):
    _, start, end = _closed()
    pot = _pot(client, user_a)
    _entry(client, user_a, "income", "1000.00", start)
    _move(client, user_a, pot, "500.00", start)
    before = _leftover(client, user_a)["leftover"]

    _entry(client, user_a, "expense", "200.00", end, pot=pot)

    body = _leftover(client, user_a)
    assert body["expense"] == "200.00"
    assert body["saved"] == "300.00"
    assert body["leftover"] == before == "500.00"


def test_only_the_closed_month_counts(client, user_a):
    _, start, end = _closed()
    today = dt.date.today()
    _entry(client, user_a, "income", "100.00", start)
    _entry(client, user_a, "income", "999.00", start - dt.timedelta(days=1))
    _entry(client, user_a, "income", "888.00", end + dt.timedelta(days=1))
    _entry(client, user_a, "expense", "777.00", today)

    assert _leftover(client, user_a)["leftover"] == "100.00"


def test_an_overspent_month_is_negative(client, user_a):
    _, start, _ = _closed()
    _entry(client, user_a, "income", "100.00", start)
    _entry(client, user_a, "expense", "250.00", start)

    assert _leftover(client, user_a)["leftover"] == "-150.00"


def test_the_budget_month_follows_the_start_day(client, user_a):
    response = client.patch(
        "/api/auth/me/budget-start-day",
        json={"budget_start_day": 15},
        headers=user_a["headers"],
    )
    assert response.status_code == 200, response.text
    label, start, end = _closed(15)
    _entry(client, user_a, "income", "40.00", start)
    _entry(client, user_a, "income", "2.00", end)
    _entry(client, user_a, "income", "500.00", start - dt.timedelta(days=1))

    body = _leftover(client, user_a)

    assert body["month"] == label
    assert (body["start"], body["end"]) == (start.isoformat(), end.isoformat())
    assert body["leftover"] == "42.00"


def test_reading_it_records_nothing(client, user_a, owner_engine):
    _, start, _ = _closed()
    _entry(client, user_a, "income", "100.00", start)

    _leftover(client, user_a)
    _leftover(client, user_a)

    with owner_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM savings_contributions")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM leftover_dismissals")).scalar_one() == 0


# -------------------------------------------------------------------- answering it


def test_a_deposit_on_the_last_day_takes_it_to_zero(client, user_a):
    _, start, end = _closed()
    pot = _pot(client, user_a)
    _entry(client, user_a, "income", "300.00", start)
    left = _leftover(client, user_a)

    _move(client, user_a, pot, left["leftover"], dt.date.fromisoformat(left["end"]))

    assert _leftover(client, user_a)["leftover"] == "0.00"


def test_a_partial_deposit_leaves_the_rest(client, user_a):
    _, start, end = _closed()
    pot = _pot(client, user_a)
    _entry(client, user_a, "income", "300.00", start)

    _move(client, user_a, pot, "120.00", end)

    assert _leftover(client, user_a)["leftover"] == "180.00"


def test_dismissing_is_remembered_by_label_and_is_idempotent(client, user_a):
    label, start, _ = _closed()
    _entry(client, user_a, "income", "300.00", start)

    assert _dismiss(client, user_a, label).status_code == 204
    assert _dismiss(client, user_a, label).status_code == 204

    body = _leftover(client, user_a)
    assert body["dismissed"] is True
    # Dismissed, not zeroed: the figure is still what the month left over.
    assert body["leftover"] == "300.00"


def test_dismissing_another_month_leaves_this_one(client, user_a):
    label, _, _ = _closed()
    other = format_month(add_months(parse_month(label), -1))

    assert _dismiss(client, user_a, other).status_code == 204

    assert _leftover(client, user_a)["dismissed"] is False


@pytest.mark.parametrize("month", ["2026-13", "2026-9", "september", "2026-09-01"])
def test_a_malformed_month_is_refused(client, user_a, month):
    assert _dismiss(client, user_a, month).status_code == 422


def test_the_schema_refuses_a_malformed_month(client, user_a, owner_engine):
    with owner_engine.connect() as conn, pytest.raises(IntegrityError) as error:
        conn.execute(
            text("INSERT INTO leftover_dismissals (user_id, month) VALUES (:uid, '2026-9')"),
            {"uid": user_a["id"]},
        )
    assert "leftover_dismissals_month_shape" in str(error.value)


def test_it_needs_a_session(client):
    assert client.get("/api/dashboard/leftover").status_code == 401
    assert client.put("/api/dashboard/leftover/2026-08/dismissed").status_code == 401


# -------------------------------------------------------------------- second user (AD-24)


def test_b_neither_sees_nor_moves_a_leftover_or_dismissal(
    client, user_a, user_b, runtime_connection
):
    label, start, _ = _closed()
    _entry(client, user_a, "income", "300.00", start)
    _dismiss(client, user_a, label)

    body = _leftover(client, user_b)
    assert body["leftover"] == "0.00"
    assert body["dismissed"] is False

    conn = runtime_connection(user_b["id"])
    try:
        assert conn.execute(text("SELECT count(*) FROM leftover_dismissals")).scalar_one() == 0
        with pytest.raises(Exception, match="row-level security"):
            conn.execute(
                text("INSERT INTO leftover_dismissals (user_id, month) VALUES (:uid, :m)"),
                {"uid": user_a["id"], "m": format_month(add_months(parse_month(label), -1))},
            )
    finally:
        conn.close()

    assert _leftover(client, user_a)["dismissed"] is True
