"""Gym, rebuilt: timed and distance exercises, richer targets, sessions sent whole (Epic 42, AD-58).

- ``exercises.kind`` says what a set of it measures: ``reps``, ``duration`` (seconds) or
  ``distance`` (metres). Text plus CHECK rather than a Postgres enum: adding a fourth kind is then
  one constraint swap, not an ``ALTER TYPE`` that cannot run inside a transaction.
- ``routine_exercises`` gains the other targets, a rest, a note; and loses
  ``UNIQUE (routine_id, exercise_id)``, because an imported program may use one movement twice.
- ``workout_sets.reps`` becomes nullable; a set carries reps, seconds or metres — at least one,
  which one is required follows the exercise kind and is checked in ``services/gym.py``.
- ``workouts`` gains when it started and ended, and the ``client_ref`` the phone coined for it.
  ``UNIQUE (user_id, client_ref)`` makes ``POST /workouts/complete`` idempotent, scoped to the
  tenant so an ``ON CONFLICT`` never meets a row RLS hides. NULLs are distinct, so every workout
  written before this migration, and every one started the old way, needs no ref.

The tables are already protected and granted at table level (0014), so new columns need no grant.

Revision ID: 0035
Revises: 0034
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0035"
down_revision: str | None = "0034"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE exercises
            ADD COLUMN kind text NOT NULL DEFAULT 'reps',
            ADD CONSTRAINT exercises_kind_known CHECK (kind IN ('reps', 'duration', 'distance'))
        """
    )

    op.execute(
        """
        ALTER TABLE routine_exercises
            DROP CONSTRAINT routine_exercises_routine_exercise_key,
            ADD COLUMN target_seconds integer,
            ADD COLUMN target_distance_m integer,
            ADD COLUMN target_weight numeric(7, 2),
            ADD COLUMN rest_seconds integer,
            ADD COLUMN note varchar(200),
            ADD CONSTRAINT routine_exercises_seconds_range
                CHECK (target_seconds IS NULL OR target_seconds BETWEEN 1 AND 86400),
            ADD CONSTRAINT routine_exercises_distance_range
                CHECK (target_distance_m IS NULL OR target_distance_m BETWEEN 1 AND 1000000),
            ADD CONSTRAINT routine_exercises_weight_non_negative
                CHECK (target_weight IS NULL OR target_weight >= 0),
            ADD CONSTRAINT routine_exercises_rest_range
                CHECK (rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 3600)
        """
    )

    op.execute(
        """
        ALTER TABLE workout_sets
            ALTER COLUMN reps DROP NOT NULL,
            ADD COLUMN duration_seconds integer,
            ADD COLUMN distance_m integer,
            ADD CONSTRAINT workout_sets_duration_range
                CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 86400),
            ADD CONSTRAINT workout_sets_distance_range
                CHECK (distance_m IS NULL OR distance_m BETWEEN 1 AND 1000000),
            ADD CONSTRAINT workout_sets_has_measure
                CHECK (reps IS NOT NULL OR duration_seconds IS NOT NULL OR distance_m IS NOT NULL)
        """
    )

    op.execute(
        """
        ALTER TABLE workouts
            ADD COLUMN started_at timestamptz,
            ADD COLUMN ended_at timestamptz,
            ADD COLUMN client_ref uuid,
            ADD CONSTRAINT workouts_user_client_ref_key UNIQUE (user_id, client_ref),
            ADD CONSTRAINT workouts_ends_after_start
                CHECK (started_at IS NULL OR ended_at IS NULL OR ended_at >= started_at)
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE workouts
            DROP CONSTRAINT workouts_ends_after_start,
            DROP CONSTRAINT workouts_user_client_ref_key,
            DROP COLUMN client_ref,
            DROP COLUMN ended_at,
            DROP COLUMN started_at
        """
    )
    # A timed or distance set has no reps and cannot survive the old NOT NULL. Lossy, by
    # necessity: the old schema has nowhere to put it.
    op.execute("DELETE FROM workout_sets WHERE reps IS NULL")
    op.execute(
        """
        ALTER TABLE workout_sets
            DROP CONSTRAINT workout_sets_has_measure,
            DROP CONSTRAINT workout_sets_distance_range,
            DROP CONSTRAINT workout_sets_duration_range,
            DROP COLUMN distance_m,
            DROP COLUMN duration_seconds,
            ALTER COLUMN reps SET NOT NULL
        """
    )
    # Repeats were allowed; keep the first line of each (routine, exercise) so the old unique
    # key can come back.
    op.execute(
        """
        DELETE FROM routine_exercises AS r
        USING routine_exercises AS keep
        WHERE r.routine_id = keep.routine_id
          AND r.exercise_id = keep.exercise_id
          AND (r.position, r.id) > (keep.position, keep.id)
        """
    )
    op.execute(
        """
        ALTER TABLE routine_exercises
            DROP CONSTRAINT routine_exercises_rest_range,
            DROP CONSTRAINT routine_exercises_weight_non_negative,
            DROP CONSTRAINT routine_exercises_distance_range,
            DROP CONSTRAINT routine_exercises_seconds_range,
            DROP COLUMN note,
            DROP COLUMN rest_seconds,
            DROP COLUMN target_weight,
            DROP COLUMN target_distance_m,
            DROP COLUMN target_seconds,
            ADD CONSTRAINT routine_exercises_routine_exercise_key UNIQUE (routine_id, exercise_id)
        """
    )
    op.execute(
        """
        ALTER TABLE exercises
            DROP CONSTRAINT exercises_kind_known,
            DROP COLUMN kind
        """
    )
