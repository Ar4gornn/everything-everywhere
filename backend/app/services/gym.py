"""Exercises, routines and workout logs (Epic 19).

A module beside the ledger and the inventory, not inside either (AD-31): it imports its own
models and `users` and nothing else. Nothing here commits (AD-4).
"""

import datetime as dt
import uuid
from decimal import Decimal
from urllib.parse import urlparse

from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import Conflict, Invalid, NotFound
from app.core.months import DEFAULT_START_DAY, month_range
from app.models.gym import Exercise, Routine, RoutineExercise, Workout, WorkoutSet

# Where a form-check video may point. https only, and no credentials in the URL: the link is
# rendered as an anchor a person clicks, so `javascript:` must never reach the DOM and a
# "user:password@" URL must never be shown to someone who would click it. Checked here as
# well as by the database CHECK, because a helpful message beats a constraint violation.
_ALLOWED_SCHEMES = ("https",)


def clean_video_url(raw: str | None) -> str | None:
    if raw is None:
        return None
    url = raw.strip()
    if not url:
        return None
    parsed = urlparse(url)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise Invalid("a video link must start with https://", "video_link_not_https")
    if not parsed.netloc or "@" in parsed.netloc:
        raise Invalid("that does not look like a video link", "video_link_invalid")
    return url


# ----------------------------------------------------------------- exercises


def list_exercises(session: Session, user_id: uuid.UUID) -> list[Exercise]:
    return list(
        session.execute(
            select(Exercise)
            .where(Exercise.user_id == user_id)
            .order_by(func.lower(Exercise.name), Exercise.id)
        ).scalars()
    )


KINDS = ("reps", "duration", "distance")

# The measure each kind requires on a set. The others are refused (weight is free for all).
_REQUIRED_MEASURE = {"reps": "reps", "duration": "duration_seconds", "distance": "distance_m"}


def check_measures(
    kind: str, *, reps: int | None, duration_seconds: int | None, distance_m: int | None
) -> None:
    """A set of a ``reps`` exercise carries reps, of a ``duration`` one seconds, of a
    ``distance`` one metres - that one, and only that one (weight is separate and optional)."""
    given = {"reps": reps, "duration_seconds": duration_seconds, "distance_m": distance_m}
    required = _REQUIRED_MEASURE[kind]
    if given[required] is None:
        raise Invalid(f"a {kind} set needs {required}", "set_missing_measure")
    if any(value is not None for name, value in given.items() if name != required):
        raise Invalid(f"a {kind} set takes only {required} (and a weight)", "set_wrong_measure")


def reconcile_measures(
    kind: str, *, reps: int | None, duration_seconds: int | None, distance_m: int | None
) -> dict[str, int | None]:
    """For a session sent whole: the person's record wins over the plan.

    An exercise's kind can change between the phone starting a session and the phone sending
    it (the kind was edited, or the routine was re-imported). Refusing the whole session for
    that would lose a workout that really happened, so here a set that carries the kind's
    required measure keeps only that one, and a set that lacks it is stored as it came as
    long as it holds some measure (the table's CHECK only asks for one). A set with no
    measure at all is still refused. The single-set endpoint stays strict.
    """
    given = {"reps": reps, "duration_seconds": duration_seconds, "distance_m": distance_m}
    required = _REQUIRED_MEASURE[kind]
    if given[required] is not None:
        return {name: (value if name == required else None) for name, value in given.items()}
    if all(value is None for value in given.values()):
        check_measures(kind, reps=None, duration_seconds=None, distance_m=None)  # raises
    return given


def get_or_create_exercise(
    session: Session, user_id: uuid.UUID, *, name: str, kind: str = "reps"
) -> Exercise:
    """AD-12, the same shape as categories and vendors: insert-or-return, never check-then-act.

    ``kind`` applies only to a new exercise: an existing one keeps the kind it has.
    """
    inserted = session.execute(
        text(
            """
            INSERT INTO exercises (user_id, name, kind)
            VALUES (:uid, :name, :kind)
            ON CONFLICT (user_id, lower(name)) DO NOTHING
            RETURNING id
            """
        ),
        {"uid": str(user_id), "name": name, "kind": kind},
    ).scalar_one_or_none()

    if inserted is None:
        existing = session.execute(
            select(Exercise).where(
                Exercise.user_id == user_id, func.lower(Exercise.name) == name.lower()
            )
        ).scalar_one_or_none()
        if existing is None:  # pragma: no cover — would mean the unique index disagrees
            raise Conflict("exercise could not be created or found", "exercise_unwritable")
        return existing

    session.expire_all()
    exercise = session.get(Exercise, inserted)
    if exercise is None:  # pragma: no cover
        raise Conflict("exercise was inserted but is not readable", "exercise_unreadable")
    return exercise


