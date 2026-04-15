"""Busca híbrida: similaridade de embeddings + score lexical simples."""
from __future__ import annotations

import math
import re
from typing import Any


def tokenize(s: str) -> list[str]:
    return [
        t
        for t in re.split(r"[^\wàáâãäåèéêëìíîïòóôõöùúûüçñ]+", s.lower(), flags=re.UNICODE)
        if len(t) > 1
    ]


def lexical_score(query: str, doc: dict[str, Any]) -> float:
    """Score 0..1 aproximado por sobreposição de tokens."""
    qtok = set(tokenize(query))
    if not qtok:
        return 0.0
    parts = [
        doc.get("title") or "",
        doc.get("overview") or "",
        doc.get("genres_csv") or "",
        doc.get("credits_blob") or "",
    ]
    blob = " ".join(parts).lower()
    dtok = set(tokenize(blob))
    if not dtok:
        return 0.0
    inter = len(qtok & dtok)
    return min(1.0, inter / max(1, len(qtok)) * 1.2)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return max(-1.0, min(1.0, dot / (na * nb)))


def hybrid_rank_score(
    *,
    sem: float,
    lex: float,
    vote: float | None,
    w_sem: float = 0.55,
    w_lex: float = 0.35,
    w_pop: float = 0.10,
) -> float:
    pop = (vote or 0.0) / 10.0
    pop = max(0.0, min(1.0, pop))
    # sem já está em [-1,1]; mapear para [0,1]
    sem01 = (sem + 1.0) / 2.0
    return w_sem * sem01 + w_lex * lex + w_pop * pop


def filter_sensitive(
    items: list[dict[str, Any]],
    *,
    hide_horror: bool,
    hide_violence: bool,
) -> list[dict[str, Any]]:
    """Filtro opcional best-effort por palavras-chave em gêneros/overview."""
    out = []
    for it in items:
        blob = (
            (it.get("genres_csv") or "")
            + " "
            + (it.get("overview") or "")
        ).lower()
        if hide_horror and any(
            x in blob for x in ("terror", "horror", "gore", "splatter")
        ):
            continue
        if hide_violence and any(
            x in blob for x in ("violência extrema", "violencia extrema", "snuff")
        ):
            continue
        out.append(it)
    return out
