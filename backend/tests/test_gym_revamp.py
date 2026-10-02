# ruff: noqa: E501
"""Epic 42 - timed and distance exercises, richer routines, sessions sent whole (AD-58)."""

import uuid

import pytest
from sqlalchemy import text

H = "headers"


def _ex(client, user, name, kind=None):
    body = {"name": name}
    if kind:
        body["kind"] = kind
    r = client.post("/api/gym/exercises", json=body, headers=user[H])
    assert r.status_code == 201, r.text
    return r.json()


def _routine(client, user, name="Push day"):
    return client.post("/api/gym/routines", json={"name": name}, headers=user[H]).json()


def _line(client, user, routine_id, **body):
    return client.post(f"/api/gym/routines/{routine_id}/exercises", json=body, headers=user[H])


def _workout(client, user):
    return client.post("/api/gym/workouts", json={}, headers=user[H]).json()


def _set(client, user, workout_id, **body):
    return client.post(f"/api/gym/workouts/{workout_id}/sets", json=body, headers=user[H])


def _complete(client, user, **body):
    body.setdefault("client_ref", str(uuid.uuid4()))
    body.setdefault("performed_on", "2026-10-01")
    body.setdefault("sets", [])
    return client.post("/api/gym/workouts/complete", json=body, headers=user[H])


def _count(runtime_connection, user, table):
    conn = runtime_connection(user["id"])
    try:
        return conn.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()
    finally:
        conn.close()


# ------------------------------------------------------------------- kind


def test_an_exercise_has_a_kind_defaulting_to_reps_and_keeping_it(client, user_a):
    assert _ex(client, user_a, "Bench")["kind"] == "reps"
    assert _ex(client, user_a, "Plank", "duration")["kind"] == "duration"
    # Idempotent create: the existing exercise keeps its kind.
    assert _ex(client, user_a, "plank", "distance")["kind"] == "duration"
    kinds = {e["name"]: e["kind"] for e in client.get(
        "/api/gym/exercises", headers=user_a[H]).json()["items"]}
    assert kinds == {"Bench": "reps", "Plank": "duration"}


def test_the_kind_is_locked_once_a_set_is_logged(client, user_a):
    plank = _ex(client, user_a, "Plank", "duration")
    url = f"/api/gym/exercises/{plank['id']}"
    assert client.patch(url, json={"kind": "distance"}, headers=user_a[H]).json()["kind"] == "distance"
    assert client.patch(url, json={"kind": "duration"}, headers=user_a[H]).status_code == 200
    w = _workout(client, user_a)
    assert _set(client, user_a, w["id"], exercise_id=plank["id"], duration_seconds=30).status_code == 201
    locked = client.patch(url, json={"kind": "reps"}, headers=user_a[H])
    assert locked.status_code == 409
    assert locked.json()["code"] == "exercise_kind_locked"
    # Naming the same kind is not a change; other fields still edit.
    assert client.patch(url, json={"kind": "duration", "note": "x"}, headers=user_a[H]).status_code == 200


@pytest.mark.parametrize(
    ("kind", "good", "missing_code_body", "wrong"),
    [
        ("reps", {"reps": 5}, {}, {"reps": 5, "duration_seconds": 3}),
        ("duration", {"duration_seconds": 30}, {"reps": None}, {"duration_seconds": 30, "reps": 5}),
        ("distance", {"distance_m": 500}, {"weight": "10"}, {"distance_m": 500, "duration_seconds": 5}),
    ],
)
def test_a_set_must_carry_exactly_the_measure_its_kind_needs(
    client, user_a, kind, good, missing_code_body, wrong
):
    ex = _ex(client, user_a, f"Thing-{kind}", kind)
    w = _workout(client, user_a)
    ok = _set(client, user_a, w["id"], exercise_id=ex["id"], weight="12.5", **good)
    assert ok.status_code == 201, ok.text
    assert ok.json()["kind"] == kind
    assert ok.json()["weight"] == "12.50"

    missing = _set(client, user_a, w["id"], exercise_id=ex["id"], **missing_code_body)
    assert missing.status_code == 422
    assert missing.json()["code"] == "set_missing_measure"

    refused = _set(client, user_a, w["id"], exercise_id=ex["id"], **wrong)
    assert refused.status_code == 422
    assert refused.json()["code"] == "set_wrong_measure"