def get_exercise(session: Session, user_id: uuid.UUID, exercise_id: uuid.UUID) -> Exercise:
    exercise = session.execute(
        select(Exercise).where(Exercise.user_id == user_id, Exercise.id == exercise_id)
    ).scalar_one_or_none()
    if exercise is None:
        raise NotFound("No exercise with that id")
    return exercise


def update_exercise(
    session: Session, user_id: uuid.UUID, exercise_id: uuid.UUID, fields: dict
) -> Exercise:
    exercise = get_exercise(session, user_id, exercise_id)
    if fields.get("kind") is not None and fields["kind"] != exercise.kind:
        logged = session.execute(
            select(func.count())
            .select_from(WorkoutSet)
            .where(WorkoutSet.user_id == user_id, WorkoutSet.exercise_id == exercise.id)
        ).scalar_one()
        if logged:
            raise Conflict(
                "That exercise has logged sets, so its kind can no longer change",
                "exercise_kind_locked",
            )
        exercise.kind = fields["kind"]
    if "name" in fields and fields["name"]:
        exercise.name = fields["name"]
    if "video_url" in fields:
        exercise.video_url = clean_video_url(fields["video_url"])
    if "note" in fields:
        exercise.note = fields["note"]
    try:
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        raise Conflict(
            "You already have an exercise with that name", "exercise_name_taken"
        ) from exc
    return exercise


def delete_exercise(session: Session, user_id: uuid.UUID, exercise_id: uuid.UUID) -> None:
    try:
        result = session.execute(
            delete(Exercise).where(Exercise.user_id == user_id, Exercise.id == exercise_id)
        )
    except IntegrityError as exc:
        # AD-21: RESTRICT. Deleting it would empty routines and orphan a training history.
        session.rollback()
        raise Conflict(
            "That exercise is still used by a routine or a logged set", "exercise_in_use"
        ) from exc
    if result.rowcount == 0:
        raise NotFound("No exercise with that id")


# ------------------------------------------------------------------ routines


def list_routines(session: Session, user_id: uuid.UUID) -> list[Routine]:
    return list(
        session.execute(
            select(Routine)
            .where(Routine.user_id == user_id)
            .order_by(func.lower(Routine.name), Routine.id)
        ).scalars()
    )


def get_routine(session: Session, user_id: uuid.UUID, routine_id: uuid.UUID) -> Routine:
    routine = session.execute(
        select(Routine).where(Routine.user_id == user_id, Routine.id == routine_id)
    ).scalar_one_or_none()
    if routine is None:
        raise NotFound("No routine with that id")
    return routine


def create_routine(session: Session, user_id: uuid.UUID, *, name: str, note: str | None) -> Routine:
    routine = Routine(user_id=user_id, name=name, note=note)
    session.add(routine)
    try:
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        raise Conflict("You already have a routine with that name", "routine_name_taken") from exc
    return routine


def update_routine(
    session: Session, user_id: uuid.UUID, routine_id: uuid.UUID, fields: dict
) -> Routine:
    routine = get_routine(session, user_id, routine_id)
    if fields.get("name"):
        routine.name = fields["name"].strip() or routine.name
    if "note" in fields:
        routine.note = fields["note"]
    try:
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        raise Conflict("You already have a routine with that name", "routine_name_taken") from exc
    return routine


def delete_routine(session: Session, user_id: uuid.UUID, routine_id: uuid.UUID) -> None:
    get_routine(session, user_id, routine_id)
    # Lines cascade; workouts done from it survive with a null routine_id, because what
    # happened is a record and the plan it came from is not.
    session.execute(delete(Routine).where(Routine.user_id == user_id, Routine.id == routine_id))
    session.flush()


