import datetime as dt
import uuid
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    PlainSerializer,
    StrictBool,
    model_validator,
)

from app.schemas.common import quantise, to_decimal

# A weight is not money: two places, never negative, and null for a bodyweight set. Reuses
# the money parser's shape rule — a plain decimal string, never a float on the wire (AD-5).
Weight = Annotated[
    Decimal,
    BeforeValidator(lambda v: quantise(to_decimal(v))),
    Field(ge=Decimal("0"), le=Decimal("99999.99")),
    PlainSerializer(lambda v: f"{v:.2f}", return_type=str),
]

# What a set of an exercise measures (Epic 42).
ExerciseKind = Literal["reps", "duration", "distance"]

_Sets = Annotated[int, Field(gt=0, le=99)]
_Reps = Annotated[int, Field(gt=0, le=999)]
_Seconds = Annotated[int, Field(ge=1, le=86400)]
_Metres = Annotated[int, Field(ge=1, le=1_000_000)]
_Rest = Annotated[int, Field(ge=0, le=3600)]


def _trimmed(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("name cannot be blank")
    return trimmed


class ExerciseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    video_url: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=500)
    # Used only when the name is new; an existing exercise keeps its kind.
    kind: ExerciseKind | None = None

    @model_validator(mode="after")
    def _trim(self) -> "ExerciseCreate":
        object.__setattr__(self, "name", _trimmed(self.name))
        return self


class ExerciseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    # Explicit null clears the link; absent leaves it alone.
    video_url: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=500)
    kind: ExerciseKind | None = None


class ExerciseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    kind: ExerciseKind
    video_url: str | None
    note: str | None
    created_at: dt.datetime


class RoutineCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _trim(self) -> "RoutineCreate":
        object.__setattr__(self, "name", _trimmed(self.name))
        return self


class RoutineUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    # Explicit null clears the note; absent leaves it alone.
    note: str | None = Field(default=None, max_length=500)


class RoutineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    note: str | None
    created_at: dt.datetime


class RoutineLineCreate(BaseModel):
    """AD-12: exactly one of the two, and a name creates the exercise."""

    exercise_id: uuid.UUID | None = None
    exercise_name: str | None = Field(default=None, min_length=1, max_length=80)
    # Used only when exercise_name coins a new exercise.
    kind: ExerciseKind | None = None
    target_sets: _Sets | None = None
    target_reps: _Reps | None = None
    target_seconds: _Seconds | None = None
    target_distance_m: _Metres | None = None
    target_weight: Weight | None = None
    rest_seconds: _Rest | None = None
    rest_after_seconds: _Rest | None = None
    note: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _exactly_one(self) -> "RoutineLineCreate":
        if (self.exercise_id is None) == (self.exercise_name is None):
            raise ValueError("provide exactly one of exercise_id or exercise_name")
        if self.exercise_name is not None:
            object.__setattr__(self, "exercise_name", _trimmed(self.exercise_name))
        return self


class RoutineLineUpdate(BaseModel):
    """Explicit null clears a target; an absent key leaves it alone."""

    target_sets: _Sets | None = None
    target_reps: _Reps | None = None
    target_seconds: _Seconds | None = None
    target_distance_m: _Metres | None = None
    target_weight: Weight | None = None
    rest_seconds: _Rest | None = None
    rest_after_seconds: _Rest | None = None
    note: str | None = Field(default=None, max_length=200)


class RoutineLineOut(BaseModel):
    id: uuid.UUID
    exercise_id: uuid.UUID
    exercise_name: str
    kind: ExerciseKind
    video_url: str | None
    position: int
    target_sets: int | None
    target_reps: int | None
    target_seconds: int | None
    target_distance_m: int | None
    target_weight: Weight | None
    rest_seconds: int | None
    rest_after_seconds: int | None
    note: str | None


class RoutineDetailOut(BaseModel):
    id: uuid.UUID
    name: str
    note: str | None
    lines: list[RoutineLineOut]


class RoutineOrder(BaseModel):
    line_ids: list[uuid.UUID] = Field(max_length=200)