def test_a_name_coins_the_exercise_with_the_sets_kind_on_both_endpoints(client, user_a):
    w = _workout(client, user_a)
    r = _set(client, user_a, w["id"], exercise_name="Rowing", kind="distance", distance_m=2000)
    assert r.status_code == 201
    assert r.json()["kind"] == "distance"
    done = _complete(client, user_a, sets=[{"exercise_name": "Hang", "kind": "duration",
                                           "duration_seconds": 40}])
    assert done.status_code == 201
    assert done.json()["sets"][0]["kind"] == "duration"
    # No kind given -> reps, so a duration-only set is refused.
    bad = _complete(client, user_a, sets=[{"exercise_name": "Squat", "duration_seconds": 4}])
    assert bad.status_code == 422
    assert bad.json()["code"] == "set_missing_measure"


# --------------------------------------------------------------- complete


def test_complete_is_idempotent_per_user(client, user_a, user_b, runtime_connection):
    ref = str(uuid.uuid4())
    sets = [{"exercise_name": "Bench", "reps": 8, "weight": "60"},
            {"exercise_name": "Bench", "reps": 7}]
    first = _complete(client, user_a, client_ref=ref, sets=sets, note="n",
                      started_at="2026-10-01T10:00:00Z", ended_at="2026-10-01T10:45:00Z")
    assert first.status_code == 201, first.text
    body = first.json()
    assert [s["position"] for s in body["sets"]] == [0, 1]
    assert body["started_at"] is not None and body["ended_at"] is not None
    assert body["sets"][0]["weight"] == "60.00"

    again = _complete(client, user_a, client_ref=ref, sets=sets)
    assert again.status_code == 200
    assert again.json()["id"] == body["id"]
    assert len(again.json()["sets"]) == 2
    assert _count(runtime_connection, user_a, "workouts") == 1
    assert _count(runtime_connection, user_a, "workout_sets") == 2

    other = _complete(client, user_b, client_ref=ref, sets=sets)
    assert other.status_code == 201
    assert other.json()["id"] != body["id"]
    assert _count(runtime_connection, user_b, "workouts") == 1
    # B's replay cannot read or touch A's row.
    assert _complete(client, user_b, client_ref=ref).json()["id"] == other.json()["id"]


def test_complete_stores_unknown_or_foreign_routine_as_null(client, user_a, user_b):
    theirs = _routine(client, user_b, "Theirs")
    mine = _routine(client, user_a, "Mine")
    assert _complete(client, user_a, routine_id=str(uuid.uuid4())).json()["routine_id"] is None
    assert _complete(client, user_a, routine_id=theirs["id"]).json()["routine_id"] is None
    assert _complete(client, user_a, routine_id=mine["id"]).json()["routine_id"] == mine["id"]


def test_complete_refuses_ended_before_started_and_foreign_exercise(client, user_a, user_b):
    r = _complete(client, user_a, started_at="2026-10-01T10:00:00Z", ended_at="2026-10-01T09:00:00Z")
    assert r.status_code == 422
    theirs = _ex(client, user_b, "Secret")
    foreign = _complete(client, user_a, sets=[{"exercise_id": theirs["id"], "reps": 3}])
    assert foreign.status_code == 404


def test_a_refused_complete_writes_nothing(client, user_a, runtime_connection):
    bad = _complete(client, user_a, sets=[{"exercise_name": "Squat", "reps": 5},
                                          {"exercise_name": "Squat"}])
    assert bad.status_code == 422
    assert _count(runtime_connection, user_a, "workouts") == 0
    assert _count(runtime_connection, user_a, "exercises") == 0


# ---------------------------------------------------------------- routines


def test_routine_lines_carry_targets_and_patch_clears_or_leaves(client, user_a):
    r = _routine(client, user_a)
    made = _line(client, user_a, r["id"], exercise_name="Plank", kind="duration", target_sets=3,
                 target_seconds=45, target_weight="5", rest_seconds=60, note="slow")
    assert made.status_code == 201, made.text
    line = made.json()
    assert (line["kind"], line["target_seconds"], line["target_weight"], line["rest_seconds"],
            line["note"]) == ("duration", 45, "5.00", 60, "slow")

    url = f"/api/gym/routines/lines/{line['id']}"
    patched = client.patch(url, json={"target_seconds": None, "rest_seconds": 90}, headers=user_a[H])
    assert patched.status_code == 200
    p = patched.json()
    assert p["target_seconds"] is None  # explicit null clears
    assert p["rest_seconds"] == 90
    assert p["target_sets"] == 3 and p["note"] == "slow" and p["target_weight"] == "5.00"  # absent leaves
    assert client.patch(url, json={"target_seconds": 0}, headers=user_a[H]).status_code == 422