def routine_lines(
    session: Session, user_id: uuid.UUID, routine_id: uuid.UUID
) -> list[tuple[RoutineExercise, Exercise]]:
    get_routine(session, user_id, routine_id)
    rows = session.execute(
        select(RoutineExercise, Exercise)
        .join(Exercise, Exercise.id == RoutineExercise.exercise_id)
        .where(RoutineExercise.user_id == user_id, RoutineExercise.routine_id == routine_id)
        .order_by(RoutineExercise.position, RoutineExercise.id)
    ).all()
    return [(line, exercise) for line, exercise in rows]


def routines_full(
    session: Session, user_id: uuid.UUID
) -> list[tuple[Routine, list[tuple[RoutineExercise, Exercise]]]]:
    """Every routine with its lines - two queries, for the offline cache."""
    routines = list_routines(session, user_id)
    grouped: dict[uuid.UUID, list[tuple[RoutineExercise, Exercise]]] = {r.id: [] for r in routines}
    rows = session.execute(
        select(RoutineExercise, Exercise)
        .join(
            Exercise,
            (Exercise.user_id == RoutineExercise.user_id)
            & (Exercise.id == RoutineExercise.exercise_id),
        )
        .where(RoutineExercise.user_id == user_id)
        .order_by(RoutineExercise.routine_id, RoutineExercise.position, RoutineExercise.id)
    ).all()
    for line, exercise in rows:
        grouped[line.routine_id].append((line, exercise))
    return [(routine, grouped[routine.id]) for routine in routines]


_SET_MEASURE = {"reps": "reps", "duration": "seconds", "distance": "distance_m"}


def normalise_set_targets(kind: str, set_targets: list[dict]) -> tuple[list[dict], dict]:
    """Per-set targets -> (the JSON to store, the flat fields that mirror them) (Epic 54).

    Only the measure matching the exercise's kind may be set on a set. The flat fields are the
    first non-warm-up set's (the first set's when all are warm-ups), ``target_sets`` the length,
    so GymCard, the prompt context and the session fallback keep reading the flat columns.
    """
    own = _SET_MEASURE[kind]
    stored: list[dict] = []
    for item in set_targets:
        foreign = [m for m in ("reps", "seconds", "distance_m") if m != own and item.get(m)]
        if foreign:
            raise Invalid(
                f"a {kind} exercise takes only {own} per set, not {foreign[0]}",
                "set_target_wrong_measure",
            )
        weight = item.get("weight")
        stored.append(
            {
                "reps": item.get("reps"),
                "seconds": item.get("seconds"),
                "distance_m": item.get("distance_m"),
                "weight": None if weight is None else f"{Decimal(weight):.2f}",
                "warmup": bool(item.get("warmup", False)),
            }
        )
    lead = next((t for t in stored if not t["warmup"]), stored[0])
    flat = {
        "target_sets": len(stored),
        "target_reps": lead["reps"],
        "target_seconds": lead["seconds"],
        "target_distance_m": lead["distance_m"],
        "target_weight": None if lead["weight"] is None else Decimal(lead["weight"]),
    }
    return stored, flat


def _rpe_value(value: object) -> Decimal | None:
    return None if value is None else Decimal(str(value))


_FLAT_TARGETS = (
    "target_sets",
    "target_reps",
    "target_seconds",
    "target_distance_m",
    "target_weight",
    "rest_seconds",
    "rest_after_seconds",
    "note",
)
_LINE_FIELDS = (
    *_FLAT_TARGETS,
    "set_targets",
    "target_rpe",
    "target_rir",
    "tempo",
    "superset_group",
)


def _line_values(kind: str, values: dict) -> dict:
    """Every column a new routine line carries, normalised (create and import)."""
    out = {key: values.get(key) for key in _LINE_FIELDS}
    if out["set_targets"] is not None:
        out["set_targets"], flat = normalise_set_targets(kind, out["set_targets"])
        out.update(flat)
    out["target_rpe"] = _rpe_value(out["target_rpe"])
    return out


def _next_position(session: Session, user_id: uuid.UUID, routine_id: uuid.UUID) -> int:
    highest = session.execute(
        select(func.max(RoutineExercise.position)).where(
            RoutineExercise.user_id == user_id, RoutineExercise.routine_id == routine_id
        )
    ).scalar_one()
    return 0 if highest is None else highest + 1


