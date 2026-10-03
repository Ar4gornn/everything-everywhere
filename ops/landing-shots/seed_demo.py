"""Seed the two landing-page fixture accounts on the throwaway verify stack, then capture.

  demo@example.com     English, USD. Entries, stock and savings from backend/seed.py.
  demo-fr@example.com  French, EUR. Seeded only through the API with French names (seed.py
                       would put English categories and pots on a French page).

Only fixture data may appear in the shots. Each password is random per run, lives only in
this process, and is never printed or written. The tokens reach capture.mjs through its
environment.

Usage (stack from README.md already running on :8026):
    python ops/landing-shots/seed_demo.py            # from the repo root, backend venv python
"""

import datetime as dt
import json
import os
import secrets
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(os.environ.get("VERIFY_REPO", Path(__file__).resolve().parents[2]))
BACKEND = REPO / "backend"
VERIFY_DB = os.environ.get("VERIFY_DB", "ee_landing_verify")
BASE = os.environ.get("BASE", "http://localhost:8026")
EMAIL_EN = "demo@example.com"
EMAIL_FR = "demo-fr@example.com"

TODAY = dt.date.today()
START = (TODAY - dt.timedelta(days=24)).isoformat()


def read_dotenv() -> dict[str, str]:
    values: dict[str, str] = {}
    path = REPO / ".env"
    if not path.exists():  # a worktree without its own .env: use the main checkout's
        path = Path("C:/dev/PersoProject/MinimalBudget/.env")
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip()
    return values


def swap(url: str, database: str) -> str:
    return f"{url.rpartition('/')[0]}/{database}"


