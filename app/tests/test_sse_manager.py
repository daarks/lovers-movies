import queue

import pytest

from services.sse_manager import SSEManager


def test_subscribe_broadcast_unsubscribe():
    m = SSEManager()
    sid = "sess-test-1"
    q1 = m.subscribe(sid, "a")
    q2 = m.subscribe(sid, "b")
    m.broadcast(sid, {"type": "ping", "n": 1})
    assert q1.get(timeout=1) == {"type": "ping", "n": 1}
    assert q2.get(timeout=1) == {"type": "ping", "n": 1}
    m.unsubscribe(sid, q1)
    m.broadcast(sid, {"type": "ping", "n": 2})
    with pytest.raises(queue.Empty):
        q1.get(timeout=0.05)
    assert q2.get(timeout=1) == {"type": "ping", "n": 2}
    m.unsubscribe(sid, q2)


def test_broadcast_to_profile():
    m = SSEManager()
    sid = "sess-test-2"
    qa = m.subscribe(sid, "a")
    qb = m.subscribe(sid, "b")
    m.broadcast_to_profile(sid, "a", {"only": "a"})
    assert qa.get(timeout=1) == {"only": "a"}
    with pytest.raises(queue.Empty):
        qb.get(timeout=0.05)
    m.unsubscribe(sid, qa)
    m.unsubscribe(sid, qb)


def test_couple_broadcast():
    m = SSEManager()
    q = m.subscribe_couple(99)
    m.broadcast_couple(99, {"type": "match"})
    assert q.get(timeout=1) == {"type": "match"}
    m.unsubscribe_couple(99, q)
    m.broadcast_couple(99, {"type": "x"})
    with pytest.raises(queue.Empty):
        q.get(timeout=0.05)