def add_routine_line(
    session: Session,
    user_id: uuid.UUID,
    routine_id: uuid.UUID,
    *,
    exercise_id: uuid.UUID | None,
    exercise_name: str | None,
    kind: str | None = None,
    target_sets: int | None = None,
    target_reps: int | None = None,
    target_seconds: int | None = None,
    target_distance_m: int | None = None,
    target_weight: Decimal | None = None,
    rest_seconds: int | None = None,
    rest_after_seconds: int | None = None,
    note: str | None = None,
    set_targets: list[dict] | None = None,
    target_rpe: float | None = None,
    target_rir: int | None = None,
    tempo: str | None = None,
    superset_group: int | None = None,
) -> tuple[RoutineExercise, Exercise]:
    get_routine(session, user_id, routine_id)
    if exercise_name is not None:
        exercise = get_or_create_exercise(
            session, user_id, name=exercise_name, kind=kind or "reps"
        )
    else:
        assert exercise_id is not None  # the schema's exactly-one rule guarantees it
        exercise = get_exercise(session, user_id, exercise_id)

    # Appended: the next position after whatever is there, so order is explicit and stable.
    line = RoutineExercise(
        user_id=user_id,
        routine_id=routine_id,
        exercise_id=exercise.id,
        position=_next_position(session, user_id, routine_id),
        **_line_values(
            exercise.kind,
            {
                "target_sets": target_sets,
                "target_reps": target_reps,
                "target_seconds": target_seconds,
                "target_distance_m": target_distance_m,
                "target_weight": target_weight,
                "rest_seconds": rest_seconds,
                "rest_after_seconds": rest_after_seconds,
                "note": note,
                "set_targets": set_targets,
                "target_rpe": target_rpe,
                "target_rir": target_rir,
                "tempo": tempo,
                "superset_group": superset_group,
            },
        ),
    )
    session.add(line)
    session.flush()
    return line, exercise


def update_routine_line(
    session: Session, user_id: uuid.UUID, line_id: uuid.UUID, fields: dict
) -> tuple[RoutineExercise, Exercise]:
    """Explicit null clears a target, an absent key leaves it."""
    row = session.execute(
        select(RoutineExercise, Exercise)
        .join(
            Exercise,
            (Exercise.user_id == RoutineExercise.user_id)
            & (Exercise.id == RoutineExercise.exercise_id),
        )
        .where(RoutineExercise.user_id == user_id, RoutineExercise.id == line_id)
    ).one_or_none()
    if row is None:
        raise NotFound("No routine line with that id")
    line, exercise = row
    fields = dict(fields)
    if fields.get("set_targets") is not None:
        fields["set_targets"], flat = normalise_set_targets(exercise.kind, fields["set_targets"])
        fields.update(flat)
    if "target_rpe" in fields:
        fields["target_rpe"] = _rpe_value(fields["target_rpe"])
    for key in _LINE_FIELDS:
        if key in fields:
            setattr(line, key, fields[key])
    if line.target_rpe is not None and line.target_rir is not None:
        raise Invalid("give an RPE or an RIR, not both", "effort_rpe_and_rir")
    session.flush()
    return line, exercise


def reorder_routine_lines(
    session: Session, user_id: uuid.UUID, routine_id: uuid.UUID, line_ids: list[uuid.UUID]
) -> None:
    """``line_ids`` must be exactly the routine's lines; positions become 0..n-1."""
    get_routine(session, user_id, routine_id)
    lines = list(
        session.execute(
            select(RoutineExercise).where(
                RoutineExercise.user_id == user_id, RoutineExercise.routine_id == routine_id
            )
        ).scalars()
    )
    if len(line_ids) != len(set(line_ids)) or set(line_ids) != {line.id for line in lines}:
        raise Invalid("line_ids must list every line of the routine exactly once", "order_mismatch")
    by_id = {line.id: line for line in lines}
    for position, line_id in enumerate(line_ids):
        by_id[line_id].position = position
    session.flush()


