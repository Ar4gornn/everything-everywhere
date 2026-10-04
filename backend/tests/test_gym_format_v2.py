# ruff: noqa: E501
"""Epic 54 - per-set targets, effort, tempo, supersets, warm-up sets (AD-67)."""

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


def _complete(client, user, **body):
    body.setdefault("client_ref", str(uuid.uuid4()))
    body.setdefault("performed_on", "2026-10-01")
    body.setdefault("sets", [])
    return client.post("/api/gym/workouts/complete", json=body, headers=user[H])


SETS = [
    {"reps": 12, "weight": "40", "warmup": True},
    {"reps": 8, "weight": "60.5"},
    {"reps": 6, "weight": "62.5"},
]


def _full_line(**over):
    body = {
        "exercise_name": "Bench",
        "set_targets": SETS,
        "target_rpe": 8.5,
        "tempo": " 3-1-x-0 ",
        "superset_group": 2,
        "rest_seconds": 90,
    }
    body.update(over)
    return body


# ------------------------------------------------------------ round trips


def test_every_field_round_trips_through_create_and_read(client, user_a):
    r = _routine(client, user_a)
    out = _line(client, user_a, r["id"], **_full_line())
    assert out.status_code == 201, out.text
    line = out.json()
    assert line["set_targets"] == [
        {"reps": 12, "seconds": None, "distance_m": None, "weight": "40.00", "warmup": True},
        {"reps": 8, "seconds": None, "distance_m": None, "weight": "60.50", "warmup": False},
        {"reps": 6, "seconds": None, "distance_m": None, "weight": "62.50", "warmup": False},
    ]
    assert line["target_rpe"] == 8.5
    assert isinstance(line["target_rpe"], float)
    assert line["target_rir"] is None
    assert line["tempo"] == "3-1-X-0"
    assert line["superset_group"] == 2
    detail = client.get(f"/api/gym/routines/{r['id']}", headers=user_a[H]).json()["lines"][0]
    assert detail == line
    full = client.get("/api/gym/routines/full", headers=user_a[H]).json()["items"][0]["lines"][0]
    assert full == line


def test_flat_targets_are_derived_from_the_first_working_set(client, user_a):
    r = _routine(client, user_a)
    # Flat values sent alongside set_targets lose to the derivation.
    line = _line(client, user_a, r["id"], **_full_line(target_reps=99, target_sets=9)).json()
    assert line["target_sets"] == 3
    assert line["target_reps"] == 8
    assert line["target_weight"] == "60.50"
    assert line["target_seconds"] is None


def test_all_warmups_fall_back_to_the_first_set(client, user_a):
    r = _routine(client, user_a)
    sets = [{"reps": 10, "warmup": True}, {"reps": 5, "warmup": True}]
    line = _line(client, user_a, r["id"], exercise_name="Squat", set_targets=sets).json()
    assert (line["target_sets"], line["target_reps"]) == (2, 10)
    assert line["target_weight"] is None


def test_without_set_targets_the_flat_fields_are_as_sent(client, user_a):
    r = _routine(client, user_a)
    line = _line(client, user_a, r["id"], exercise_name="Row", target_sets=3, target_reps=10).json()
    assert line["set_targets"] is None
    assert (line["target_sets"], line["target_reps"]) == (3, 10)
    assert line["target_rpe"] is None and line["tempo"] is None


def test_update_absent_is_unchanged_and_null_clears(client, user_a):
    r = _routine(client, user_a)
    line = _line(client, user_a, r["id"], **_full_line(target_rpe=None, target_rir=2)).json()
    url = f"/api/gym/routines/lines/{line['id']}"
    changed = client.patch(url, json={"note": "x"}, headers=user_a[H]).json()
    assert changed["set_targets"] == line["set_targets"]
    assert (changed["target_rir"], changed["tempo"], changed["superset_group"]) == (2, "3-1-X-0", 2)

    cleared = client.patch(
        url,
        json={"set_targets": None, "target_rir": None, "tempo": "", "superset_group": None},
        headers=user_a[H],
    ).json()
    assert cleared["set_targets"] is None
    assert cleared["target_rir"] is None and cleared["tempo"] is None
    assert cleared["superset_group"] is None
    # Clearing the list leaves the flat fields as they were stored.
    assert (cleared["target_sets"], cleared["target_reps"]) == (3, 8)


