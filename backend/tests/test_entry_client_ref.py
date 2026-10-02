"""Epic 45 (AD-61) — ``POST /api/entries`` is idempotent on the ref the phone coined.

Absent ref: today's behaviour. Fresh ref: 201. A ref this account already used: 200 with the row
already written, nothing new. The key is ``(user_id, client_ref)``, so another account's ref is
invisible and never clashes.
"""

import datetime as dt
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.services import ledger

REF = "5b0b8e62-3c1e-4a4f-9d77-0f3c2f9a1e01"


def _post(client, user, **overrides):
    body = {
        "kind": "expense",
        "amount": "4.20",
        "occurred_on": "2026-09-10",
        "category_name": "Coffee",
    } | overrides
    return client.post("/api/entries", json=body, headers=user["headers"])


def _rows(owner_engine, user_id=None):
    sql = "SELECT id, user_id, client_ref, amount FROM entries"
    params = {}
    if user_id is not None:
        sql += " WHERE user_id = :uid"
        params = {"uid": str(user_id)}
    with owner_engine.connect() as conn:
        return conn.execute(text(sql + " ORDER BY created_at"), params).all()


def _count(owner_engine, table):
    with owner_engine.connect() as conn:
        return conn.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()  # noqa: S608


def _pot(client, user):
    items = client.get("/api/savings/types", headers=user["headers"]).json()["items"]
    return items[0]["id"]


# ------------------------------------------------------------ the three outcomes


def test_no_ref_is_unchanged_two_posts_two_rows(client, user_a, owner_engine):
    first = _post(client, user_a)
    second = _post(client, user_a)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["id"] != second.json()["id"]
    assert len(_rows(owner_engine)) == 2
    assert all(r.client_ref is None for r in _rows(owner_engine))


def test_a_fresh_ref_is_created_and_stored(client, user_a, owner_engine):
    response = _post(client, user_a, client_ref=REF)
    assert response.status_code == 201, response.text
    [row] = _rows(owner_engine)
    assert str(row.id) == response.json()["id"]
    assert str(row.client_ref) == REF


def test_the_same_ref_again_is_a_200_with_the_original_row(client, user_a, owner_engine):
    first = _post(client, user_a, client_ref=REF, amount="4.20")
    again = _post(client, user_a, client_ref=REF, amount="99.00", note="changed")
    assert first.status_code == 201
    assert again.status_code == 200, again.text
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["amount"] == "4.20"
    assert again.json()["note"] is None
    [row] = _rows(owner_engine)
    assert row.amount == Decimal("4.20")


def test_a_replay_carries_the_pot_of_the_original(client, user_a, owner_engine):
    pot = _pot(client, user_a)
    client.post(
        "/api/savings/contributions",
        json={"savings_type_id": pot, "amount": "100.00", "occurred_on": "2026-09-01"},
        headers=user_a["headers"],
    )
    first = _post(client, user_a, client_ref=REF, amount="30.00", savings_type_id=pot)
    again = _post(client, user_a, client_ref=REF, amount="30.00", savings_type_id=pot)
    assert first.status_code == 201 and again.status_code == 200
    assert again.json() == first.json()
    assert first.json()["savings_type_id"] == pot
    assert _count(owner_engine, "savings_contributions") == 2  # the deposit and one withdrawal


def test_a_malformed_resend_is_still_a_422(client, user_a):
    """Schema validation runs before the service, so a malformed body never reaches the ref."""
    first = _post(client, user_a, client_ref=REF)
    again = _post(client, user_a, client_ref=REF, amount="-1")
    assert first.status_code == 201
    assert again.status_code == 422


def test_the_same_ref_on_two_accounts_makes_two_rows(client, user_a, user_b, owner_engine):
    a = _post(client, user_a, client_ref=REF)
    b = _post(client, user_b, client_ref=REF)
    assert a.status_code == 201 and b.status_code == 201
    assert a.json()["id"] != b.json()["id"]
    assert len(_rows(owner_engine)) == 2


# ------------------------------------------------------------ refusals write nothing


def test_a_refused_pot_on_income_writes_nothing_and_the_ref_stays_free(
    client, user_a, owner_engine
):
    pot = _pot(client, user_a)
    refused = _post(
        client, user_a, client_ref=REF, kind="income", category_name="Gift", savings_type_id=pot
    )
    assert refused.status_code == 422, refused.text
    assert _rows(owner_engine) == []
    assert _count(owner_engine, "categories") == 0

    fixed = _post(client, user_a, client_ref=REF, kind="income", category_name="Gift")
    assert fixed.status_code == 201
    [row] = _rows(owner_engine)
    assert str(row.client_ref) == REF


