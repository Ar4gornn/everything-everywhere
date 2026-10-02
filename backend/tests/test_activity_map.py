"""Story 41.1 — every write route is classified (AD-57).

The activity map in ``services/activity.py`` says which prefix counts for which module and
which count for nothing. This walks the real route table and fails a write route that is in
neither, so a new router cannot ship without deciding what a write under it means for a
streak. It also checks that every mapped route really carries the dependency for the module
the map names, and that nothing "counts nothing" by accident.
"""

from fastapi import APIRouter, FastAPI

from app.services import activity


def _routes(app):
    """Every route with its full path, whichever way this FastAPI keeps them: newer versions
    hold an included router as one lazy node whose ``effective_route_contexts`` yields the
    routes with their prefix and inherited dependencies applied."""
    for route in app.routes:
        if hasattr(route, "effective_route_contexts"):
            yield from route.effective_route_contexts()
        else:
            yield route


def _write_routes(app):
    for route in _routes(app):
        methods = getattr(route, "methods", None) or set()
        if methods & activity.WRITE_METHODS and getattr(route, "dependant", None) is not None:
            yield route


def _modules_on(route) -> set[str]:
    return {
        sub.call._activity_module
        for sub in route.dependant.dependencies
        if hasattr(sub.call, "_activity_module")
    }


def test_every_write_route_is_mapped_or_listed_as_counting_nothing():
    from app.main import app

    routes = list(_write_routes(app))
    assert len(routes) > 50, "the walk found almost no write routes; it is not looking"
    unclassified = sorted(
        f"{sorted(r.methods & activity.WRITE_METHODS)} {r.path}"
        for r in routes
        if not activity.is_classified(r.path)
    )
    assert unclassified == [], (
        "write routes whose prefix is neither in ROUTE_MODULES nor in COUNTS_NOTHING "
        f"(services/activity.py): {unclassified}"
    )


def test_every_mapped_write_route_carries_its_modules_dependency():
    from app.main import app

    for route in _write_routes(app):
        expected = activity.module_for(route.path)
        if expected is None:
            continue
        assert _modules_on(route) == {expected}, route.path


def test_a_route_that_counts_nothing_carries_no_dependency():
    from app.main import app

    for route in _write_routes(app):
        if activity.module_for(route.path) is None:
            assert _modules_on(route) == set(), route.path


def test_the_checker_refuses_an_unmapped_router():
    """The positive control: a scratch router with a POST under a new prefix is what the
    walk must catch."""
    scratch = FastAPI()
    router = APIRouter(prefix="/api/wishlist")

    @router.post("")
    def add():  # pragma: no cover — never called
        return {}

    scratch.include_router(router)
    found = [r.path for r in _write_routes(scratch) if not activity.is_classified(r.path)]
    assert found == ["/api/wishlist"]


def test_a_prefix_is_matched_whole_not_as_a_string_start():
    assert activity.module_for("/api/entries") == "entries"
    assert activity.module_for("/api/entries/x") == "entries"
    assert activity.module_for("/api/entriesX") is None
    assert not activity.is_classified("/api/streaksX")


def test_the_map_names_only_known_modules():
    assert set(activity.ROUTE_MODULES.values()) <= set(activity.ACTIVITY_MODULES)
    assert set(activity.ROUTE_MODULES.values()) >= set(activity.MODULES)
    assert not set(activity.ROUTE_MODULES) & set(activity.COUNTS_NOTHING)