def test_update_with_set_targets_renormalises_the_flat_fields(client, user_a):
    r = _routine(client, user_a)
    line = _line(client, user_a, r["id"], exercise_name="Bench", target_sets=3, target_reps=5).json()
    out = client.patch(
        f"/api/gym/routines/lines/{line['id']}",
        json={"set_targets": [{"reps": 4, "weight": 80}], "target_reps": 77},
        headers=user_a[H],
    ).json()
    assert (out["target_sets"], out["target_reps"], out["target_weight"]) == (1, 4, "80.00")


def test_update_refuses_rpe_beside_a_stored_rir(client, user_a):
    r = _routine(client, user_a)
    line = _line(client, user_a, r["id"], exercise_name="Bench", target_rir=2).json()
    url = f"/api/gym/routines/lines/{line['id']}"
    assert client.patch(url, json={"target_rpe": 8}, headers=user_a[H]).status_code == 422
    ok = client.patch(url, json={"target_rpe": 8, "target_rir": None}, headers=user_a[H])
    assert ok.status_code == 200 and ok.json()["target_rpe"] == 8.0


def test_import_carries_every_field(client, user_a):
    body = {
        "name": "Imported",
        "lines": [
            {"exercise_name": "Bench", "kind": "reps", "set_targets": SETS, "target_rir": 1,
             "tempo": "3-0-1-0", "superset_group": 1},
            {"exercise_name": "Plank", "kind": "duration",
             "set_targets": [{"seconds": 30, "warmup": True}, {"seconds": 45}], "target_rpe": 7},
        ],
    }
    r = client.post("/api/gym/routines/import", json=body, headers=user_a[H])
    assert r.status_code == 201, r.text
    bench, plank = r.json()["lines"]
    assert bench["set_targets"][1]["weight"] == "60.50"
    assert (bench["target_sets"], bench["target_reps"], bench["target_weight"]) == (3, 8, "60.50")
    assert (bench["target_rir"], bench["tempo"], bench["superset_group"]) == (1, "3-0-1-0", 1)
    assert (plank["target_sets"], plank["target_seconds"], plank["target_rpe"]) == (2, 45, 7.0)


def test_import_checks_set_targets_against_the_kind(client, user_a):
    body = {
        "name": "Bad",
        "lines": [{"exercise_name": "Plank", "kind": "duration", "set_targets": [{"reps": 5}]}],
    }
    r = client.post("/api/gym/routines/import", json=body, headers=user_a[H])
    assert r.status_code == 422
    assert client.get("/api/gym/routines", headers=user_a[H]).json()["items"] == []


# --------------------------------------------------------------- refusals


def test_set_target_measure_must_match_the_exercise_kind(client, user_a):
    r = _routine(client, user_a)
    _ex(client, user_a, "Plank", "duration")
    _ex(client, user_a, "Rowing", "distance")
    _ex(client, user_a, "Curl")
    for name, bad in (
        ("Plank", {"reps": 5}),
        ("Plank", {"distance_m": 100}),
        ("Rowing", {"seconds": 30}),
        ("Curl", {"seconds": 30}),
        ("Curl", {"distance_m": 30}),
    ):
        out = _line(client, user_a, r["id"], exercise_name=name, set_targets=[bad])
        assert out.status_code == 422, (name, bad, out.text)
        assert out.json()["code"] == "set_target_wrong_measure"
    # The right measure, with a weight, is fine for each kind.
    for name, good in (("Plank", {"seconds": 30, "weight": 5}), ("Rowing", {"distance_m": 500}), ("Curl", {"reps": 8})):
        assert _line(client, user_a, r["id"], exercise_name=name, set_targets=[good]).status_code == 201


def test_update_checks_set_targets_against_the_kind(client, user_a):
    r = _routine(client, user_a)
    line = _line(client, user_a, r["id"], exercise_name="Plank", kind="duration").json()
    out = client.patch(
        f"/api/gym/routines/lines/{line['id']}", json={"set_targets": [{"reps": 5}]}, headers=user_a[H]
    )
    assert out.status_code == 422