def test_an_overdrawn_pot_writes_nothing_and_the_ref_stays_free(client, user_a, owner_engine):
    pot = _pot(client, user_a)
    refused = _post(
        client, user_a, client_ref=REF, amount="50.00", category_name="Trip", savings_type_id=pot
    )
    assert refused.status_code >= 400 and refused.status_code != 500, refused.text
    # No entry, no withdrawal, and the category the create path made first went with it.
    assert _rows(owner_engine) == []
    assert _count(owner_engine, "savings_contributions") == 0
    assert _count(owner_engine, "categories") == 0

    client.post(
        "/api/savings/contributions",
        json={"savings_type_id": pot, "amount": "100.00", "occurred_on": "2026-09-01"},
        headers=user_a["headers"],
    )
    fixed = _post(
        client, user_a, client_ref=REF, amount="50.00", category_name="Trip", savings_type_id=pot
    )
    assert fixed.status_code == 201, fixed.text


# ------------------------------------------------------------ the race


def _insert_winner(owner_engine, user_id, category_id, ref):
    with owner_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.user_id', :u, true)"), {"u": str(user_id)})
        winner = conn.execute(
            text(
                "INSERT INTO entries (user_id, kind, category_id, amount, occurred_on, client_ref)"
                " VALUES (:u, CAST('expense' AS entry_kind), :c, 7.00, DATE '2026-09-10', :r)"
                " RETURNING id"
            ),
            {"u": str(user_id), "c": category_id, "r": ref},
        ).scalar_one()
    return winner


def test_a_concurrent_duplicate_is_answered_with_the_winning_row(
    client, user_a, owner_engine, monkeypatch
):
    """The replay check misses; another request commits the ref before our insert lands."""
    existing = client.post(
        "/api/categories", json={"name": "Other", "kind": "expense"}, headers=user_a["headers"]
    ).json()
    real = ledger.create_entry
    seen = {}

    def losing(session, user_id, **kwargs):
        if "winner" not in seen:
            seen["winner"] = _insert_winner(owner_engine, user_id, existing["id"], REF)
        return real(session, user_id, **kwargs)

    monkeypatch.setattr(ledger, "create_entry", losing)

    # A new category name, so the create path writes something before the insert fails.
    response = _post(client, user_a, client_ref=REF, amount="4.20", category_name="Brand new")
    assert response.status_code == 200, response.text
    assert response.json()["id"] == str(seen["winner"])
    assert response.json()["amount"] == "7.00"
    assert len(_rows(owner_engine)) == 1
    # The savepoint took the loser's half-written category with it.
    with owner_engine.connect() as conn:
        names = conn.execute(text("SELECT name FROM categories")).scalars().all()
    assert names == ["Other"]


def test_the_service_survives_the_lost_race_and_the_transaction_stays_usable(
    client, user_a, owner_engine, monkeypatch
):
    from app.core.db import session_for_user

    category = client.post(
        "/api/categories", json={"name": "Cat", "kind": "expense"}, headers=user_a["headers"]
    ).json()
    real = ledger.create_entry
    seen = {}

    def losing(session, user_id, **kwargs):
        if "winner" not in seen:
            seen["winner"] = _insert_winner(owner_engine, user_id, category["id"], REF)
        return real(session, user_id, **kwargs)

    monkeypatch.setattr(ledger, "create_entry", losing)
    fields = dict(
        kind=ledger.EntryKind.expense,
        amount=Decimal("1.00"),
        occurred_on=dt.date(2026, 9, 10),
        note=None,
        category_id=uuid.UUID(category["id"]),
        category_name=None,
    )
    gen = session_for_user(user_a["id"])
    session = next(gen)
    try:
        entry, created = ledger.create_entry_once(
            session, user_a["id"], client_ref=uuid.UUID(REF), **fields
        )
        assert created is False and entry.id == seen["winner"]
        # The request transaction (and its tenant) is intact: it can still read and write.
        other, created = ledger.create_entry_once(
            session, user_a["id"], client_ref=uuid.uuid4(), **fields
        )
        assert created is True and other.id != entry.id
    finally:
        gen.close()


