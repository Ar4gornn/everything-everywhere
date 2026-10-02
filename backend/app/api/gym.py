import datetime as dt
import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.core.deps import CurrentUserId, DbSession, StartDay
from app.models.gym import Exercise, RoutineExercise, Workout, WorkoutSet
from app.schemas.common import Page
from app.schemas.gym import (
    ExerciseCreate,
    ExerciseHistoryOut,
    ExerciseOut,
    ExerciseUpdate,
    HistoryPoint,
    RoutineCreate,
    RoutineDetailOut,
    RoutineImport,
    RoutineLineCreate,
    RoutineLineOut,
    RoutineLineUpdate,
    RoutineOrder,
    RoutineOut,
    RoutineUpdate,
    SetCreate,
    SetOut,
    WorkoutComplete,
    WorkoutCreate,
    WorkoutDetailOut,
    WorkoutOut,
)
from app.services import gym

router = APIRouter(prefix="/api/gym", tags=["gym"])


def _line_out(line: RoutineExercise, exercise: Exercise) -> RoutineLineOut:
    return RoutineLineOut(
        id=line.id,
        exercise_id=exercise.id,
        exercise_name=exercise.name,
        kind=exercise.kind,
        video_url=exercise.video_url,
        position=line.position,
        target_sets=line.target_sets,
        target_reps=line.target_reps,
        target_seconds=line.target_seconds,
        target_distance_m=line.target_distance_m,
        target_weight=line.target_weight,
        rest_seconds=line.rest_seconds,
        rest_after_seconds=line.rest_after_seconds,
        note=line.note,
    )


def _routine_detail(routine, lines) -> RoutineDetailOut:
    return RoutineDetailOut(
        id=routine.id,
        name=routine.name,
        note=routine.note,
        lines=[_line_out(line, exercise) for line, exercise in lines],
    )


def _set_out(row: WorkoutSet, exercise: Exercise) -> SetOut:
    return SetOut(
        id=row.id,
        exercise_id=exercise.id,
        exercise_name=exercise.name,
        kind=exercise.kind,
        position=row.position,
        reps=row.reps,
        weight=row.weight,
        duration_seconds=row.duration_seconds,
        distance_m=row.distance_m,
    )


def _workout_detail(workout: Workout, sets) -> WorkoutDetailOut:
    return WorkoutDetailOut(
        id=workout.id,
        routine_id=workout.routine_id,
        performed_on=workout.performed_on,
        started_at=workout.started_at,
        ended_at=workout.ended_at,
        note=workout.note,
        rest_day=workout.rest_day,
        sets=[_set_out(row, exercise) for row, exercise in sets],
    )


# ---------------------------------------------------------------- exercises


@router.get("/exercises", response_model=Page[ExerciseOut])
def list_exercises(user_id: CurrentUserId, session: DbSession) -> Page[ExerciseOut]:
    rows = gym.list_exercises(session, user_id)
    return Page[ExerciseOut](items=[ExerciseOut.model_validate(r) for r in rows])


@router.post("/exercises", response_model=ExerciseOut, status_code=status.HTTP_201_CREATED)
def create_exercise(
    payload: ExerciseCreate, user_id: CurrentUserId, session: DbSession
) -> ExerciseOut:
    """AD-12: idempotent by name, so a second create returns the first (and keeps its kind)."""
    exercise = gym.get_or_create_exercise(
        session, user_id, name=payload.name, kind=payload.kind or "reps"
    )
    if payload.video_url is not None or payload.note is not None:
        exercise = gym.update_exercise(
            session,
            user_id,
            exercise.id,
            {
                k: v
                for k, v in (("video_url", payload.video_url), ("note", payload.note))
                if v is not None
            },
        )
    return ExerciseOut.model_validate(exercise)


@router.patch("/exercises/{exercise_id}", response_model=ExerciseOut)
def update_exercise(
    exercise_id: uuid.UUID,
    payload: ExerciseUpdate,
    user_id: CurrentUserId,
    session: DbSession,
) -> ExerciseOut:
    fields = {key: getattr(payload, key) for key in payload.model_fields_set}
    return ExerciseOut.model_validate(gym.update_exercise(session, user_id, exercise_id, fields))


