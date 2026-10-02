import logging
import re

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import HTTPException as FastAPIHTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import (
    admin,
    auth,
    books,
    budgets,
    calendar,
    categories,
    dashboard,
    entries,
    export,
    gym,
    habits,
    inventory,
    mood,
    notes,
    push,
    recipes,
    recurring,
    savings,
    streaks,
    vendors,
)
from app.core.config import get_settings
from app.core.errors import Conflict, DomainError, Invalid, NotFound
from app.core.months import InvalidMonth
from app.services import activity

settings = get_settings()


class _MaskFeedToken(logging.Filter):
    """The calendar feed's URL is its credential (AD-55), so it never reaches a log line.

    Uvicorn's access record carries the path as its third argument; the token in it is
    replaced before the line is formatted. Caddy writes no access log (no ``log`` block).
    """

    _TOKEN = re.compile(r"(/api/calendar/feed/)[^/?.\s]+")

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str):
            record.args = (*args[:2], self._TOKEN.sub(r"\1***", args[2]), *args[3:])
        return True


logging.getLogger("uvicorn.access").addFilter(_MaskFeedToken())

app = FastAPI(
    title="Everything Everywhere",
    version="0.1.0",
    description="Personal finance tracker. Per-user isolation is enforced by Postgres RLS.",
)

# AD-14/AD-15: the client is a separate static build on another origin, and which origins
# are allowed is configuration, not code.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)


# Domain errors become status codes in exactly one place, so no router can invent its own
# mapping — and in particular, so nothing can accidentally answer 403 where AD-8 requires 404.
#
# Every body carries `code` beside `detail` (AD-44). `detail` stays an English sentence and
# is the fallback; `code` is what a client keys its own wording off, so a French screen
# never has to render the server's English. The API itself stays language-neutral (AD-14).
def _body(exc: DomainError) -> dict[str, str]:
    return {"detail": exc.detail, "code": exc.code}


@app.exception_handler(NotFound)
def _not_found(_: Request, exc: NotFound) -> JSONResponse:
    return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content=_body(exc))


@app.exception_handler(Conflict)
def _conflict(_: Request, exc: Conflict) -> JSONResponse:
    return JSONResponse(status_code=status.HTTP_409_CONFLICT, content=_body(exc))


@app.exception_handler(Invalid)
def _invalid(_: Request, exc: Invalid) -> JSONResponse:
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, content=_body(exc))


@app.exception_handler(InvalidMonth)
def _invalid_month(_: Request, exc: InvalidMonth) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": str(exc), "code": "month_invalid"},
    )


@app.exception_handler(StarletteHTTPException)
def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    """Flatten the ``{"detail": ..., "code": ...}`` detail that ``errors.refused`` builds.

    Without this, FastAPI would nest it as ``{"detail": {"detail": ..., "code": ...}}`` and
    every existing caller reading ``["detail"]`` as a string would break. A plain string
    detail — anything raising ``HTTPException`` the ordinary way, including FastAPI's own
    404 for an unknown route — is wrapped the way FastAPI would have wrapped it.
    """
    detail = exc.detail
    content = (
        detail
        if isinstance(detail, dict) and "detail" in detail
        else {"detail": detail, "code": "error"}
    )
    return JSONResponse(
        status_code=exc.status_code, content=content, headers=getattr(exc, "headers", None)
    )


@app.exception_handler(RequestValidationError)
def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    """FastAPI's own 422, with a code added beside its list of field errors (AD-44).

    Without this the one family of errors the API returns *without* a code was the one a
    typo produces most often — and the client, having nothing to key off, fell back to
    rendering pydantic's English ("Input should be greater than or equal to 2") in whatever
    language the reader had chosen. `detail` keeps exactly the shape and content FastAPI
    would have sent, so nothing that reads it breaks; `code` is added, not substituted.
    """
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": jsonable_encoder(exc.errors()), "code": "validation"},
    )


# FastAPI registers its own handler for its subclass, which would win over the Starlette
# one above; pointing both at the same function keeps one behaviour for both.
app.add_exception_handler(FastAPIHTTPException, _http_error)


def _mount(router) -> None:
    """Include ``router``, with the activity dependency when its prefix is mapped (AD-57).

    The map in ``services/activity.py`` is the one place that says which prefix counts for
    which module, and ``tests/test_activity_map.py`` refuses a write route it does not
    classify, so a router cannot be added without deciding.
    """
    module = activity.module_for(router.prefix)
    app.include_router(
        router, dependencies=[activity.record_activity(module)] if module else None
    )


for _router in (
    auth.router,
    categories.router,
    entries.router,
    savings.router,
    budgets.router,
    calendar.router,
    dashboard.router,
    inventory.router,
    recurring.router,
    export.router,
    vendors.router,
    push.router,
    gym.router,
    habits.router,
    mood.router,
    recipes.router,
    recipes.foods_router,
    recipes.meals_router,
    books.router,
    notes.router,
    streaks.router,
    admin.router,
):
    _mount(_router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}