def import_routine(
    session: Session,
    user_id: uuid.UUID,
    *,
    name: str,
    note: str | None,
    lines: list[dict],
) -> Routine:
    """One routine and its lines, exercises found or coined by name. All or nothing: the kinds
    are checked against existing exercises before anything is written, and the request
    transaction rolls back on any later refusal."""
    names = {line["exercise_name"].lower() for line in lines}
    existing = {
        e.name.lower(): e
        for e in session.execute(
            select(Exercise).where(
                Exercise.user_id == user_id, func.lower(Exercise.name).in_(names)
            )
        ).scalars()
    }
    coined: dict[str, str] = {}
    for line in lines:
        key = line["exercise_name"].lower()
        have = existing[key].kind if key in existing else coined.setdefault(key, line["kind"])
        if have != line["kind"]:
            raise Invalid(
                f"{line['exercise_name']!r} is a {have} exercise, not a {line['kind']} one",
                "exercise_kind_mismatch",
            )
    routine = create_routine(session, user_id, name=name, note=note)
    for position, line in enumerate(lines):
        exercise = get_or_create_exercise(
            session, user_id, name=line["exercise_name"], kind=line["kind"]
        )
        if line.get("video_url") and exercise.video_url is None:
            exercise.video_url = clean_video_url(line["video_url"])
        session.add(
            RoutineExercise(
                user_id=user_id,
                routine_id=routine.id,
                exercise_id=exercise.id,
                position=position,
                **_line_values(exercise.kind, line),
            )
        )
    session.flush()
    return routine


def remove_routine_line(session: Session, user_id: uuid.UUID, line_id: uuid.UUID) -> None:
    result = session.execute(
        delete(RoutineExercise).where(
            RoutineExercise.user_id == user_id, RoutineExercise.id == line_id
        )
    )
    if result.rowcount == 0:
        raise NotFound("No routine line with that id")
    session.flush()


# ------------------------------------------------------------------ workouts


def list_workouts(
    session: Session,
    user_id: uuid.UUID,
    *,
    limit: int = 30,
    month: str | None = None,
    start_day: int = DEFAULT_START_DAY,
) -> list[Workout]:
    query = select(Workout).where(Workout.user_id == user_id)
    if month is not None:
        start, end = month_range(month, start_day)
        query = query.where(Workout.performed_on >= start, Workout.performed_on < end)
    query = query.order_by(
        Workout.performed_on.desc(), Workout.created_at.desc(), Workout.id
    ).limit(limit)
    return list(session.execute(query).scalars())


def get_workout(session: Session, user_id: uuid.UUID, workout_id: uuid.UUID) -> Workout:
    workout = session.execute(
        select(Workout).where(Workout.user_id == user_id, Workout.id == workout_id)
    ).scalar_one_or_none()
    if workout is None:
        raise NotFound("No workout with that id")
    return workout


def recent_workouts(
    session: Session, user_id: uuid.UUID, *, limit: int
) -> list[tuple[Workout, list[tuple[WorkoutSet, Exercise]]]]:
    """The newest sessions with their sets, in two queries (feeds the AI prompt context)."""
    workouts = list(
        session.execute(
            select(Workout)
            .where(Workout.user_id == user_id)
            .order_by(Workout.performed_on.desc(), Workout.created_at.desc(), Workout.id)
            .limit(limit)
        ).scalars()
    )
    grouped: dict[uuid.UUID, list[tuple[WorkoutSet, Exercise]]] = {w.id: [] for w in workouts}
    if workouts:
        rows = session.execute(
            select(WorkoutSet, Exercise)
            .join(
                Exercise,
                (Exercise.user_id == WorkoutSet.user_id) & (Exercise.id == WorkoutSet.exercise_id),
            )
            .where(WorkoutSet.user_id == user_id, WorkoutSet.workout_id.in_(list(grouped)))
            .order_by(WorkoutSet.workout_id, WorkoutSet.position, WorkoutSet.id)
        ).all()
        for row, exercise in rows:
            grouped[row.workout_id].append((row, exercise))
    return [(w, grouped[w.id]) for w in workouts]


def start_workout(
    session: Session,
    user_id: uuid.UUID,
    *,
    performed_on: dt.date,
    routine_id: uuid.UUID | None,
    note: str | None,
) -> Workout:
    """Start a session, optionally from a routine.

    Starting from a routine does **not** copy its lines into sets: a target is not a record.
    The client reads the routine to prefill the form, and a set exists once it was done.
    """
    if routine_id is not None:
        get_routine(session, user_id, routine_id)
    workout = Workout(user_id=user_id, performed_on=performed_on, routine_id=routine_id, note=note)
    session.add(workout)
    session.flush()
    return workout


def delete_workout(session: Session, user_id: uuid.UUID, workout_id: uuid.UUID) -> None:
    result = session.execute(
        delete(Workout).where(Workout.user_id == user_id, Workout.id == workout_id)
    )
    if result.rowcount == 0:
        raise NotFound("No workout with that id")
    session.flush()


