"""Checks for the Basketball-Reference id construction (photos.py).

Only the id-building is tested: it's pure and offline. The actual BR/Wikipedia
lookups hit the network and are best-effort by design.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from photos import basketball_reference_id as bid


def test_standard_name():
    assert bid("LeBron James") == "jamesle01"


def test_apostrophe_stripped():
    assert bid("De'Aaron Fox") == "foxde01"


def test_generational_suffix_ignored():
    # last[:5] + first[:2] + "01". (The "01" means this resolves to the elder
    # Jaren Jackson, not Jr. -- the documented collision limitation.)
    assert bid("Jaren Jackson Jr.") == "jacksja01"


def test_periods_in_initials():
    assert bid("A.J. Green") == "greenaj01"


def test_single_word_name_is_none():
    assert bid("Nene") is None


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("all photo checks passed")
