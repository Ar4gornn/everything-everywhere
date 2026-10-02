"""What was bought with streak points (Epic 41, AD-57).

Append-only by grant (migration 0034): the balance is computed as earned minus the sum of
these costs, so a row is never updated or deleted.
"""

import datetime as dt
import uuid

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class StreakPurchase(Base):
    __tablename__ = "streak_purchases"
    __table_args__ = (
        CheckConstraint("length(streak) BETWEEN 1 AND 32", name="streak_purchases_streak_length"),
        CheckConstraint("kind IN ('freeze', 'repair')", name="streak_purchases_kind"),
        CheckConstraint("cost > 0", name="streak_purchases_cost_positive"),
        CheckConstraint(
            "(kind = 'repair') = (covers IS NOT NULL)", name="streak_purchases_covers_iff_repair"
        ),
        UniqueConstraint("user_id", "streak", "covers", name="streak_purchases_covers_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    streak: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    cost: Mapped[int] = mapped_column(Integer, nullable=False)
    bought_on: Mapped[dt.date] = mapped_column(Date, nullable=False)
    covers: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