def workout_sets(
    session: Session, user_id: uuid.UUID, workout_id: uuid.UUID
) -> list[tuple[WorkoutSet, Exercise]]:
    get_workout(session, user_id, workout_id)
    rows = session.execute(
        select(WorkoutSet, Exercise)
        .join(Exercise, Exercise.id == WorkoutSet.exercise_id)
        .where(WorkoutSet.user_id == user_id, WorkoutSet.workout_id == workout_id)
        .order_by(WorkoutSet.position, WorkoutSet.id)
    ).all()
    return [(row, exercise) for row, exercise in rows]


def log_set(
    session: Session,
    user_id: uuid.UUID,
    workout_id: uuid.UUID,
    *,
    exercise_id: uuid.UUID | None,
    exercise_name: str | None,
    reps: int | None,
    weight: Decimal | None,
    kind: str | None = None,
    duration_seconds: int | None = None,
    distance_m: int | None = None,
    is_warmup: bool = False,
) -> WorkoutSet:
    get_workout(session, user_id, workout_id)
    if exercise_name is not None:
        exercise = get_or_create_exercise(
            session, user_id, name=exercise_name, kind=kind or "reps"
        )
    else:
        assert exercise_id is not None
        exercise = get_exercise(session, user_id, exercise_id)
    check_measures(
        exercise.kind, reps=reps, duration_seconds=duration_seconds, distance_m=distance_m
    )

    highest = session.execute(
        select(func.max(WorkoutSet.position)).where(
            WorkoutSet.user_id == user_id, WorkoutSet.workout_id == workout_id
        )
    ).scalar_one()
    row = WorkoutSet(
        user_id=user_id,
        workout_id=workout_id,
        exercise_id=exercise.id,
        position=0 if highest is None else highest + 1,
        reps=reps,
        weight=weight,
        duration_seconds=duration_seconds,
        distance_m=distance_m,
        is_warmup=is_warmup,
    )
    session.add(row)
    session.flush()
    return row


