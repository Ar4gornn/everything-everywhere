"""Wire shapes for streaks (Epic 41)."""

import datetime as dt

from pydantic import BaseModel, Field, StrictInt


class DayOut(BaseModel):
    day: dt.date
    state: str


class RepairOut(BaseModel):
    """The repair on offer: how many days it covers and what it costs in all."""

    days: int
    cost: int


class StreakOut(BaseModel):
    id: str
    current: int
    best: int
    today_active: bool
    held_freezes: int
    repair: RepairOut | None
    recent: list[DayOut]


class PointsOut(BaseModel):
    # Signed on purpose: a balance is a difference, and a type that forbids a negative one
    # would turn a bug into a 500 (lab note 2026-09-26). The invariant keeps it >= 0.
    balance: int
    earned: int
    spent: int


class MilestoneOut(BaseModel):
    days: int
    bonus: int


class PricesOut(BaseModel):
    freeze: int
    max_held: int
    repair_per_day: int
    milestones: list[MilestoneOut]


class StreaksOut(BaseModel):
    today: dt.date
    points: PointsOut
    prices: PricesOut
    streaks: list[StreakOut]


class CheckInIn(BaseModel):
    streak: str = Field(min_length=1, max_length=32)


class RepairIn(BaseModel):
    """The streak and the total price the person confirmed. Strict: ``"35"`` and ``35.0``
    are a 422, not a number guessed at."""

    streak: str = Field(min_length=1, max_length=32)
    cost: StrictInt


class PurchaseOut(BaseModel):
    """What a purchase answers with: the balance after it and the streak it was for."""

    points: PointsOut
    streak: StreakOut
