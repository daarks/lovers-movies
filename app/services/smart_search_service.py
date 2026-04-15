"""Orquestra busca híbrida (TMDB + embeddings locais)."""
from __future__ import annotations

import hashlib
import os
from typing import Any, Callable

from models import MediaEmbedding, db
from services.gemini_client import (
    embedding_from_json,
    embedding_to_json,
    gemini_embed_text,
)
from services.search_hybrid import (
    cosine_similarity,
    filter_sensitive,
    hybrid_rank_score,
    lexical_score,
)


def _embed_text_for_media(row: dict[str, Any]) -> str:
    parts = [
        row.get("title") or "",
        row.get("overview") or "",
        row.get("genres_csv") or "",
        row.get("credits_blob") or "",
    ]
    return "\n".join(p for p in parts if p).strip()[:8000]


def _hash_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:32]


def run_smart_search(
    *,
    tmdb_search_fn: Callable[..., list[dict[str, Any]]],
    tmdb_details_fn: Callable[[str, int], dict[str, Any] | None],
    query: str,
    search_type: str,
    hide_horror: bool,
    hide_violence: bool,
    gemini_key: str | None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    `tmdb_search_fn(query, search_type)` -> candidatos com id, title, media_type, poster, overview, vote_average
    `tmdb_details_fn(media_type, tmdb_id)` -> enriquecimento opcional
    Retorna (resultados, meta debug)
    """
    meta: dict[str, Any] = {"mode": "hybrid", "semantic": bool(gemini_key)}
    q = (query or "").strip()
    if not q or len(q) > 280:
        return [], {**meta, "error": "consulta vazia ou longa demais"}

    raw = tmdb_search_fn(q, search_type)
    if not raw:
        return [], {**meta, "note": "sem candidatos TMDB"}

    enriched: list[dict[str, Any]] = []
    for item in raw[:24]:
        mt = item.get("media_type")
        tid = item.get("id")
        if mt not in ("movie", "tv") or not tid:
            continue
        row = {**item}
        det = tmdb_details_fn(mt, int(tid))
        if det:
            row["overview"] = det.get("overview") or row.get("overview") or ""
            row["genres_csv"] = det.get("genres_csv") or row.get("genres_csv") or ""
            row["credits_blob"] = det.get("credits_blob") or ""
            row["vote_average"] = det.get("vote_average", row.get("vote_average"))
        enriched.append(row)

    enriched = filter_sensitive(
        enriched,
        hide_horror=hide_horror,
        hide_violence=hide_violence,
    )
    if not enriched:
        return [], {**meta, "note": "filtros sensíveis removeram todos"}

    q_vec: list[float] | None = None
    if gemini_key:
        q_vec, err = gemini_embed_text(gemini_key, q)
        if err:
            meta["embed_query_error"] = err[:200]
            q_vec = None

    scored: list[tuple[float, dict[str, Any]]] = []
    for row in enriched:
        tid = int(row["id"])
        mt = str(row["media_type"])
        text_blob = _embed_text_for_media(row)
        h = _hash_text(text_blob)
        sem = 0.0
        if q_vec:
            existing = MediaEmbedding.query.filter_by(
                tmdb_id=tid, media_type=mt
            ).first()
            vec: list[float] | None = None
            if (
                existing
                and existing.indexed_text_hash == h
                and existing.embedding_json
            ):
                vec = embedding_from_json(existing.embedding_json)
            elif gemini_key and text_blob:
                vec, e2 = gemini_embed_text(gemini_key, text_blob)
                if vec:
                    if existing:
                        existing.embedding_json = embedding_to_json(vec)
                        existing.indexed_text_hash = h
                        existing.title = row.get("title") or existing.title
                        existing.overview = row.get("overview")
                        existing.genres_csv = row.get("genres_csv")
                        existing.credits_blob = row.get("credits_blob")
                        existing.vote_average = row.get("vote_average")
                    else:
                        db.session.add(
                            MediaEmbedding(
                                tmdb_id=tid,
                                media_type=mt,
                                title=row.get("title") or "",
                                overview=row.get("overview"),
                                genres_csv=row.get("genres_csv"),
                                credits_blob=row.get("credits_blob"),
                                vote_average=row.get("vote_average"),
                                indexed_text_hash=h,
                                embedding_json=embedding_to_json(vec),
                            )
                        )
                    try:
                        db.session.commit()
                    except Exception:
                        db.session.rollback()
                elif e2:
                    meta.setdefault("embed_media_warnings", []).append(
                        f"{mt}:{tid}:{e2[:80]}"
                    )
            if vec and q_vec:
                sem = cosine_similarity(q_vec, vec)

        lex = lexical_score(q, row)
        vote = row.get("vote_average")
        if isinstance(vote, (int, float)):
            vf = float(vote)
        else:
            vf = None
        score = hybrid_rank_score(sem=sem, lex=lex, vote=vf)
        scored.append((score, row))

    scored.sort(key=lambda x: -x[0])
    out = []
    for _sc, row in scored[:20]:
        out.append(
            {
                "id": row.get("id"),
                "title": row.get("title"),
                "media_type": row.get("media_type"),
                "poster_path": row.get("poster_path"),
                "release_date": row.get("release_date"),
                "overview": (row.get("overview") or "")[:500],
            }
        )
    return out, meta