def test_another_integrity_error_is_not_swallowed(client, user_a):
    """Only ``entries_user_client_ref_key`` is the race; a CHECK violation surfaces unchanged."""
    from app.core.db import session_for_user

    category = client.post(
        "/api/categories", json={"name": "Cat", "kind": "expense"}, headers=user_a["headers"]
    ).json()
    gen = session_for_user(user_a["id"])
    session = next(gen)
    try:
        with pytest.raises(IntegrityError) as exc:
            ledger.create_entry_once(
                session,
                user_a["id"],
                client_ref=uuid.UUID(REF),
                kind=ledger.EntryKind.expense,
                amount=Decimal("-1.00"),  # the schema would stop this; the CHECK must too
                occurred_on=dt.date(2026, 9, 10),
                note=None,
                category_id=uuid.UUID(category["id"]),
                category_name=None,
            )
        assert "entries_amount_positive" in str(exc.value)
    finally:
        gen.close()


def test_a_unique_violation_on_another_constraint_is_not_swallowed(
    client, user_a, monkeypatch
):
    """SQLSTATE 23505 alone is not enough: the constraint name decides."""
    from app.core.db import session_for_user

    category = client.post(
        "/api/categories", json={"name": "Cat", "kind": "expense"}, headers=user_a["headers"]
    ).json()
    real = ledger.create_entry

    def collide(session, user_id, **kwargs):
        entry = real(session, user_id, **kwargs)
        # The entry's own primary key, on a second row with the same id: a 23505 that is
        # not the client_ref key.
        session.execute(
            text(
                "INSERT INTO entries (id, user_id, kind, category_id, amount, occurred_on) "
                "SELECT id, user_id, kind, category_id, amount, occurred_on FROM entries "
                "WHERE id = :i"
            ),
            {"i": str(entry.id)},
        )
        return entry

    monkeypatch.setattr(ledger, "create_entry", collide)
    gen = session_for_user(user_a["id"])
    session = next(gen)
    try:
        with pytest.raises(IntegrityError) as exc:
            ledger.create_entry_once(
                session,
                user_a["id"],
                client_ref=uuid.UUID(REF),
                kind=ledger.EntryKind.expense,
                amount=Decimal("1.00"),
                occurred_on=dt.date(2026, 9, 10),
                note=None,
                category_id=uuid.UUID(category["id"]),
                category_name=None,
            )
        assert exc.value.orig.sqlstate == "23505"
        assert "entries_user_client_ref_key" not in str(exc.value)
    finally:
        gen.close()


def _fake_error(sqlstate, constraint):
    class _Diag:
        constraint_name = constraint

    class _Orig(Exception):
        pass

    orig = _Orig()
    orig.sqlstate = sqlstate
    orig.diag = _Diag()
    return IntegrityError("INSERT", {}, orig)


@pytest.mark.parametrize(
    ("sqlstate", "constraint"),
    [("23503", "entries_user_client_ref_key"), ("23505", "entries_pkey")],
    ids=["right-name-wrong-sqlstate", "right-sqlstate-wrong-name"],
)
def test_only_the_ref_key_unique_violation_is_the_race(
    client, user_a, owner_engine, monkeypatch, sqlstate, constraint
):
    """Both halves of the test are needed. A row with the ref exists, so a wrongly swallowed
    error would be answered with it rather than failing for want of one."""
    from app.core.db import session_for_user

    category = client.post(
        "/api/categories", json={"name": "Cat", "kind": "expense"}, headers=user_a["headers"]
    ).json()
    _insert_winner(owner_engine, user_a["id"], category["id"], REF)

    def boom(session, user_id, **kwargs):
        raise _fake_error(sqlstate, constraint)

    # The replay check must miss, or create_entry is never reached: look up another ref.
    monkeypatch.setattr(ledger, "create_entry", boom)
    gen = session_for_user(user_a["id"])
    session = next(gen)
    try:
        ref = uuid.UUID(REF)
        # Hide the winner from the first lookup only.
        calls = {"n": 0}
        real_execute = session.execute

        def execute(stmt, *a, **k):
            result = real_execute(stmt, *a, **k)
            calls["n"] += 1
            if calls["n"] == 1:
                return _Empty()
            return result

        class _Empty:
            def scalar_one_or_none(self):
                return None

        monkeypatch.setattr(session, "execute", execute)
        with pytest.raises(IntegrityError):
            ledger.create_entry_once(
                session,
                user_a["id"],
                client_ref=ref,
                kind=ledger.EntryKind.expense,
                amount=Decimal("1.00"),
                occurred_on=dt.date(2026, 9, 10),
                note=None,
                category_id=uuid.UUID(category["id"]),
                category_name=None,
            )
    finally:
        gen.close()


