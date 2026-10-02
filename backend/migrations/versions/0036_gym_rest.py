"""Gym rest: rest days, and rest after an exercise (Epic 43, AD-59).

- ``workouts.rest_day``: a rest day is a workout with no sets, so it rides the outbox, history,
  the calendar and the activity day a session already has. A partial unique index keeps it to
  one per date per person, which makes "rest day today" idempotent by day as well as by
  ``client_ref``. Scoped to ``user_id`` like every key here, so an ``ON CONFLICT`` never meets a
  row RLS hides.
- ``routine_exercises.rest_after_seconds``: the rest after an exercise's last set, before the
  next exercise — a plan attribute, separate from the rest between sets.

Both tables are already protected and granted at table level (0014), so no grant is needed.

Revision ID: 0036
Revises: 0035
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0036"
down_revision: str | None = "0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE workouts ADD COLUMN rest_day boolean NOT NULL DEFAULT false")
    op.execute(
        """
        CREATE UNIQUE INDEX workouts_one_rest_day_per_date
            ON workouts (user_id, performed_on) WHERE rest_day
        """
    )
    op.execute(
        """
        ALTER TABLE routine_exercises
            ADD COLUMN rest_after_seconds integer,
            ADD CONSTRAINT routine_exercises_rest_after_range
                CHECK (rest_after_seconds IS NULL OR rest_after_seconds BETWEEN 0 AND 3600)
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE routine_exercises
            DROP CONSTRAINT routine_exercises_rest_after_range,
            DROP COLUMN rest_after_seconds
        """
    )
    op.execute("DROP INDEX workouts_one_rest_day_per_date")
    # Rest days have no sets and no meaning without the flag; they go with it.
    op.execute("DELETE FROM workouts WHERE rest_day")
    op.execute("ALTER TABLE workouts DROP COLUMN rest_day")
