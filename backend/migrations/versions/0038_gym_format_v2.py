"""Gym format v2: per-set targets, effort, tempo, supersets, warm-up sets (Epic 54, AD-67).

- ``routine_exercises.set_targets``: a JSON array of per-set targets (1-99). The flat
  ``target_*`` columns stay and are kept equal to the first working set by the service, so
  older readers work unchanged. The shape of each item is the schema's job; the database
  guards only "an array of 1-99".
- ``target_rpe`` (1-10 in halves) or ``target_rir`` (0-10), never both.
- ``tempo`` ("3-1-1-0": four digits or X), ``superset_group`` (1-99).
- ``workout_sets.is_warmup``: excluded from history aggregates by the service.

Both tables are already protected and granted at table level (0014), so new columns need no
grant.

Revision ID: 0038
Revises: 0037
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0038"
down_revision: str | None = "0037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        r"""
        ALTER TABLE routine_exercises
            ADD COLUMN set_targets jsonb,
            ADD COLUMN target_rpe numeric(3,1),
            ADD COLUMN target_rir smallint,
            ADD COLUMN tempo varchar(7),
            ADD COLUMN superset_group smallint,
            ADD CONSTRAINT routine_exercises_set_targets_shape
                CHECK (set_targets IS NULL OR (
                    jsonb_typeof(set_targets) = 'array'
                    AND jsonb_array_length(set_targets) BETWEEN 1 AND 99)),
            ADD CONSTRAINT routine_exercises_rpe_range
                CHECK (target_rpe IS NULL OR (
                    target_rpe BETWEEN 1 AND 10 AND target_rpe * 2 = floor(target_rpe * 2))),
            ADD CONSTRAINT routine_exercises_rir_range
                CHECK (target_rir IS NULL OR target_rir BETWEEN 0 AND 10),
            ADD CONSTRAINT routine_exercises_rpe_or_rir
                CHECK (target_rpe IS NULL OR target_rir IS NULL),
            ADD CONSTRAINT routine_exercises_tempo_shape
                CHECK (tempo IS NULL OR tempo ~ '^[0-9X]-[0-9X]-[0-9X]-[0-9X]$'),
            ADD CONSTRAINT routine_exercises_superset_range
                CHECK (superset_group IS NULL OR superset_group BETWEEN 1 AND 99)
        """
    )
    op.execute("ALTER TABLE workout_sets ADD COLUMN is_warmup boolean NOT NULL DEFAULT false")


def downgrade() -> None:
    op.execute("ALTER TABLE workout_sets DROP COLUMN is_warmup")
    op.execute(
        """
        ALTER TABLE routine_exercises
            DROP CONSTRAINT routine_exercises_superset_range,
            DROP CONSTRAINT routine_exercises_tempo_shape,
            DROP CONSTRAINT routine_exercises_rpe_or_rir,
            DROP CONSTRAINT routine_exercises_rir_range,
            DROP CONSTRAINT routine_exercises_rpe_range,
            DROP CONSTRAINT routine_exercises_set_targets_shape,
            DROP COLUMN superset_group,
            DROP COLUMN tempo,
            DROP COLUMN target_rir,
            DROP COLUMN target_rpe,
            DROP COLUMN set_targets
        """
    )
