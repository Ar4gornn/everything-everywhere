from fastapi import APIRouter, status

from app.core.clock import Now
from app.core.deps import CurrentUserId, DbSession
from app.schemas.streaks import (
    CheckInIn,
    DayOut,
    MilestoneOut,
    PointsOut,
    PricesOut,
    PurchaseOut,
    RepairOut,
    StreakOut,
    StreaksOut,
)
from app.services import streaks

# Counts nothing in the activity map (AD-57): a check-in writes its own row through the
# service, and nothing else under here may make a day.
router = APIRouter(prefix="/api/streaks", tags=["streaks"])


def _out(streak: streaks.Streak) -> StreakOut:
    return StreakOut(
        id=streak.id,
        current=streak.current,
        best=streak.best,
        today_active=streak.today_active,
        held_freezes=streak.held_freezes,
        repair=(
            RepairOut(days=len(streak.repair.days), cost=streak.repair.cost)
            if streak.repair
            else None
        ),
        recent=[DayOut(day=day, state=state) for day, state in streak.recent],
    )


def _points(points: streaks.Points) -> PointsOut:
    return PointsOut(balance=points.balance, earned=points.earned, spent=points.spent)


@router.get("", response_model=StreaksOut)
def read_streaks(user_id: CurrentUserId, session: DbSession, now: Now) -> StreaksOut:
    today, found, earned = streaks.read(session, user_id, now)
    return StreaksOut(
        today=today,
        points=_points(earned),
        prices=PricesOut(
            freeze=streaks.FREEZE_COST,
            max_held=streaks.MAX_HELD,
            repair_per_day=streaks.REPAIR_PER_DAY,
            milestones=[MilestoneOut(days=d, bonus=b) for d, b in streaks.MILESTONES],
        ),
        streaks=[_out(s) for s in found],
    )


@router.post("/check-in", response_model=StreakOut)
def check_in(payload: CheckInIn, user_id: CurrentUserId, session: DbSession, now: Now) -> StreakOut:
    """Make today active without any other write. Idempotent: the second press is the
    same row. The one endpoint that names its module itself."""
    _, streak = streaks.check_in(session, user_id, payload.streak, now)
    return _out(streak)


@router.post("/freezes", response_model=PurchaseOut, status_code=status.HTTP_201_CREATED)
def buy_freeze(
    payload: CheckInIn, user_id: CurrentUserId, session: DbSession, now: Now
) -> PurchaseOut:
    """Spend points on a freeze for one streak. ``409 freeze_limit`` at two held,
    ``409 points_insufficient`` under the price. Never makes a day (AD-57)."""
    points, streak = streaks.buy_freeze(session, user_id, payload.streak, now)
    return PurchaseOut(points=_points(points), streak=_out(streak))


@router.post("/repairs", response_model=PurchaseOut, status_code=status.HTTP_201_CREATED)
def buy_repair(
    payload: CheckInIn, user_id: CurrentUserId, session: DbSession, now: Now
) -> PurchaseOut:
    """Spend points to repair the one or two days missed just before today. ``409
    repair_unavailable`` when nothing is on offer (or a double submit lost the race),
    ``409 points_insufficient`` under the price. Never makes a day (AD-57)."""
    points, streak = streaks.buy_repair(session, user_id, payload.streak, now)
    return PurchaseOut(points=_points(points), streak=_out(streak))
