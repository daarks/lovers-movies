"""Extrai snapshot estável do payload TMDB para persistência e conquistas."""
from __future__ import annotations

import json
from typing import Any


def build_tmdb_snapshot(tmdb_data: dict[str, Any], media_type: str) -> dict[str, Any]:
    genres = tmdb_data.get("genres") or []
    genre_ids = [int(g["id"]) for g in genres if g.get("id") is not None]
    genre_names = [g.get("name") for g in genres if g.get("name")]

    countries = []
    for c in tmdb_data.get("production_countries") or []:
        iso = (c.get("iso_3166_1") or "").strip().upper()
        if iso:
            countries.append({"iso": iso, "name": (c.get("name") or "").strip()})

    credits = tmdb_data.get("credits") or {}
    crew = credits.get("crew") or []
    director_ids: list[int] = []
    director_names: list[str] = []
    seen_d: set[int] = set()
    for p in crew:
        if p.get("job") not in ("Director", "Co-Director"):
            continue
        pid = p.get("id")
        if not pid or pid in seen_d:
            continue
        seen_d.add(int(pid))
        director_ids.append(int(pid))
        nm = (p.get("name") or "").strip()
        if nm:
            director_names.append(nm)

    runtime = tmdb_data.get("runtime") if media_type == "movie" else None
    if media_type == "tv":
        ert = tmdb_data.get("episode_run_time") or []
        if ert:
            runtime = int(sum(ert) / len(ert))

    keywords_payload = tmdb_data.get("keywords") or {}
    raw_keywords = (
        keywords_payload.get("keywords")
        if isinstance(keywords_payload, dict)
        else None
    )
    if raw_keywords is None and isinstance(keywords_payload, dict):
        raw_keywords = keywords_payload.get("results") or []
    if not isinstance(raw_keywords, list):
        raw_keywords = []
    keyword_ids: list[int] = []
    keyword_names: list[str] = []
    seen_k: set[int] = set()
    for kw in raw_keywords:
        if not isinstance(kw, dict):
            continue
        try:
            kid = int(kw.get("id"))
        except (TypeError, ValueError):
            continue
        if kid in seen_k:
            continue
        seen_k.add(kid)
        keyword_ids.append(kid)
        nm = (kw.get("name") or "").strip()
        if nm:
            keyword_names.append(nm)

    return {
        "media_type": media_type,
        "genre_ids": genre_ids,
        "genre_names": genre_names,
        "production_countries": countries,
        "director_ids": director_ids[:24],
        "director_names": director_names[:24],
        "runtime": runtime,
        "original_language": (tmdb_data.get("original_language") or "").strip(),
        "release_year": _year_from_date(
            tmdb_data.get("release_date")
            if media_type == "movie"
            else tmdb_data.get("first_air_date")
        ),
        "keyword_ids": keyword_ids[:64],
        "keyword_names": keyword_names[:64],
    }


def _year_from_date(s: str | None) -> int | None:
    if not s or len(str(s)) < 4:
        return None
    try:
        return int(str(s)[:4])
    except ValueError:
        return None


def snapshot_to_json(snapshot: dict[str, Any]) -> str:
    return json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))


def snapshot_from_json(raw: str | None) -> dict[str, Any] | None:
    if not raw or not str(raw).strip():
        return None
    try:
        d = json.loads(raw)
        return d if isinstance(d, dict) else None
    except json.JSONDecodeError:
        return None