class RoutineImportLine(BaseModel):
    exercise_name: str = Field(min_length=1, max_length=80)
    kind: ExerciseKind
    video_url: str | None = Field(default=None, max_length=500)
    target_sets: _Sets | None = None
    target_reps: _Reps | None = None
    target_seconds: _Seconds | None = None
    target_distance_m: _Metres | None = None
    target_weight: Weight | None = None
    rest_seconds: _Rest | None = None
    rest_after_seconds: _Rest | None = None
    note: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _trim(self) -> "RoutineImportLine":
        object.__setattr__(self, "exercise_name", _trimmed(self.exercise_name))
        return self


class RoutineImport(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    note: str | None = Field(default=None, max_length=500)
    lines: list[RoutineImportLine] = Field(min_length=1, max_length=60)

    @model_validator(mode="after")
    def _trim(self) -> "RoutineImport":
        object.__setattr__(self, "name", _trimmed(self.name))
        return self


class WorkoutCreate(BaseModel):
    performed_on: dt.date | None = None
    routine_id: uuid.UUID | None = None
    note: str | None = Field(default=None, max_length=500)


class WorkoutOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    routine_id: uuid.UUID | None
    performed_on: dt.date
    started_at: dt.datetime | None
    ended_at: dt.datetime | None
    note: str | None
    rest_day: bool
    created_at: dt.datetime


class SetCreate(BaseModel):
    exercise_id: uuid.UUID | None = None
    exercise_name: str | None = Field(default=None, min_length=1, max_length=80)
    # Used only when exercise_name coins a new exercise.
    kind: ExerciseKind | None = None
    # Which of the three is required follows the exercise's kind; checked in the service.
    reps: _Reps | None = None
    # Absent for a bodyweight set. Zero is a weight; nothing is not.
    weight: Weight | None = None
    duration_seconds: _Seconds | None = None
    distance_m: _Metres | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> "SetCreate":
        if (self.exercise_id is None) == (self.exercise_name is None):
            raise ValueError("provide exactly one of exercise_id or exercise_name")
        if self.exercise_name is not None:
            object.__setattr__(self, "exercise_name", _trimmed(self.exercise_name))
        return self


class SetOut(BaseModel):
    id: uuid.UUID
    exercise_id: uuid.UUID
    exercise_name: str
    kind: ExerciseKind
    position: int
    reps: int | None
    weight: Weight | None
    duration_seconds: int | None
    distance_m: int | None


class WorkoutDetailOut(BaseModel):
    id: uuid.UUID
    routine_id: uuid.UUID | None
    performed_on: dt.date
    started_at: dt.datetime | None
    ended_at: dt.datetime | None
    note: str | None
    rest_day: bool
    sets: list[SetOut]


class WorkoutComplete(BaseModel):
    client_ref: uuid.UUID
    # Unknown or foreign -> stored null (the routine may have been deleted while offline).
    routine_id: uuid.UUID | None = None
    performed_on: dt.date
    started_at: dt.datetime | None = None
    ended_at: dt.datetime | None = None
    note: str | None = Field(default=None, max_length=500)
    sets: list[SetCreate] = Field(max_length=500)
    # AD-59: a rest day has no sets and no routine; one per date (idempotent).
    rest_day: StrictBool = False

    @model_validator(mode="after")
    def _ordered(self) -> "WorkoutComplete":
        if self.started_at is not None and self.ended_at is not None:
            # Comparing naive with aware raises TypeError; refuse the mix as a validation error.
            if (self.started_at.tzinfo is None) != (self.ended_at.tzinfo is None):
                raise ValueError("started_at and ended_at must both carry a timezone, or neither")
            if self.ended_at < self.started_at:
                raise ValueError("ended_at cannot be before started_at")
        return self


class HistoryPoint(BaseModel):
    performed_on: dt.date
    top_weight: Weight | None
    # Total reps that session; 0 when the exercise is not counted in reps.
    reps: int
    sets: int
    # Null, not zero, on a session where nothing carried a weight.
    volume: Weight | None
    best_seconds: int | None
    total_seconds: int | None
    best_distance_m: int | None
    total_distance_m: int | None


class ExerciseHistoryOut(BaseModel):
    exercise_id: uuid.UUID
    exercise_name: str
    points: list[HistoryPoint]
