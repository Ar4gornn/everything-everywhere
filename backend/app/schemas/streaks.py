"""Wire shapes for streaks (Epic 41)."""

import datetime as dt

from pydantic import BaseModel, Field


class DayOut(BaseModel):
    day: dt.date
    state: str


class StreakOut(BaseModel):
    id: str
    current: int
    best: int
    today_active: bool
    recent: list[DayOut]


class StreaksOut(BaseModel):
    today: dt.date
    streaks: list[StreakOut]


class CheckInIn(BaseModel):
    streak: str = Field(min_length=1, max_length=32)