@router.delete("/exercises/{exercise_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exercise(exercise_id: uuid.UUID, user_id: CurrentUserId, session: DbSession) -> Response:
    gym.delete_exercise(session, user_id, exercise_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/exercises/{exercise_id}/history", response_model=ExerciseHistoryOut)
def exercise_history(
    exercise_id: uuid.UUID, user_id: CurrentUserId, session: DbSession
) -> ExerciseHistoryOut:
    exercise = gym.get_exercise(session, user_id, exercise_id)
    points = gym.exercise_history(session, user_id, exercise_id)
    return ExerciseHistoryOut(
        exercise_id=exercise.id,
        exercise_name=exercise.name,
        points=[HistoryPoint(**point) for point in points],
    )


# ----------------------------------------------------------------- routines
# Literal paths (`full`, `import`, `lines/...`) are declared before `/routines/{routine_id}`.


@router.get("/routines", response_model=Page[RoutineOut])
def list_routines(user_id: CurrentUserId, session: DbSession) -> Page[RoutineOut]:
    rows = gym.list_routines(session, user_id)
    return Page[RoutineOut](items=[RoutineOut.model_validate(r) for r in rows])


@router.post("/routines", response_model=RoutineOut, status_code=status.HTTP_201_CREATED)
def create_routine(
    payload: RoutineCreate, user_id: CurrentUserId, session: DbSession
) -> RoutineOut:
    return RoutineOut.model_validate(
        gym.create_routine(session, user_id, name=payload.name, note=payload.note)
    )


@router.get("/routines/full", response_model=Page[RoutineDetailOut])
def routines_full(user_id: CurrentUserId, session: DbSession) -> Page[RoutineDetailOut]:
    """Every routine with its lines in one request, for the offline cache."""
    return Page[RoutineDetailOut](
        items=[_routine_detail(r, lines) for r, lines in gym.routines_full(session, user_id)]
    )


@router.post(
    "/routines/import", response_model=RoutineDetailOut, status_code=status.HTTP_201_CREATED
)
def import_routine(
    payload: RoutineImport, user_id: CurrentUserId, session: DbSession
) -> RoutineDetailOut:
    routine = gym.import_routine(
        session,
        user_id,
        name=payload.name,
        note=payload.note,
        lines=[line.model_dump() for line in payload.lines],
    )
    return _routine_detail(routine, gym.routine_lines(session, user_id, routine.id))


@router.patch("/routines/lines/{line_id}", response_model=RoutineLineOut)
def update_routine_line(
    line_id: uuid.UUID,
    payload: RoutineLineUpdate,
    user_id: CurrentUserId,
    session: DbSession,
) -> RoutineLineOut:
    fields = {key: getattr(payload, key) for key in payload.model_fields_set}
    line, exercise = gym.update_routine_line(session, user_id, line_id, fields)
    return _line_out(line, exercise)


@router.delete("/routines/lines/{line_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_routine_line(line_id: uuid.UUID, user_id: CurrentUserId, session: DbSession) -> Response:
    gym.remove_routine_line(session, user_id, line_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/routines/{routine_id}", response_model=RoutineDetailOut)
def read_routine(
    routine_id: uuid.UUID, user_id: CurrentUserId, session: DbSession
) -> RoutineDetailOut:
    routine = gym.get_routine(session, user_id, routine_id)
    return _routine_detail(routine, gym.routine_lines(session, user_id, routine_id))


@router.patch("/routines/{routine_id}", response_model=RoutineOut)
def update_routine(
    routine_id: uuid.UUID, payload: RoutineUpdate, user_id: CurrentUserId, session: DbSession
) -> RoutineOut:
    fields = {key: getattr(payload, key) for key in payload.model_fields_set}
    return RoutineOut.model_validate(gym.update_routine(session, user_id, routine_id, fields))


@router.put("/routines/{routine_id}/order", response_model=RoutineDetailOut)
def reorder_routine(
    routine_id: uuid.UUID, payload: RoutineOrder, user_id: CurrentUserId, session: DbSession
) -> RoutineDetailOut:
    gym.reorder_routine_lines(session, user_id, routine_id, payload.line_ids)
    routine = gym.get_routine(session, user_id, routine_id)
    return _routine_detail(routine, gym.routine_lines(session, user_id, routine_id))


@router.delete("/routines/{routine_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_routine(routine_id: uuid.UUID, user_id: CurrentUserId, session: DbSession) -> Response:
    gym.delete_routine(session, user_id, routine_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/routines/{routine_id}/exercises",
    response_model=RoutineLineOut,
    status_code=status.HTTP_201_CREATED,
)
def add_routine_line(
    routine_id: uuid.UUID,
    payload: RoutineLineCreate,
    user_id: CurrentUserId,
    session: DbSession,
) -> RoutineLineOut:
    line, exercise = gym.add_routine_line(
        session,
        user_id,
        routine_id,
        exercise_id=payload.exercise_id,
        exercise_name=payload.exercise_name,
        kind=payload.kind,
        target_sets=payload.target_sets,
        target_reps=payload.target_reps,
        target_seconds=payload.target_seconds,
        target_distance_m=payload.target_distance_m,
        target_weight=payload.target_weight,
        rest_seconds=payload.rest_seconds,
        rest_after_seconds=payload.rest_after_seconds,
        note=payload.note,
    )
    return _line_out(line, exercise)


# ----------------------------------------------------------------- workouts


@router.get("/workouts", response_model=Page[WorkoutOut])
def list_workouts(
    user_id: CurrentUserId,
    session: DbSession,
    month: Annotated[str | None, Query(description="YYYY-MM")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 30,
    start_day: StartDay = 1,
) -> Page[WorkoutOut]:
    rows = gym.list_workouts(session, user_id, limit=limit, month=month, start_day=start_day)
    return Page[WorkoutOut](items=[WorkoutOut.model_validate(r) for r in rows])


@router.post("/workouts", response_model=WorkoutOut, status_code=status.HTTP_201_CREATED)
def start_workout(payload: WorkoutCreate, user_id: CurrentUserId, session: DbSession) -> WorkoutOut:
    workout = gym.start_workout(
        session,
        user_id,
        performed_on=payload.performed_on or dt.date.today(),
        routine_id=payload.routine_id,
        note=payload.note,
    )
    return WorkoutOut.model_validate(workout)


@router.post(
    "/workouts/complete",
    response_model=WorkoutDetailOut,
    status_code=status.HTTP_201_CREATED,
    responses={200: {"model": WorkoutDetailOut, "description": "client_ref already used"}},
)
def complete_workout(
    payload: WorkoutComplete,
    response: Response,
    user_id: CurrentUserId,
    session: DbSession,
) -> WorkoutDetailOut:
    """AD-58: a whole session, idempotent on ``client_ref`` (201 new, 200 replay)."""
    workout, created = gym.complete_workout(
        session,
        user_id,
        client_ref=payload.client_ref,
        routine_id=payload.routine_id,
        performed_on=payload.performed_on,
        started_at=payload.started_at,
        ended_at=payload.ended_at,
        note=payload.note,
        sets=[item.model_dump() for item in payload.sets],
        rest_day=payload.rest_day,
    )
    if not created:
        response.status_code = status.HTTP_200_OK
    return _workout_detail(workout, gym.workout_sets(session, user_id, workout.id))


@router.get("/workouts/recent", response_model=Page[WorkoutDetailOut])
def recent_workouts(
    user_id: CurrentUserId,
    session: DbSession,
    limit: Annotated[int, Query(ge=1, le=30)] = 10,
) -> Page[WorkoutDetailOut]:
    """The newest sessions with their sets (rest days included), for the AI prompt context."""
    rows = gym.recent_workouts(session, user_id, limit=limit)
    return Page[WorkoutDetailOut](items=[_workout_detail(w, sets) for w, sets in rows])


@router.get("/workouts/{workout_id}", response_model=WorkoutDetailOut)
def read_workout(
    workout_id: uuid.UUID, user_id: CurrentUserId, session: DbSession
) -> WorkoutDetailOut:
    workout = gym.get_workout(session, user_id, workout_id)
    return _workout_detail(workout, gym.workout_sets(session, user_id, workout_id))


@router.delete("/workouts/{workout_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workout(workout_id: uuid.UUID, user_id: CurrentUserId, session: DbSession) -> Response:
    gym.delete_workout(session, user_id, workout_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/workouts/{workout_id}/sets", response_model=SetOut, status_code=status.HTTP_201_CREATED
)
def log_set(
    workout_id: uuid.UUID, payload: SetCreate, user_id: CurrentUserId, session: DbSession
) -> SetOut:
    row = gym.log_set(
        session,
        user_id,
        workout_id,
        exercise_id=payload.exercise_id,
        exercise_name=payload.exercise_name,
        kind=payload.kind,
        reps=payload.reps,
        weight=payload.weight,
        duration_seconds=payload.duration_seconds,
        distance_m=payload.distance_m,
    )
    exercise = gym.get_exercise(session, user_id, row.exercise_id)
    return _set_out(row, exercise)


@router.delete("/sets/{set_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_set(set_id: uuid.UUID, user_id: CurrentUserId, session: DbSession) -> Response:
    gym.delete_set(session, user_id, set_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
