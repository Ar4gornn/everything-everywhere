from fastapi import APIRouter

from app.core.clock import Now
from app.core.deps import CurrentUserId, DbSession
from app.schemas.streaks import CheckInIn, DayOut, StreakOut, StreaksOut
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
        recent=[DayOut(day=day, state=state) for day, state in streak.recent],
    )


@router.get("", response_model=StreaksOut)
def read_streaks(user_id: CurrentUserId, session: DbSession, now: Now) -> StreaksOut:
    today, found = streaks.read(session, user_id, now)
    return StreaksOut(today=today, streaks=[_out(s) for s in found])


@router.post("/check-in", response_model=StreakOut)
def check_in(payload: CheckInIn, user_id: CurrentUserId, session: DbSession, now: Now) -> StreakOut:
    """Make today active without any other write. Idempotent: the second press is the
    same row. The one endpoint that names its module itself."""
    _, streak = streaks.check_in(session, user_id, payload.streak, now)
    return _out(streak)
