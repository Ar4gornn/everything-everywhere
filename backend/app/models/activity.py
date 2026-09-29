"""Which days something was done (Epic 41, AD-57).

Not a habit and not a mood: nobody enters it. A router dependency writes one row per
user, local day and module inside the write it records, and a Check in writes the same row.
Append-only by grant (migration 0033), so nothing here is ever updated or deleted.
"""

import datetime as dt
import uuid

from sqlalchemy import CheckConstraint, Date, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ActivityDay(Base):
    __tablename__ = "activity_days"
    __table_args__ = (
        CheckConstraint("length(module) BETWEEN 1 AND 32", name="activity_days_module_length"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    module: Mapped[str] = mapped_column(Text, primary_key=True)