@pytest.mark.parametrize(
    "bad",
    [
        {"target_rpe": 8, "target_rir": 2},
        {"target_rpe": 8.3},
        {"target_rpe": 0.5},
        {"target_rpe": 10.5},
        {"target_rir": 11},
        {"target_rir": -1},
        {"tempo": "3-1-1"},
        {"tempo": "3-1-1-Z"},
        {"tempo": "10-1-1-0"},
        {"tempo": 3},
        {"superset_group": 0},
        {"superset_group": 100},
        {"set_targets": []},
        {"set_targets": [{"reps": 5}] * 100},
        {"set_targets": [{"reps": 0}]},
        {"set_targets": [{"reps": 1000}]},
        {"set_targets": [{"seconds": 86401}]},
        {"set_targets": [{"distance_m": 1_000_001}]},
        {"set_targets": [{"weight": "-1"}]},
        {"set_targets": [{"weight": "100000"}]},
        {"set_targets": [{"reps": 5, "warmup": "yes"}]},
        {"set_targets": [{"reps": 5, "colour": "red"}]},
    ],
)
def test_out_of_contract_values_are_422_on_create_and_update(client, user_a, bad):
    r = _routine(client, user_a)
    assert _line(client, user_a, r["id"], exercise_name="Bench", **bad).status_code == 422
    line = _line(client, user_a, r["id"], exercise_name="Squat").json()
    out = client.patch(f"/api/gym/routines/lines/{line['id']}", json=bad, headers=user_a[H])
    assert out.status_code == 422, out.text


def test_ninety_nine_set_targets_are_accepted(client, user_a):
    r = _routine(client, user_a)
    out = _line(client, user_a, r["id"], exercise_name="Bench", set_targets=[{"reps": 5}] * 99)
    assert out.status_code == 201 and out.json()["target_sets"] == 99


def test_rpe_in_halves_is_accepted_at_the_edges(client, user_a):
    r = _routine(client, user_a)
    for rpe in (1, 5.5, 10):
        out = _line(client, user_a, r["id"], exercise_name="Bench", target_rpe=rpe)
        assert out.status_code == 201 and out.json()["target_rpe"] == float(rpe)


def test_blank_tempo_is_null(client, user_a):
    r = _routine(client, user_a)
    assert _line(client, user_a, r["id"], exercise_name="Bench", tempo="  ").json()["tempo"] is None


def test_the_database_refuses_what_the_service_would_miss(owner_engine, client, user_a):
    r = _routine(client, user_a)
    _line(client, user_a, r["id"], exercise_name="Bench")
    with owner_engine.connect() as conn:
        for sql in (
            "UPDATE routine_exercises SET target_rpe = 8, target_rir = 2",
            "UPDATE routine_exercises SET target_rpe = 8.3",
            "UPDATE routine_exercises SET tempo = 'nope'",
            "UPDATE routine_exercises SET set_targets = '[]'::jsonb",
            "UPDATE routine_exercises SET set_targets = '{}'::jsonb",
        ):
            with pytest.raises(Exception, match="check constraint"):
                conn.execute(text(sql))
            conn.rollback()


# ---------------------------------------------------------------- warm-ups


def test_is_warmup_goes_in_and_comes_out(client, user_a):
    out = _complete(
        client,
        user_a,
        sets=[
            {"exercise_name": "Bench", "reps": 12, "weight": "40", "is_warmup": True},
            {"exercise_name": "Bench", "reps": 8, "weight": "60"},
        ],
    )
    assert out.status_code == 201, out.text
    assert [s["is_warmup"] for s in out.json()["sets"]] == [True, False]
    read = client.get(f"/api/gym/workouts/{out.json()['id']}", headers=user_a[H]).json()
    assert [s["is_warmup"] for s in read["sets"]] == [True, False]
    recent = client.get("/api/gym/workouts/recent", headers=user_a[H]).json()["items"][0]
    assert [s["is_warmup"] for s in recent["sets"]] == [True, False]


def test_is_warmup_on_the_single_set_endpoint(client, user_a):
    w = client.post("/api/gym/workouts", json={}, headers=user_a[H]).json()
    url = f"/api/gym/workouts/{w['id']}/sets"
    ok = client.post(url, json={"exercise_name": "Bench", "reps": 5, "is_warmup": True}, headers=user_a[H])
    assert ok.status_code == 201 and ok.json()["is_warmup"] is True
    plain = client.post(url, json={"exercise_name": "Bench", "reps": 5}, headers=user_a[H])
    assert plain.json()["is_warmup"] is False


@pytest.mark.parametrize("bad", ["yes", 1, None])
def test_is_warmup_is_strict(client, user_a, bad):
    out = _complete(client, user_a, sets=[{"exercise_name": "Bench", "reps": 5, "is_warmup": bad}])
    assert out.status_code == 422


