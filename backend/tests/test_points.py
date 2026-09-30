"""Story 41.3 — points (AD-57).

One test per "accepted when" of the story, plus the rules they rest on (§2.6): a point a day,
a point per module, a bonus once each time a run reaches 7, 30, 100 or 365, earning that
never looks at what is shown, and a name the person chooses. The clock is pinned through
``app.core.clock.get_now``; long runs are seeded straight into ``activity_days`` through the
owner connection, since nothing else can write a year of history in a test.
"""

import datetime as dt

import pytest
from sqlalchemy import text

from app.core.clock import get_now
from app.services import streaks

UTC = dt.UTC
START = dt.date(2030, 1, 1)  # day 1 of every seeded run


def day(n: int) -> dt.date:
    return START + dt.timedelta(days=n - 1)


@pytest.fixture
def clock(client):
    from app.main import app

    def set_now(n: int) -> None:
        moment = dt.datetime.combine(day(n), dt.time(12), tzinfo=UTC)
        app.dependency_overrides[get_now] = lambda: moment

    set_now(1)
    yield set_now
    app.dependency_overrides.pop(get_now, None)


def seed(owner_engine, user, first: int, last: int, module: str = "app") -> None:
    """One activity row per day from day ``first`` to day ``last`` inclusive."""
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO activity_days (user_id, day, module) "
                "SELECT CAST(:u AS uuid), CAST(:d AS date) + g, CAST(:m AS text) "
                "FROM generate_series(CAST(:a AS int), CAST(:b AS int)) g"
            ),
            {"u": user["id"], "d": day(1), "m": module, "a": first - 1, "b": last - 1},
        )


def points(client, user) -> dict:
    return client.get("/api/streaks", headers=user["headers"]).json()["points"]


def check_in(client, user, streak: str) -> None:
    response = client.post(
        "/api/streaks/check-in", json={"streak": streak}, headers=user["headers"]
    )
    assert response.status_code == 200, response.text


def _patch(client, user, body):
    return client.patch("/api/auth/me/preferences", json=body, headers=user["headers"])


def _prefs(client, user):
    return client.get("/api/auth/me", headers=user["headers"]).json()["preferences"]


# ---------------------------------------------------------------- the shape


def test_get_carries_points_and_milestones_and_a_fresh_account_has_none(client, user_a, clock):
    body = client.get("/api/streaks", headers=user_a["headers"]).json()
    assert body["points"] == {"balance": 0, "earned": 0, "spent": 0}
    assert body["prices"]["milestones"] == [
        {"days": days, "bonus": bonus} for days, bonus in streaks.MILESTONES
    ]
    assert streaks.MILESTONES == ((7, 10), (30, 30), (100, 100), (365, 365))


# ---------------------------------------------------------------- earning a day


def test_a_day_active_in_overall_gym_and_entries_earns_three(client, user_a, clock):
    check_in(client, user_a, "gym")
    check_in(client, user_a, "entries")
    # overall (1) + gym (1) + entries (1)
    assert points(client, user_a) == {"balance": 3, "earned": 3, "spent": 0}


def test_a_dashboard_check_in_alone_earns_one(client, user_a, clock):
    check_in(client, user_a, "overall")
    assert points(client, user_a)["earned"] == 1


def test_a_second_press_or_write_the_same_day_earns_nothing_more(client, user_a, clock):
    check_in(client, user_a, "gym")
    check_in(client, user_a, "gym")
    assert points(client, user_a)["earned"] == 2


def test_each_of_the_ten_modules_pays_one(client, user_a, clock, owner_engine):
    for module in streaks.MODULES:
        seed(owner_engine, user_a, 1, 1, module)
    assert points(client, user_a)["earned"] == 1 + len(streaks.MODULES)


# ---------------------------------------------------------------- milestones


def test_reaching_seven_adds_ten_once(client, user_a, clock, owner_engine):
    seed(owner_engine, user_a, 1, 6)
    clock(6)
    assert points(client, user_a)["earned"] == 6  # no bonus at 6
    seed(owner_engine, user_a, 7, 7)
    clock(7)
    assert points(client, user_a)["earned"] == 7 + 10
    seed(owner_engine, user_a, 8, 9)
    clock(9)
    assert points(client, user_a)["earned"] == 9 + 10  # once, not again at 8 or 9


def test_a_pending_today_does_not_lose_or_repeat_a_bonus(client, user_a, clock, owner_engine):
    seed(owner_engine, user_a, 1, 7)
    clock(8)  # today pending
    assert points(client, user_a)["earned"] == 7 + 10


def test_a_second_run_reaching_seven_pays_again(client, user_a, clock, owner_engine):
    seed(owner_engine, user_a, 1, 7)
    seed(owner_engine, user_a, 9, 15)  # day 8 missed: the run broke
    clock(15)
    assert points(client, user_a)["earned"] == 14 + 10 + 10


@pytest.mark.parametrize(
    "length,bonus", [(30, 10 + 30), (100, 10 + 30 + 100), (365, 10 + 30 + 100 + 365)]
)
def test_each_milestone_pays_at_exactly_its_length(
    client, user_a, clock, owner_engine, length, bonus
):
    seed(owner_engine, user_a, 1, length - 1)
    clock(length - 1)
    before = points(client, user_a)["earned"]
    seed(owner_engine, user_a, length, length)
    clock(length)
    after = points(client, user_a)["earned"]
    assert after - before == 1 + dict(streaks.MILESTONES)[length]
    assert after == length + bonus


def test_a_tab_streak_pays_its_own_bonus(client, user_a, clock, owner_engine):
    seed(owner_engine, user_a, 1, 7, "gym")
    clock(7)
    # overall 7 + gym 7 + overall's 10 + gym's 10
    assert points(client, user_a)["earned"] == 7 + 7 + 10 + 10


