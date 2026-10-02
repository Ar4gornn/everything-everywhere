"""Epic 44 (AD-60): what the quick-add sheet offers before anything is typed.

One read, so the sheet opens without loading the Entries list. Spec: `docs/epic-44-quick-add.md`
§3. Every list is capped, so the payload does not grow with the account's history.
"""

import uuid

from pydantic import BaseModel

from app.models.ledger import EntryKind
from app.schemas.common import Money

#: Category chips per kind.
MAX_CATEGORIES = 8
#: Repeat chips per kind.
MAX_COMBOS = 3
#: Vendors carried for the "known vendor fills its category" rule.
MAX_VENDORS = 200
#: The window the category ranking and the combos are computed over, in days.
WINDOW_DAYS = 90


class CategoryPick(BaseModel):
    id: uuid.UUID
    name: str
    #: Entries in the window; 0 for a category padded in after the used ones.
    uses: int
    #: Epic 35.3: the pot "Paid from" starts on. Always null for income.
    default_savings_type_id: uuid.UUID | None = None


class Combo(BaseModel):
    """A recent distinct (category, vendor, amount): one tap fills the form with it."""

    category_id: uuid.UUID
    category_name: str
    vendor_id: uuid.UUID | None
    vendor_name: str | None
    amount: Money


class KindPicks(BaseModel):
    categories: list[CategoryPick]
    combos: list[Combo]


class VendorPick(BaseModel):
    """A vendor and the category (and kind) of its most recent entry, all time."""

    vendor_id: uuid.UUID
    vendor_name: str
    kind: EntryKind
    category_id: uuid.UUID
    category_name: str


class QuickPicksOut(BaseModel):
    expense: KindPicks
    income: KindPicks
    vendors: list[VendorPick]