def test_warmups_are_left_out_of_every_history_aggregate(client, user_a):
    bench = _ex(client, user_a, "Bench")
    _complete(
        client,
        user_a,
        sets=[
            {"exercise_id": bench["id"], "reps": 20, "weight": "100", "is_warmup": True},
            {"exercise_id": bench["id"], "reps": 5, "weight": "60"},
            {"exercise_id": bench["id"], "reps": 5, "weight": "60"},
        ],
    )
    pts = client.get(f"/api/gym/exercises/{bench['id']}/history", headers=user_a[H]).json()["points"]
    assert len(pts) == 1
    assert pts[0]["top_weight"] == "60.00"
    assert pts[0]["volume"] == "600.00"
    assert (pts[0]["reps"], pts[0]["sets"]) == (10, 2)


def test_warmups_are_left_out_of_timed_and_distance_history(client, user_a):
    plank = _ex(client, user_a, "Plank", "duration")
    row = _ex(client, user_a, "Rowing", "distance")
    _complete(
        client,
        user_a,
        sets=[
            {"exercise_id": plank["id"], "duration_seconds": 300, "is_warmup": True},
            {"exercise_id": plank["id"], "duration_seconds": 40},
            {"exercise_id": row["id"], "distance_m": 5000, "is_warmup": True},
            {"exercise_id": row["id"], "distance_m": 1000},
        ],
    )
    p = client.get(f"/api/gym/exercises/{plank['id']}/history", headers=user_a[H]).json()["points"][0]
    assert (p["best_seconds"], p["total_seconds"], p["sets"]) == (40, 40, 1)
    d = client.get(f"/api/gym/exercises/{row['id']}/history", headers=user_a[H]).json()["points"][0]
    assert (d["best_distance_m"], d["total_distance_m"]) == (1000, 1000)


def test_a_session_of_only_warmups_has_no_history_point(client, user_a):
    bench = _ex(client, user_a, "Bench")
    _complete(client, user_a, sets=[{"exercise_id": bench["id"], "reps": 10, "is_warmup": True}])
    pts = client.get(f"/api/gym/exercises/{bench['id']}/history", headers=user_a[H]).json()["points"]
    assert pts == []


# ---------------------------------------------------------------------- RLS


def test_another_users_lines_stay_invisible_and_untouchable(client, user_a, user_b):
    r = _routine(client, user_a)
    line = _line(client, user_a, r["id"], **_full_line()).json()
    url = f"/api/gym/routines/lines/{line['id']}"
    assert client.patch(url, json={"tempo": "1-1-1-1"}, headers=user_b[H]).status_code == 404
    assert client.get("/api/gym/routines/full", headers=user_b[H]).json()["items"] == []
    assert client.get(f"/api/gym/routines/{r['id']}", headers=user_b[H]).status_code == 404
    again = client.get(f"/api/gym/routines/{r['id']}", headers=user_a[H]).json()["lines"][0]
    assert again["tempo"] == "3-1-X-0"


def test_another_users_warmup_sets_do_not_touch_my_history(client, user_a, user_b):
    mine = _ex(client, user_a, "Bench")
    _complete(client, user_a, sets=[{"exercise_id": mine["id"], "reps": 5, "weight": "50"}])
    theirs = _ex(client, user_b, "Bench")
    _complete(client, user_b, sets=[{"exercise_id": theirs["id"], "reps": 9, "weight": "90", "is_warmup": True}])
    pts = client.get(f"/api/gym/exercises/{mine['id']}/history", headers=user_a[H]).json()["points"]
    assert [p["top_weight"] for p in pts] == ["50.00"]


def test_migration_0038_round_trips(owner_engine):
    from alembic import command
    from alembic.config import Config

    from tests.conftest import BACKEND_ROOT

    def count():
        with owner_engine.connect() as conn:
            return conn.execute(
                text(
                    "SELECT count(*) FROM information_schema.columns WHERE "
                    "(table_name = 'routine_exercises' AND column_name IN "
                    "('set_targets','target_rpe','target_rir','tempo','superset_group')) OR "
                    "(table_name = 'workout_sets' AND column_name = 'is_warmup')"
                )
            ).scalar_one()

    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    assert count() == 6
    try:
        command.downgrade(cfg, "0037")
        assert count() == 0
    finally:
        command.upgrade(cfg, "head")
    assert count() == 6
