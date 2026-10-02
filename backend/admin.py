"""Make an account an admin, or stop it being one (AD-54).

    python admin.py grant you@example.com
    python admin.py revoke you@example.com
    python admin.py list

An admin may issue invites from the web client. Runs as the **owner** role: the API's
runtime role can read `users.is_admin` and has no grant to write it, so nothing reachable
over HTTP can make anyone an admin. Granting is a deliberate act by whoever holds the owner
credentials, like issuing an invite with `invite.py`.
"""

import argparse
import sys

from sqlalchemy import create_engine, text

from invite import owner_url


def set_admin(email: str, value: bool) -> int:
    engine = create_engine(owner_url())
    with engine.begin() as conn:
        result = conn.execute(
            text("UPDATE users SET is_admin = :v WHERE lower(email) = lower(btrim(:email))"),
            {"v": value, "email": email},
        )
    engine.dispose()
    if result.rowcount != 1:
        print(f"No account with the email {email!r}.")
        return 1
    print(f"{email}: {'admin' if value else 'not an admin'}.")
    return 0


def list_admins() -> int:
    engine = create_engine(owner_url())
    with engine.connect() as conn:
        emails = conn.execute(
            text("SELECT email FROM users WHERE is_admin ORDER BY email")
        ).scalars().all()
    engine.dispose()
    print("\n".join(emails) if emails else "No admins.")
    return 0


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (("grant", "make an account an admin"), ("revoke", "undo it")):
        cmd = sub.add_parser(name, help=help_text)
        cmd.add_argument("email")
    sub.add_parser("list", help="show every admin")

    args = parser.parse_args()
    if args.command == "list":
        return list_admins()
    return set_admin(args.email, args.command == "grant")


if __name__ == "__main__":
    sys.exit(main())