def test_a_replay_never_reaches_the_create_path(client, user_a, monkeypatch):
    first = _post(client, user_a, client_ref=REF)
    assert first.status_code == 201

    def refuse(*a, **k):
        raise AssertionError("create_entry must not run for a ref already used")

    monkeypatch.setattr(ledger, "create_entry", refuse)
    again = _post(client, user_a, client_ref=REF, category_name="Something else")
    assert again.status_code == 200 and again.json()["id"] == first.json()["id"]


# ------------------------------------------------------------ isolation


def test_user_b_sending_a_ref_never_gets_a_row_back(
    client, user_a, user_b, owner_engine, runtime_connection
):
    a = _post(client, user_a, client_ref=REF, amount="11.00", note="alice only")
    b = _post(client, user_b, client_ref=REF, amount="22.00")
    assert a.status_code == 201 and b.status_code == 201
    assert b.json()["id"] != a.json()["id"]
    assert b.json()["amount"] == "22.00" and b.json()["note"] is None
    # B's replay answers B's own row, not A's.
    b_again = _post(client, user_b, client_ref=REF, amount="1.00")
    assert b_again.status_code == 200 and b_again.json()["id"] == b.json()["id"]

    for user, own in ((user_a, a), (user_b, b)):
        conn = runtime_connection(user["id"])
        try:
            rows = conn.execute(
                text("SELECT id FROM entries WHERE client_ref = :r"), {"r": REF}
            ).all()
        finally:
            conn.close()
        assert [str(r.id) for r in rows] == [own.json()["id"]]


def test_the_database_refuses_a_second_row_with_the_same_ref_for_one_user(
    client, user_a, runtime_connection
):
    category = client.post(
        "/api/categories", json={"name": "Cat", "kind": "expense"}, headers=user_a["headers"]
    ).json()
    conn = runtime_connection(user_a["id"])
    sql = text(
        "INSERT INTO entries (user_id, kind, category_id, amount, occurred_on, client_ref) "
        "VALUES (:u, CAST('expense' AS entry_kind), :c, 1, DATE '2026-09-10', :r)"
    )
    args = {"u": str(user_a["id"]), "c": category["id"], "r": REF}
    try:
        conn.execute(sql, args)
        with pytest.raises(IntegrityError) as exc:
            conn.execute(sql, args)
        assert "entries_user_client_ref_key" in str(exc.value)
    finally:
        conn.rollback()
        conn.close()


def test_the_replay_lookup_is_scoped_to_the_user_without_rls(client, user_a, user_b, owner_engine):
    """RLS would hide B's row from A anyway; this proves the query itself names the user."""
    from sqlalchemy.orm import Session

    category = client.post(
        "/api/categories", json={"name": "Cat", "kind": "expense"}, headers=user_a["headers"]
    ).json()
    b_category = client.post(
        "/api/categories", json={"name": "Cat", "kind": "expense"}, headers=user_b["headers"]
    ).json()
    b_entry = _insert_winner(owner_engine, user_b["id"], b_category["id"], REF)
    with Session(owner_engine) as session:
        # Superuser-like owner session: if RLS does not apply here, only the WHERE protects A.
        entry, created = ledger.create_entry_once(
            session,
            user_a["id"],
            client_ref=uuid.UUID(REF),
            kind=ledger.EntryKind.expense,
            amount=Decimal("1.00"),
            occurred_on=dt.date(2026, 9, 10),
            note=None,
            category_id=uuid.UUID(category["id"]),
            category_name=None,
        )
        assert created is True
        assert entry.id != b_entry and entry.user_id == user_a["id"]
        session.rollback()


# ------------------------------------------------------------ migration


def test_migration_0037_round_trips(owner_engine):
    from alembic import command
    from alembic.config import Config

    from tests.conftest import BACKEND_ROOT

    def state():
        with owner_engine.connect() as conn:
            col = conn.execute(
                text(
                    "SELECT count(*) FROM information_schema.columns "
                    "WHERE table_name = 'entries' AND column_name = 'client_ref'"
                )
            ).scalar_one()
            con = conn.execute(
                text(
                    "SELECT count(*) FROM pg_constraint "
                    "WHERE conname = 'entries_user_client_ref_key'"
                )
            ).scalar_one()
        return col, con

    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    assert state() == (1, 1)
    try:
        command.downgrade(cfg, "0036")
        assert state() == (0, 0)
    finally:
        command.upgrade(cfg, "head")
    assert state() == (1, 1)