def call(method: str, path: str, body: dict | None = None, token: str | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as res:
            raw = res.read()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as err:
        return err.code, None


def must(status_ok: set[int], what: str, result):
    status, body = result
    if status not in status_ok:
        raise SystemExit(f"{what}: HTTP {status}")
    return body


def day_ago(n: int) -> str:
    return (TODAY - dt.timedelta(days=n)).isoformat()


def habits_and_mood(token: str, habits, mood_notes) -> None:
    made = 0
    for name, body, offsets in habits:
        status, habit = call("POST", "/api/habits",
                             {"name": name, "started_on": START, **body}, token)
        if status != 201:
            print(f"habit {name}: {status}", file=sys.stderr)
            continue
        for off in offsets:
            s, _ = call("POST", f"/api/habits/{habit['id']}/checkins",
                        {"done_on": day_ago(off)}, token)
            made += s == 201
    print(f"check-ins made: {made}")
    for off, mood in zip([4, 3, 2, 1, 0], [3, 4, 4, 3, 5], strict=True):
        s, _ = call("PUT", f"/api/mood/days/{day_ago(off)}",
                    {"mood": mood, "day_ok": True, "note": mood_notes[off]}, token)
        if s != 200:
            print(f"mood {day_ago(off)}: {s}", file=sys.stderr)
    s, _ = call("PATCH", "/api/auth/me/tutorial", {"outcome": "skipped"}, token)
    print(f"tutorial skipped: {s}")


def weekday_offsets(days: tuple[int, ...], skip: int) -> list[int]:
    return [o for o in range(1, 22)
            if (TODAY - dt.timedelta(days=o)).weekday() in days and o != skip]


def seed_english() -> tuple[str, str]:
    password = secrets.token_urlsafe(18)
    sys.argv = ["seed.py", "--email", EMAIL_EN, f"--password={password}"]  # "=": may start with "-"
    import seed  # noqa: PLC0415

    if seed.main() != 0:
        raise SystemExit("seed.py failed")
    tokens = must({200}, "login en", call("POST", "/api/auth/login",
                                          {"email": EMAIL_EN, "password": password}))
    access = tokens["access_token"]
    habits_and_mood(
        access,
        [
            ("Read 20 pages", {"schedule_kind": "daily"},
             [o for o in range(1, 22) if o % 7 != 4]),
            ("Walk", {"schedule_kind": "times_per_week", "target_count": 4},
             [1, 2, 4, 6, 8, 9, 11, 13, 15, 16, 18, 20]),
            ("Stretch", {"schedule_kind": "weekdays", "weekdays": 21},
             weekday_offsets((0, 2, 4), 9)),
            ("Water the plants", {"schedule_kind": "every_n_days", "interval_days": 3},
             [3, 6, 9, 12, 15, 18, 21]),
        ],
        {4: "Slow start, good evening", 3: None, 2: "Long walk after work", 1: None,
         0: "Quiet day"},
    )
    return access, tokens["refresh_token"]


# French account: (category, monthly budget, [amount per month, current month last])
FR_EXPENSES = [
    ("Loyer", "950.00", ["950.00", "950.00", "950.00", "950.00"]),
    ("Courses", "380.00", ["352.10", "391.40", "366.75", "372.40"]),
    ("Restaurants", "160.00", ["171.20", "148.60", "184.90", "198.75"]),
    ("Carburant", "70.00", ["58.30", "66.90", "61.40", "64.20"]),
    ("Transports", "120.00", ["94.50", "112.00", "88.75", "101.40"]),
    ("Énergie", "150.00", ["143.10", "138.65", "129.40", "129.40"]),
    # Budgeted and not spent on: still shows at zero.
    ("Sport", "45.00", ["0.00", "0.00", "0.00", "0.00"]),
]
FR_POTS = [  # name, goal, goal months ahead, monthly proposal, deposits oldest first
    ("Vacances", "1800.00", 8, "200.00", ["200.00", "200.00", "250.00", "200.00"]),
    ("Projet", "5000.00", 18, "400.00", ["400.00", "400.00", "300.00", "400.00"]),
    ("Fonds d'urgence", "3000.00", 14, "150.00", ["150.00", "150.00", "150.00", "150.00"]),
]


def month_start(back: int) -> dt.date:
    y, m = TODAY.year, TODAY.month - back
    while m < 1:
        y, m = y - 1, m + 12
    return dt.date(y, m, 1)


def occurred(back: int, day: int) -> str:
    if back == 0:  # never in the future
        return dt.date(TODAY.year, TODAY.month, min(day, TODAY.day)).isoformat()
    return month_start(back).replace(day=day).isoformat()


def seed_french() -> tuple[str, str]:
    password = secrets.token_urlsafe(18)
    must({201}, "register fr", call("POST", "/api/auth/register", {
        "email": EMAIL_FR, "password": password, "currency": "EUR", "language": "fr"}))
    tokens = must({200}, "login fr", call("POST", "/api/auth/login",
                                          {"email": EMAIL_FR, "password": password}))
    access = tokens["access_token"]

    def post(path: str, body: dict):
        return must({200, 201}, path, call("POST", path, body, access))

    # Entries: income, then each expense. A new category name creates the category.
    for back in (3, 2, 1, 0):
        post("/api/entries", {"kind": "income", "category_name": "Salaire",
                              "amount": "2850.00", "occurred_on": occurred(back, 2)})
        if back > 0:
            post("/api/entries", {"kind": "income", "category_name": "Freelance",
                                  "amount": "380.00", "occurred_on": occurred(back, 12)})
        for name, _budget, amounts in FR_EXPENSES:
            amount = amounts[3 - back]
            if amount == "0.00":
                continue
            post("/api/entries", {"kind": "expense", "category_name": name, "amount": amount,
                                  "occurred_on": occurred(back, 3 if name != "Loyer" else 1)})
    cats = must({200}, "categories", call("GET", "/api/categories?kind=expense", None, access))
    by_name = {c["name"]: c["id"] for c in cats["items"]}
    for name, budget, _ in FR_EXPENSES:
        if name not in by_name:  # Sport has no entry, so no category yet
            made = post("/api/categories", {"kind": "expense", "name": name})
            by_name[name] = made["id"]
        must({200}, f"budget {name}", call("PUT", f"/api/budgets/{by_name[name]}",
                                           {"monthly_amount": budget}, access))

    # Savings: the English default pots created at registration go, French ones replace them.
    types = must({200}, "types", call("GET", "/api/savings/types", None, access))
    for t in types["items"]:
        must({204}, f"delete pot {t['name']}",
             call("DELETE", f"/api/savings/types/{t['id']}", None, access))
    for name, goal, months, monthly, deposits in FR_POTS:
        pot = post("/api/savings/types", {"name": name})
        goal_date = (TODAY + dt.timedelta(days=30 * months)).isoformat()
        must({200}, f"goal {name}", call("PATCH", f"/api/savings/types/{pot['id']}",
                                         {"goal_amount": goal, "goal_date": goal_date}, access))
        must({200}, f"target {name}", call("PUT", f"/api/savings/targets/{pot['id']}",
                                           {"monthly_amount": monthly}, access))
        for back in (3, 2, 1, 0):
            post("/api/savings/contributions", {
                "savings_type_id": pot["id"], "kind": "deposit",
                "amount": deposits[3 - back], "occurred_on": occurred(back, 4)})

    # Stock.
    for space, items in [
        ("Frigo", [("Lait", 0, 1, "1.20"), ("Œufs", 6, 2, "3.10"), ("Beurre", 1, 1, "2.60")]),
        ("Garage", [("Huile moteur", 1, None, "22.00"), ("Lave-glace", 2, 1, "4.20")]),
        ("Maison", [("Papier toilette", 2, 4, "11.00"), ("Piles AA", 8, 4, "8.90")]),
    ]:
        for name, qty, below, cost in items:
            body = {"name": name, "quantity": qty, "cost": cost, "space_name": space}
            if below is not None:
                body["restock_below"] = below
            post("/api/inventory/items", body)

    habits_and_mood(
        access,
        [
            ("Lire 20 pages", {"schedule_kind": "daily"},
             [o for o in range(1, 22) if o % 7 != 4]),
            ("Marcher", {"schedule_kind": "times_per_week", "target_count": 4},
             [1, 2, 4, 6, 8, 9, 11, 13, 15, 16, 18, 20]),
            ("Étirements", {"schedule_kind": "weekdays", "weekdays": 21},
             weekday_offsets((0, 2, 4), 9)),
            ("Arroser les plantes", {"schedule_kind": "every_n_days", "interval_days": 3},
             [3, 6, 9, 12, 15, 18, 21]),
        ],
        {4: "Début lent, bonne soirée", 3: None, 2: "Longue marche après le travail", 1: None,
         0: "Journée calme"},
    )
    return access, tokens["refresh_token"]


def main() -> int:
    env = read_dotenv()
    os.environ["DATABASE_URL"] = swap(env["DATABASE_URL"], VERIFY_DB)
    os.environ["MIGRATION_DATABASE_URL"] = swap(env["MIGRATION_DATABASE_URL"], VERIFY_DB)
    os.environ["ALLOW_SEED"] = "1"
    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))

    access_en, refresh_en = seed_english()
    access_fr, refresh_fr = seed_french()

    shots = Path(__file__).resolve().parent
    child = dict(os.environ, BASE=BASE, EE_ACCESS_EN=access_en, EE_REFRESH_EN=refresh_en,
                 EE_ACCESS_FR=access_fr, EE_REFRESH_FR=refresh_fr)
    return subprocess.call(["node", str(shots / "capture.mjs")], env=child, cwd=REPO)


if __name__ == "__main__":
    raise SystemExit(main())
