def test_healthz(flask_client):
    r = flask_client.get("/healthz")
    assert r.status_code == 200
    assert r.is_json
    assert r.get_json().get("status") == "ok"


def test_metrics(flask_client):
    r = flask_client.get("/metrics")
    assert r.status_code == 200
    j = r.get_json()
    assert "tmdb_cache_hits" in j
    assert "gamification_v2" in j
    assert "bets_enabled" in j
    assert "seasons_enabled" in j