def test_order_must_be_exactly_the_routines_lines(client, user_a):
    r = _routine(client, user_a)
    ids = [_line(client, user_a, r["id"], exercise_name=n).json()["id"] for n in ("A", "B", "C")]
    url = f"/api/gym/routines/{r['id']}/order"
    ok = client.put(url, json={"line_ids": [ids[2], ids[0], ids[1]]}, headers=user_a[H])
    assert ok.status_code == 200
    assert [(ln["exercise_name"], ln["position"]) for ln in ok.json()["lines"]] == [
        ("C", 0), ("A", 1), ("B", 2)]
    for bad in ([ids[0], ids[1]], ids + [str(uuid.uuid4())], [ids[0], ids[0], ids[1], ids[2]], []):
        res = client.put(url, json={"line_ids": bad}, headers=user_a[H])
        assert res.status_code == 422
        assert res.json()["code"] == "order_mismatch"


def test_patch_routine_renames_and_clears_the_note(client, user_a):
    r = client.post("/api/gym/routines", json={"name": "Old", "note": "n"}, headers=user_a[H]).json()
    url = f"/api/gym/routines/{r['id']}"
    a = client.patch(url, json={"name": "New"}, headers=user_a[H]).json()
    assert (a["name"], a["note"]) == ("New", "n")
    b = client.patch(url, json={"note": None}, headers=user_a[H]).json()
    assert (b["name"], b["note"]) == ("New", None)
    _routine(client, user_a, "Taken")
    clash = client.patch(url, json={"name": "taken"}, headers=user_a[H])
    assert clash.status_code == 409
    assert clash.json()["code"] == "routine_name_taken"


def test_routines_full_is_not_shadowed_and_lists_lines(client, user_a, user_b):
    r1 = _routine(client, user_a, "Alpha")
    r2 = _routine(client, user_a, "Beta")
    _line(client, user_a, r1["id"], exercise_name="Bench", target_reps=8)
    _line(client, user_a, r1["id"], exercise_name="Bench", target_reps=3)
    _line(client, user_a, r2["id"], exercise_name="Rowing", kind="distance", target_distance_m=2000)
    _routine(client, user_b, "Bobs")
    res = client.get("/api/gym/routines/full", headers=user_a[H])
    assert res.status_code == 200, res.text
    items = res.json()["items"]
    assert [i["name"] for i in items] == ["Alpha", "Beta"]
    assert [ln["target_reps"] for ln in items[0]["lines"]] == [8, 3]
    assert items[1]["lines"][0]["kind"] == "distance"
    assert items[1]["lines"][0]["target_distance_m"] == 2000


def _imp(name="Imported", lines=None):
    return {"name": name, "lines": _DEFAULT_LINES if lines is None else lines}


_DEFAULT_LINES = [
        {"exercise_name": "Bench press", "kind": "reps", "target_sets": 4, "target_reps": 8,
         "target_weight": "60"},
        {"exercise_name": "Plank", "kind": "duration", "target_sets": 3, "target_seconds": 45,
         "rest_seconds": 60},
        {"exercise_name": "Bench press", "kind": "reps", "target_sets": 1, "target_reps": 15}]


def test_import_creates_routine_exercises_and_lines_in_order(client, user_a):
    res = client.post("/api/gym/routines/import", json=_imp(), headers=user_a[H])
    assert res.status_code == 201, res.text
    body = res.json()
    assert [(ln["exercise_name"], ln["kind"], ln["position"]) for ln in body["lines"]] == [
        ("Bench press", "reps", 0), ("Plank", "duration", 1), ("Bench press", "reps", 2)]
    assert body["lines"][0]["exercise_id"] == body["lines"][2]["exercise_id"]
    assert body["lines"][0]["target_weight"] == "60.00"
    names = [e["name"] for e in client.get("/api/gym/exercises", headers=user_a[H]).json()["items"]]
    assert names == ["Bench press", "Plank"]


