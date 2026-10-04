"""A stale tab cannot write over a newer change (preferences freshness).

Every user answer carries ``preferences_version``; a PATCH that sends it back as
``If-Match`` applies only if nothing has been written since. A tab left open for days
otherwise sends the subtree it remembers and silently undoes what another device did.
"""

import pytest


def _me(client, user):
    return client.get("/api/auth/me", headers=user["headers"]).json()


def _patch(client, user, body, version=None):
    headers = dict(user["headers"])
    if version is not None:
        headers["If-Match"] = version
    return client.patch("/api/auth/me/preferences", json=body, headers=headers)


def test_every_user_answer_carries_a_version(client, user_a):
    version = _me(client, user_a)["preferences_version"]
    assert isinstance(version, str) and len(version) == 32

    answer = _patch(client, user_a, {"modules": {"gym": False}})
    assert answer.status_code == 200
    changed = answer.json()["preferences_version"]
    assert changed != version
    assert _me(client, user_a)["preferences_version"] == changed


def test_a_matching_version_writes(client, user_a):
    version = _me(client, user_a)["preferences_version"]
    answer = _patch(client, user_a, {"modules": {"gym": False}}, version)
    assert answer.status_code == 200
    assert answer.json()["preferences"]["modules"]["gym"] is False


def test_a_stale_version_is_refused_and_writes_nothing(client, user_a):
    """The scenario: this tab read the account, another device changed it, this tab saves."""
    stale = _me(client, user_a)["preferences_version"]
    _patch(client, user_a, {"modules": {"books": False}})  # the other device

    answer = _patch(client, user_a, {"modules": {"gym": False}}, stale)
    assert answer.status_code == 409
    assert answer.json()["code"] == "preferences_changed"

    modules = _me(client, user_a)["preferences"]["modules"]
    assert modules["books"] is False
    assert modules["gym"] is True


@pytest.mark.parametrize("form", ['"{}"', 'W/"{}"', " {} "])
def test_the_etag_forms_of_the_header_are_read(client, user_a, form):
    version = _me(client, user_a)["preferences_version"]
    answer = _patch(client, user_a, {"modules": {"gym": False}}, form.format(version))
    assert answer.status_code == 200


def test_no_header_writes_as_before(client, user_a):
    """A client older than the check (an installed app not yet updated) keeps working."""
    _patch(client, user_a, {"modules": {"books": False}})
    assert _patch(client, user_a, {"modules": {"gym": False}}).status_code == 200


def test_an_empty_patch_with_a_stale_version_is_refused(client, user_a):
    stale = _me(client, user_a)["preferences_version"]
    _patch(client, user_a, {"modules": {"books": False}})
    assert _patch(client, user_a, {}, stale).status_code == 409


def test_another_accounts_version_does_not_open_this_one(client, user_a, user_b):
    """Versions are content digests, so two default accounts share one; that is fine,
    because the check only ever compares against the caller's own row."""
    _patch(client, user_b, {"modules": {"notes": False}})
    theirs = _me(client, user_b)["preferences_version"]
    answer = _patch(client, user_a, {"modules": {"gym": False}}, theirs)
    assert answer.status_code == 409
    assert _me(client, user_a)["preferences"]["modules"]["gym"] is True
