"""Send each person their daily digest of what needs doing (Epic 18, Epic 36).

    python notify.py            # send to everyone whose digest time has come
    python notify.py --dry-run  # print what would be sent, send nothing

Run it **every 15 minutes** (``*/15 * * * *``). Each account chooses the local hour its
digest may go and the zone that hour is in (AD-52); a run sends to the devices whose local
time has reached it and that have not been told on their local today. A run at any other
moment sends nothing, which is what makes a frequent schedule safe.

Run by cron on the host, **not** by the API. A push has to be sent on a schedule, and this
deployment is one container: an in-process scheduler would die with it, run twice with two
replicas, and put network calls to an outside service inside a request. Cron is already how
backups run here, so this adds an entry rather than a component (AD-34).

Connects as the runtime role, one tenant at a time, so every read obeys row-level security
exactly as a request does — a notifier that bypassed RLS could tell one person what is in
another's fridge.

Sends at most one notification per device per (local) day. A reminder that arrives every
hour is a reminder nobody reads.
"""

import argparse
import datetime as dt
import os
import pathlib
import sys

from sqlalchemy import create_engine, text

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]


def owner_url() -> str:
    """The owner role, only to *list* which users exist — `users` is not readable otherwise.

    Everything about a user's data is then read as the runtime role under their tenancy.
    """
    url = os.environ.get("MIGRATION_DATABASE_URL")
    if not url:
        env_path = REPO_ROOT / ".env"
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                key, _, value = line.partition("=")
                if key.strip() == "MIGRATION_DATABASE_URL":
                    url = value.strip()
                    break
    if not url:
        raise SystemExit("MIGRATION_DATABASE_URL is not set.")
    return url


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="print, send nothing")
    args = parser.parse_args()

    from app.core.config import get_settings

    settings = get_settings()
    if not settings.push_enabled:
        print(
            "Push is not configured: set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and "
            "VAPID_SUBJECT. Nothing to do.",
            file=sys.stderr,
        )
        return 0

    from app.core.db import tenant_session
    from app.services import auth as auth_service
    from app.services import push as push_service

    now = dt.datetime.now(dt.UTC)
    owner = create_engine(owner_url())
    with owner.connect() as conn:
        user_ids = list(conn.execute(text("SELECT id FROM users ORDER BY created_at")).scalars())
    owner.dispose()

    sent = skipped = dropped = 0
    for user_id in user_ids:
        with tenant_session(user_id) as session:
            s, k, d = run_for(
                session, user_id, now, settings, push_service, auth_service, dry_run=args.dry_run
            )
            sent, skipped, dropped = sent + s, skipped + k, dropped + d

    print(f"sent {sent}, skipped {skipped} not due yet or already told, dropped {dropped} dead")
    return 0


def run_for(session, user_id, now, settings, push_service, auth_service, *, dry_run=False):
    """One account's share of a run: (sent, skipped, dropped). Split out so the tests can
    drive the whole decision — due or not, which local day, what is marked — without cron."""
    subscriptions = push_service.list_subscriptions(session, user_id)
    if not subscriptions:
        return 0, 0, 0
    profile = auth_service.read_profile(session, user_id)
    if profile is None:  # pragma: no cover — listed a moment ago by the owner role
        return 0, 0, 0

    due = [
        subscription
        for subscription in subscriptions
        if push_service.is_due(
            timezone=profile.timezone,
            digest_time=profile.digest_time,
            notified_on=subscription.notified_on,
            now=now,
        )
    ]
    if not due:
        return 0, len(subscriptions), 0

    today = push_service.local_now(profile.timezone, now).date()
    digest = push_service.digest(session, user_id, today=today)
    if digest.empty:
        return 0, 0, 0

    sent = dropped = 0
    payload = digest.payload()
    for subscription in due:
        if dry_run:
            print(f"would send to {subscription.endpoint[:48]}…: {digest.body}")
            sent += 1
            continue
        if push_service.send(settings, subscription, payload):
            push_service.mark_notified(session, subscription.id, today)
            sent += 1
        else:
            push_service.forget(session, subscription.endpoint)
            dropped += 1
    return sent, len(subscriptions) - len(due), dropped


if __name__ == "__main__":
    raise SystemExit(main())