# ---------------------------------------------------------------- earning is not display


def test_hiding_a_streak_or_a_module_does_not_change_the_balance(
    client, user_a, clock, owner_engine
):
    seed(owner_engine, user_a, 1, 7, "gym")
    clock(7)
    seed(owner_engine, user_a, 7, 7, "books")
    base = points(client, user_a)
    assert base["earned"] == 7 + 7 + 1 + 10 + 10
    for body in (
        {"streaks": {"gym": True, "books": True}},
        {"streaks": {"gym": False, "books": False}},
        {"modules": {"gym": False, "books": False}},
        {"streaks": {"gym": True}},
    ):
        assert _patch(client, user_a, body).status_code == 200
        assert points(client, user_a) == base


# ---------------------------------------------------------------- earned never decreases


def test_a_timezone_move_west_does_not_take_points_back(client, user_a, clock, owner_engine):
    """UTC+14 records local day D; UTC-11 makes local today D-1. Earned must not drop,
    neither the day's points nor a milestone bonus that day completed (§2.6)."""
    zone = "/api/auth/me/notification-schedule"
    east = {"timezone": "Pacific/Kiritimati", "digest_time": "19:00"}
    west = {"timezone": "Pacific/Pago_Pago", "digest_time": "19:00"}
    assert client.patch(zone, json=east, headers=user_a["headers"]).status_code == 200
    seed(owner_engine, user_a, 5, 10)  # six days, so the check-in below makes the seventh
    clock(10)  # 12:00 UTC is already the next day at UTC+14
    check_in(client, user_a, "gym")  # a module day too, so both counts are exercised
    body = client.get("/api/streaks", headers=user_a["headers"]).json()
    assert body["today"] == str(day(11))
    before = body["points"]
    assert before["earned"] == 7 + 10 + 1
    assert client.patch(zone, json=west, headers=user_a["headers"]).status_code == 200
    after = client.get("/api/streaks", headers=user_a["headers"]).json()
    assert after["today"] == str(day(10))  # the day already recorded is now in the future
    assert after["points"] == before


# ---------------------------------------------------------------- tenancy


def test_b_does_not_see_a_points_and_earns_its_own(client, user_a, user_b, clock, owner_engine):
    seed(owner_engine, user_a, 1, 7, "gym")
    clock(7)
    assert points(client, user_a)["earned"] > 0
    assert points(client, user_b) == {"balance": 0, "earned": 0, "spent": 0}
    check_in(client, user_b, "overall")
    assert points(client, user_b)["earned"] == 1
    assert points(client, user_a)["earned"] == 7 + 7 + 10 + 10


# ---------------------------------------------------------------- the name


def test_the_name_defaults_to_null_so_the_client_words_it(client, user_a):
    assert _prefs(client, user_a)["points_name"] is None


def test_the_name_is_trimmed_and_read_back(client, user_a):
    answer = _patch(client, user_a, {"points_name": "  Sparks  "})
    assert answer.status_code == 200, answer.text
    assert answer.json()["preferences"]["points_name"] == "Sparks"
    assert _prefs(client, user_a)["points_name"] == "Sparks"


def test_twenty_four_characters_are_fine_twenty_five_are_a_422(client, user_a):
    assert _patch(client, user_a, {"points_name": "x" * 24}).status_code == 200
    assert _patch(client, user_a, {"points_name": " " + "y" * 24 + " "}).status_code == 200
    assert _prefs(client, user_a)["points_name"] == "y" * 24
    answer = _patch(client, user_a, {"points_name": "z" * 25})
    assert answer.status_code == 422, answer.text
    assert _prefs(client, user_a)["points_name"] == "y" * 24


@pytest.mark.parametrize("empty", ["", "   ", "\t "])
def test_empty_falls_back_to_the_default(client, user_a, empty):
    _patch(client, user_a, {"points_name": "Sparks"})
    answer = _patch(client, user_a, {"points_name": empty})
    assert answer.status_code == 200, answer.text
    assert answer.json()["preferences"]["points_name"] is None
    assert _prefs(client, user_a)["points_name"] is None


@pytest.mark.parametrize(
    "bad", [5, True, ["a"], {"a": 1}, "a\nb", "a\x00b", "a\x07b", "a\u2028b", "a\u2029b"]
)
def test_a_name_that_is_not_plain_text_is_a_422_not_a_500(client, user_a, bad):
    answer = _patch(client, user_a, {"points_name": bad})
    assert answer.status_code == 422, answer.text
    assert _prefs(client, user_a)["points_name"] is None


@pytest.mark.parametrize("good", ["\u2764\ufe0f\u200d\U0001f525", "Mes\u00a0points", "Étincelles"])
def test_emoji_sequences_and_no_break_spaces_are_fine(client, user_a, good):
    answer = _patch(client, user_a, {"points_name": good})
    assert answer.status_code == 200, answer.text
    assert _prefs(client, user_a)["points_name"] == good


def test_a_stored_unusable_name_is_read_not_refused():
    from app.services.preferences import resolve

    assert resolve({"points_name": "x" * 99})["points_name"] is None
    assert resolve({"points_name": 7})["points_name"] is None
    assert resolve({"points_name": "  "})["points_name"] is None
    assert resolve({"points_name": " Sparks "})["points_name"] == "Sparks"


def test_changing_the_name_does_not_make_a_day_or_touch_points(client, user_a, clock, owner_engine):
    check_in(client, user_a, "gym")
    before = points(client, user_a)
    _patch(client, user_a, {"points_name": "Sparks"})
    assert points(client, user_a) == before
    with owner_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM activity_days")).scalar_one() == 1
