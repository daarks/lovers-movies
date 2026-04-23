"""Nova sessão de swipe não deve herdar liked_a / liked_b de sessão anterior (mesmo tmdb_id)."""
from datetime import datetime

import pytest

from models import Couple, SwipeItem, db
from services.swipe_session_reset import reset_swipe_items_for_new_session_deck


@pytest.fixture
def app_ctx():
    from app import app as flask_app

    with flask_app.app_context():
        yield flask_app


def test_reset_swipe_items_for_new_session_deck(app_ctx):
    c = Couple.query.order_by(Couple.id).first()
    if not c:
        c = Couple(label="T-swipe-reset")
        db.session.add(c)
        db.session.commit()
    cid = int(c.id)
    tid = 9_990_010_333
    mt = "movie"
    SwipeItem.query.filter_by(couple_id=cid, tmdb_id=tid, media_type=mt).delete()
    db.session.commit()

    row = SwipeItem(
        couple_id=cid,
        tmdb_id=tid,
        media_type=mt,
        title="Teste",
        state="liked_a",
        vote_a="like",
        vote_b="none",
        last_session_public_id="sess-old",
        updated_at=datetime.utcnow(),
    )
    db.session.add(row)
    db.session.commit()

    deck = [{"tmdb_id": tid, "media_type": mt, "title": "Teste"}]
    reset_swipe_items_for_new_session_deck(cid, deck, "sess-new")
    db.session.commit()

    row2 = SwipeItem.query.filter_by(
        couple_id=cid, tmdb_id=tid, media_type=mt
    ).first()
    assert row2 is not None
    assert row2.state == "pending"
    assert row2.vote_a == "none"
    assert row2.vote_b == "none"
    assert row2.last_session_public_id == "sess-new"
