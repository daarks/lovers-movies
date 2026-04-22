from datetime import datetime, timedelta

from services import presence as P


def test_update_and_get_active():
    sid = "sess-pres-fresh"
    P.update_presence(sid, "a")
    P.update_presence(sid, "b")
    g = P.get_presence(sid)
    assert g["a"] is True and g["b"] is True


def test_stale_session_presence():
    sid = "sess-pres-stale"
    with P._lock:
        P._session_seen[sid] = {"a": datetime.utcnow() - timedelta(seconds=100)}
    assert P.get_presence(sid) == {"a": False, "b": False}


def test_couple_active_and_stale():
    cid = 7001
    P.update_couple_presence(cid, "b")
    assert P.get_couple_presence(cid) == {"a": False, "b": True}
    with P._lock:
        P._couple_seen[cid] = {"a": datetime.utcnow() - timedelta(seconds=100)}
    assert P.get_couple_presence(cid) == {"a": False, "b": False}
