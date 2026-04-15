import pytest

from services.swipe_fsm import transition_on_swipe


@pytest.mark.parametrize(
    "cur,prof,act,expected",
    [
        ("pending", "a", "like", "liked_a"),
        ("pending", "b", "like", "liked_b"),
        ("pending", "a", "reject", "rejected"),
        ("liked_a", "b", "like", "matched"),
        ("liked_b", "a", "like", "matched"),
        ("liked_a", "a", "like", None),
    ],
)
def test_swipe_transitions(cur, prof, act, expected):
    new_state, err = transition_on_swipe(cur, prof, act)
    if expected is None:
        assert new_state is None
        assert err
    else:
        assert err is None
        assert new_state == expected
