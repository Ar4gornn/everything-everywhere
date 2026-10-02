from datetime import datetime, time
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    EmailStr,
    Field,
    StrictBool,
    field_serializer,
    field_validator,
)

from app.core.months import MAX_START_DAY
from app.services.preferences import clean_points_name

Currency = Literal["USD", "EUR"]
WeightUnit = Literal["kg", "lb"]
#: The languages this build actually has a catalogue for. Two letters rather than a BCP 47
#: tag: a column that could hold "pt-BR" while nothing could render it is a promise the app
#: does not keep. See migration 0019.
Language = Literal["en", "fr"]


class Credentials(BaseModel):
    email: EmailStr
    # Long enough to matter, bounded because Argon2 should not be handed a megabyte.
    password: str = Field(min_length=10, max_length=200)

    @field_validator("email")
    @classmethod
    def _normalise(cls, v: str) -> str:
        # AD-23: normalised before it is stored or compared, not only at the index.
        return v.strip().lower()


class RegistrationRequest(Credentials):
    """Registration additionally carries an invite code when the instance is closed.

    Optional on the model rather than required, because `REGISTRATION_MODE=open` is a
    supported configuration for local use; the route decides whether it is needed.
    """

    invite_code: str | None = Field(default=None, max_length=200)
    # Chosen at sign-up because it is far cheaper than changing it later, once the account
    # holds entries the setting can no longer safely relabel.
    currency: Currency = "USD"
    # Unlike the currency this is free to change afterwards; it is asked at sign-up only so
    # the first screen after registering is already in the right language.
    language: Language = "en"


# Epic 33 (AD-49). Ids are plain strings rather than Literals on purpose: an unknown one is
# refused by `services/preferences` with `pref_unknown_id`, which the client can word,
# instead of a pydantic 422 it cannot. The lengths bound the stored value to a few KB.
_PrefId = Field(min_length=1, max_length=32)


class Tab(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = _PrefId
    #: "bar" is the bottom tab bar on a phone and the main nav on a desktop; "top" is the
    #: smaller row beside it (Plan, Grow, Recipes by default).
    slot: Literal["bar", "top"]


class Card(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = _PrefId
    # Strict: in lax mode pydantic reads "off" as False and "yes" as True, so a typo would
    # hide a card instead of being refused.
    on: StrictBool


class LayoutIn(BaseModel):
    """One layout's subtree. A key left out is the default, so it is stored left out."""

    model_config = ConfigDict(extra="forbid")

    tabs: list[Tab] | None = Field(default=None, max_length=32)
    cards: list[Card] | None = Field(default=None, max_length=32)


def _points_name(value: object) -> str:
    """Runs before the type check and may raise only ``ValueError`` (a 422, not a 500)."""
    if not isinstance(value, str):
        raise ValueError("must be text")
    return clean_points_name(value)


class PreferencesUpdate(BaseModel):
    """Each top-level key present replaces that subtree; absent keys are untouched."""

    model_config = ConfigDict(extra="forbid")

    modules: dict[str, StrictBool] | None = Field(default=None, max_length=32)
    # Epic 36 (AD-52): which kinds the daily digest may mention. Strict for the same reason
    # as `Card.on`.
    notifications: dict[str, StrictBool] | None = Field(default=None, max_length=32)
    # Epic 41 (AD-57): which module streaks are shown. Strict, so {"gym": "off"} is a 422
    # rather than a streak quietly switched on.
    streaks: dict[str, StrictBool] | None = Field(default=None, max_length=32)
    # Epic 41 (AD-57): the person's word for points. Trimmed; over 24 characters is a 422;
    # empty means "the default" and is stored as "".
    points_name: Annotated[str, BeforeValidator(_points_name)] | None = None
    # Epic 47 (AD-63 §4): which way the moon is drawn. A typo ("nord") is a 422; an explicit
    # null clears it back to "from the time zone" (the route keeps it when it was sent).
    moon_hemisphere: Literal["north", "south"] | None = None
    phone: LayoutIn | None = None
    desktop: LayoutIn | None = None


class LayoutOut(BaseModel):
    tabs: list[Tab]
    cards: list[Card]


class PreferencesOut(BaseModel):
    """Always resolved: every module, section and card, defaults filled in."""

    modules: dict[str, bool]
    notifications: dict[str, bool]
    streaks: dict[str, bool]
    points_name: str | None
    moon_hemisphere: Literal["north", "south"] | None
    phone: LayoutOut
    desktop: LayoutOut


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    currency: Currency
    weight_unit: WeightUnit
    # AD-10: 1 is the calendar month. See MAX_START_DAY for why 28 is the ceiling.
    budget_start_day: int
    language: Language
    created_at: datetime
    # Epic 30. Both together answer "open the tour?"; the timestamp alone answers "when did
    # they leave it". False and null on a new account; true on every account older than
    # migration 0022.
    tutorial_completed: bool
    tutorial_skipped_at: datetime | None
    preferences: PreferencesOut
    # Epic 36 (AD-52). Null zone: the digest follows the host's clock, as it always did.
    timezone: str | None
    digest_time: time
    # AD-54: whether this account may issue invites. Only decides what the client shows;
    # every admin route checks again, and so does the database.
    is_admin: bool = False

    @field_serializer("digest_time")
    def _hh_mm(self, value: time) -> str:
        """"19:00", the shape an `<input type="time">` gives and takes."""
        return value.strftime("%H:%M")


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105 — the OAuth scheme name, not a credential
    expires_in: int
    # Long-lived, rotated on every use, revocable. The access token stays short so a
    # stolen one expires quickly; the refresh token is what keeps a phone signed in.
    refresh_token: str


class RefreshRequest(BaseModel):
    refresh_token: str


class CurrencyUpdate(BaseModel):
    currency: Currency


class WeightUnitUpdate(BaseModel):
    weight_unit: WeightUnit


class LanguageUpdate(BaseModel):
    language: Language


class BudgetStartDayUpdate(BaseModel):
    budget_start_day: int = Field(ge=1, le=MAX_START_DAY)


class NotificationScheduleUpdate(BaseModel):
    """Epic 36. Both fields always sent: the pair is one setting, "19:00 in Paris"."""

    model_config = ConfigDict(extra="forbid")

    # Whether it names a real zone is the service's check (`invalid_timezone`); here, only
    # its shape. Null hands the account back to the host's clock.
    timezone: str | None = Field(min_length=1, max_length=64)
    digest_time: time

    @field_validator("digest_time")
    @classmethod
    def _whole_minutes(cls, value: time) -> time:
        if value.second or value.microsecond or value.tzinfo is not None:
            raise ValueError("digest_time is a local hour and minute, HH:MM")
        return value


class TutorialUpdate(BaseModel):
    """How the guided tour ended. The client says which; the server keeps the time."""

    outcome: Literal["completed", "skipped"]


_PASSWORD = Field(min_length=10, max_length=200)


class RecoverRequest(BaseModel):
    """Forgot password: an email, one unused recovery code, and the replacement."""

    email: EmailStr
    code: str = Field(min_length=1, max_length=40)
    new_password: str = _PASSWORD

    @field_validator("email")
    @classmethod
    def _normalise(cls, v: str) -> str:
        return v.strip().lower()


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = _PASSWORD


class PasswordConfirm(BaseModel):
    """Re-authentication for a sensitive action by a signed-in user."""

    password: str = Field(min_length=1, max_length=200)


class RecoveryCodesOut(BaseModel):
    # Plain text, once. Stored only as hashes from here on.
    codes: list[str]


class RecoveryStatusOut(BaseModel):
    unused: int
    total: int