def test_import_is_atomic_on_a_kind_mismatch(client, user_a, runtime_connection):
    _ex(client, user_a, "Plank", "reps")
    before = (_count(runtime_connection, user_a, "routines"),
              _count(runtime_connection, user_a, "exercises"),
              _count(runtime_connection, user_a, "routine_exercises"))
    res = client.post("/api/gym/routines/import", json=_imp(), headers=user_a[H])
    assert res.status_code == 422
    assert res.json()["code"] == "exercise_kind_mismatch"
    assert "Plank" in res.json()["detail"]
    after = (_count(runtime_connection, user_a, "routines"),
             _count(runtime_connection, user_a, "exercises"),
             _count(runtime_connection, user_a, "routine_exercises"))
    assert after == before


def test_import_refuses_one_name_with_two_kinds_in_the_same_file(client, user_a, runtime_connection):
    lines = [{"exercise_name": "Run", "kind": "distance", "target_distance_m": 1000},
             {"exercise_name": "run", "kind": "duration", "target_seconds": 60}]
    res = client.post("/api/gym/routines/import", json=_imp(lines=lines), headers=user_a[H])
    assert res.status_code == 422
    assert res.json()["code"] == "exercise_kind_mismatch"
    assert _count(runtime_connection, user_a, "routines") == 0


def test_import_bounds(client, user_a):
    assert client.post("/api/gym/routines/import", json=_imp(lines=[]), headers=user_a[H]).status_code == 422
    many = [{"exercise_name": f"E{i}", "kind": "reps", "target_reps": 5} for i in range(61)]
    assert client.post("/api/gym/routines/import", json=_imp(lines=many), headers=user_a[H]).status_code == 422
    bad = [{"exercise_name": "X", "kind": "swim"}]
    assert client.post("/api/gym/routines/import", json=_imp(lines=bad), headers=user_a[H]).status_code == 422


# ----------------------------------------------------------------- history


def test_history_reports_seconds_and_metres(client, user_a):
    plank = _ex(client, user_a, "Plank", "duration")
    row = _ex(client, user_a, "Rowing", "distance")
    bench = _ex(client, user_a, "Bench")
    _complete(client, user_a, performed_on="2026-10-01", sets=[
        {"exercise_id": plank["id"], "duration_seconds": 30},
        {"exercise_id": plank["id"], "duration_seconds": 45, "weight": "5"},
        {"exercise_id": row["id"], "distance_m": 1500},
        {"exercise_id": row["id"], "distance_m": 500},
        {"exercise_id": bench["id"], "reps": 5, "weight": "60"}])
    p = client.get(f"/api/gym/exercises/{plank['id']}/history", headers=user_a[H]).json()["points"][0]
    assert (p["best_seconds"], p["total_seconds"], p["sets"], p["reps"]) == (45, 75, 2, 0)
    assert p["best_distance_m"] is None and p["total_distance_m"] is None
    r = client.get(f"/api/gym/exercises/{row['id']}/history", headers=user_a[H]).json()["points"][0]
    assert (r["best_distance_m"], r["total_distance_m"]) == (1500, 2000)
    assert r["best_seconds"] is None and r["top_weight"] is None and r["volume"] is None
    b = client.get(f"/api/gym/exercises/{bench['id']}/history", headers=user_a[H]).json()["points"][0]
    assert (b["reps"], b["volume"], b["best_seconds"]) == (5, "300.00", None)


# --------------------------------------------------------------- isolation


def test_b_cannot_reach_as_rows_through_any_new_endpoint(client, user_a, user_b):
    r = _routine(client, user_a)
    line = _line(client, user_a, r["id"], exercise_name="Bench").json()
    ex = _ex(client, user_a, "Plank", "duration")
    done = _complete(client, user_a).json()

    assert client.patch(f"/api/gym/routines/lines/{line['id']}", json={"note": "x"},
                        headers=user_b[H]).status_code == 404
    assert client.put(f"/api/gym/routines/{r['id']}/order", json={"line_ids": [line["id"]]},
                      headers=user_b[H]).status_code == 404
    assert client.patch(f"/api/gym/routines/{r['id']}", json={"name": "x"},
                        headers=user_b[H]).status_code == 404
    assert client.patch(f"/api/gym/exercises/{ex['id']}", json={"kind": "reps"},
                        headers=user_b[H]).status_code == 404
    assert _complete(client, user_b, sets=[{"exercise_id": ex["id"], "duration_seconds": 5}]
                     ).status_code == 404
    assert _line(client, user_b, r["id"], exercise_name="Z").status_code == 404
    assert client.get(f"/api/gym/workouts/{done['id']}", headers=user_b[H]).status_code == 404
    assert client.get("/api/gym/routines/full", headers=user_b[H]).json()["items"] == []