def _existing_rest_day(
    session: Session, user_id: uuid.UUID, client_ref: uuid.UUID, performed_on: dt.date
) -> Workout | None:
    """The workout this ref already wrote, else that date's rest day (AD-59)."""
    return session.execute(
        select(Workout)
        .where(
            Workout.user_id == user_id,
            (Workout.client_ref == client_ref)
            | ((Workout.rest_day.is_(True)) & (Workout.performed_on == performed_on)),
        )
        .order_by((Workout.client_ref == client_ref).desc())
        .limit(1)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def complete_workout(
    session: Session,
    user_id: uuid.UUID,
    *,
    client_ref: uuid.UUID,
    routine_id: uuid.UUID | None,
    performed_on: dt.date,
    started_at: dt.datetime | None,
    ended_at: dt.datetime | None,
    note: str | None,
    sets: list[dict],
    rest_day: bool = False,
) -> tuple[Workout, bool]:
    """A whole session in one write (AD-58). Returns ``(workout, created)``.

    Idempotent on ``(user_id, client_ref)``: a replay returns the row already written and
    writes nothing. The conflict target includes ``user_id``, so it never meets a row RLS hides.
    """
    if rest_day:
        if sets:
            raise Invalid("a rest day cannot carry sets", "rest_day_has_sets")
        routine_id = None
        replay = _existing_rest_day(session, user_id, client_ref, performed_on)
        if replay is not None:
            return replay, False

    if routine_id is not None:
        # Unknown or foreign: stored null, not a 404 - the routine may be long gone.
        routine_id = session.execute(
            select(Routine.id).where(Routine.user_id == user_id, Routine.id == routine_id)
        ).scalar_one_or_none()

    inserted = session.execute(
        pg_insert(Workout)
        .values(
            user_id=user_id,
            client_ref=client_ref,
            routine_id=routine_id,
            performed_on=performed_on,
            started_at=started_at,
            ended_at=ended_at,
            note=note,
            rest_day=rest_day,
        )
        # Bare DO NOTHING for a rest day: either unique key (client_ref, or the one-per-day
        # partial index) may be the one hit. Both keys lead with user_id, so neither can
        # meet a row RLS hides.
        .on_conflict_do_nothing(
            **({} if rest_day else {"index_elements": [Workout.user_id, Workout.client_ref]})
        )
        .returning(Workout.id)
    ).scalar_one_or_none()

    if inserted is None and rest_day:
        existing = _existing_rest_day(session, user_id, client_ref, performed_on)
        if existing is None:  # pragma: no cover - a unique key says it must be there
            raise Conflict("workout could not be created or found", "workout_unwritable")
        return existing, False

    if inserted is None:
        existing = session.execute(
            select(Workout)
            .where(Workout.user_id == user_id, Workout.client_ref == client_ref)
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if existing is None:  # pragma: no cover - the unique key says it must be there
            raise Conflict("workout could not be created or found", "workout_unwritable")
        return existing, False

    resolved: dict[object, Exercise] = {}
    for position, item in enumerate(sets):
        if item["exercise_name"] is not None:
            key: object = ("name", item["exercise_name"].lower())
            if key not in resolved:
                resolved[key] = get_or_create_exercise(
                    session, user_id, name=item["exercise_name"], kind=item["kind"] or "reps"
                )
        else:
            key = ("id", item["exercise_id"])
            if key not in resolved:
                resolved[key] = get_exercise(session, user_id, item["exercise_id"])
        exercise = resolved[key]
        measures = reconcile_measures(
            exercise.kind,
            reps=item["reps"],
            duration_seconds=item["duration_seconds"],
            distance_m=item["distance_m"],
        )
        session.add(
            WorkoutSet(
                user_id=user_id,
                workout_id=inserted,
                exercise_id=exercise.id,
                position=position,
                reps=measures["reps"],
                weight=item["weight"],
                duration_seconds=measures["duration_seconds"],
                distance_m=measures["distance_m"],
                is_warmup=item.get("is_warmup", False),
            )
        )
    session.flush()
    workout = session.execute(
        select(Workout).where(Workout.user_id == user_id, Workout.id == inserted)
    ).scalar_one()
    return workout, True


def delete_set(session: Session, user_id: uuid.UUID, set_id: uuid.UUID) -> None:
    result = session.execute(
        delete(WorkoutSet).where(WorkoutSet.user_id == user_id, WorkoutSet.id == set_id)
    )
    if result.rowcount == 0:
        raise NotFound("No set with that id")
    session.flush()


# --------------------------------------------------------------- progression

_HISTORY = text(
    """
    SELECT w.performed_on                       AS performed_on,
           max(s.weight)                        AS top_weight,
           coalesce(sum(s.reps), 0)             AS reps,
           max(s.duration_seconds)              AS best_seconds,
           sum(s.duration_seconds)              AS total_seconds,
           max(s.distance_m)                    AS best_distance_m,
           sum(s.distance_m)                    AS total_distance_m,
           count(*)                             AS sets,
           -- Volume is the honest measure of a session's work, and it is null rather than
           -- zero when nothing carried a weight: a bodyweight day has volume nobody can
           -- state in kilos, and 0 would read as "did nothing".
           sum(s.weight * s.reps) FILTER (WHERE s.weight IS NOT NULL) AS volume
    FROM workout_sets s
    JOIN workouts w ON w.user_id = s.user_id AND w.id = s.workout_id
    -- Warm-ups are not work: out of every aggregate (Epic 54). A session of only warm-ups
    -- has no point at all.
    WHERE s.user_id = :uid AND s.exercise_id = :exercise_id AND NOT s.is_warmup
    GROUP BY w.performed_on
    ORDER BY w.performed_on
    """
)


def exercise_history(session: Session, user_id: uuid.UUID, exercise_id: uuid.UUID) -> list[dict]:
    """Per session: the heaviest set, total reps, and volume. The answer to "am I improving?"."""
    get_exercise(session, user_id, exercise_id)
    return [
        {
            "performed_on": row.performed_on,
            "top_weight": row.top_weight,
            "reps": int(row.reps),
            "sets": int(row.sets),
            "volume": row.volume,
            "best_seconds": row.best_seconds,
            "total_seconds": None if row.total_seconds is None else int(row.total_seconds),
            "best_distance_m": row.best_distance_m,
            "total_distance_m": None if row.total_distance_m is None else int(row.total_distance_m),
        }
        for row in session.execute(_HISTORY, {"uid": str(user_id), "exercise_id": str(exercise_id)})
    ]
