"""Testes unitários da Fase 2 (XP, snapshot, APIs estáveis)."""
from __future__ import annotations

import json

from gamification.snapshot import build_tmdb_snapshot, snapshot_from_json, snapshot_to_json
from gamification.xp_levels import compute_xp_for_watch, level_and_progress, xp_threshold_for_level


def test_xp_threshold_monotonic():
    assert xp_threshold_for_level(1) == 0
    assert xp_threshold_for_level(2) < xp_threshold_for_level(3)


def test_level_and_progress_starts_at_one():
    lv, into, need, title = level_and_progress(0)
    assert lv == 1
    assert into == 0
    assert need >= 1
    assert title


def test_compute_xp_for_watch_positive():
    xp, bd = compute_xp_for_watch(review_len=0, rating_avg=5.0, streak_days=0)
    assert xp > 0
    assert "base" in bd


def test_tmdb_snapshot_json_roundtrip():
    raw = {
        "genres": [{"id": 28, "name": "Ação"}],
        "production_countries": [{"iso_3166_1": "US", "name": "Estados Unidos"}],
        "credits": {
            "crew": [
                {"id": 1, "name": "Fulano", "job": "Director"},
            ]
        },
        "runtime": 120,
        "original_language": "en",
        "release_date": "2020-01-01",
    }
    snap = build_tmdb_snapshot(raw, "movie")
    js = snapshot_to_json(snap)
    back = snapshot_from_json(js)
    assert back is not None
    assert back["media_type"] == "movie"
    assert "US" in {c.get("iso") for c in back.get("production_countries") or []}


def test_api_gamification_profile_summary(flask_client):
    r = flask_client.get("/api/gamification/profile-summary")
    assert r.status_code == 200
    j = r.get_json()
    assert "total_xp" in j
    assert "level" in j


def test_api_gamification_achievements(flask_client):
    r = flask_client.get("/api/gamification/achievements")
    assert r.status_code == 200
    j = r.get_json()
    assert "items" in j
    assert isinstance(j["items"], list)


def test_perfil_page_ok_when_flag_on(flask_client):
    r = flask_client.get("/perfil")
    assert r.status_code == 200
    assert b"profile-xp-bar" in r.data


def test_mapa_page(flask_client):
    r = flask_client.get("/mapa")
    assert r.status_code == 200


def test_compare_page_requires_post_or_ids(flask_client):
    r = flask_client.get("/comparar")
    assert r.status_code == 200


def test_apostas_list_page(flask_client):
    r = flask_client.get("/apostas")
    assert r.status_code == 200
    assert b"Apostas" in r.data
