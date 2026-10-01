"""Story 41.7 — the digest's words stay translated (AD-44, lab note 2026-09-07).

``services/push.py`` keeps each digest sentence as an ``en`` and an ``fr`` entry in one
dict. A key present in one language only is a ``KeyError`` on the evening a French account
gets that clause; a sentence pasted without translating reads as English inside a French
notification. Neither is visible to the types, so this holds both.
"""

import re

from app.services.push import _WORDS

#: Entries that may legitimately be identical in both languages. ``tab_*`` are module names
#: used as proper nouns ("Notes" and "Stock" are the same word in both, and the app's own
#: tab label, not a sentence); ``more`` is punctuation with no words in it.
_MAY_MATCH = ("tab_", "more")


def test_both_languages_have_the_same_keys():
    assert set(_WORDS) == {"en", "fr"}
    assert set(_WORDS["en"]) == set(_WORDS["fr"])


def test_a_count_placeholder_is_in_both_or_neither():
    for key in _WORDS["en"]:
        placeholders = {lang: set(re.findall(r"\{\w+\}", _WORDS[lang][key])) for lang in _WORDS}
        assert placeholders["en"] == placeholders["fr"], key


def test_no_sentence_is_byte_identical_across_the_two_languages():
    pasted = [
        key
        for key, english in _WORDS["en"].items()
        if not key.startswith(_MAY_MATCH) and english == _WORDS["fr"][key]
    ]
    assert pasted == [], f"untranslated: {pasted}"


def test_the_exemption_list_is_only_names_and_punctuation():
    """The exemption cannot grow into a way to ship English: every exempt entry is either
    a ``tab_`` name (one or two words, no placeholder) or contains no letters at all."""
    for key, text in _WORDS["en"].items():
        if key.startswith("tab_"):
            assert len(text.split()) == 1 and "{" not in text, key
        if key == "more":
            assert not re.search(r"[A-Za-z]", text)
