"""Trivia a partir da Wikipedia (API REST/query) com sanitização."""
from __future__ import annotations

import html
import re
from typing import Any
from urllib.parse import quote

import requests

from services.http_resilience import request_with_retry

_WIKI_API = "https://pt.wikipedia.org/w/api.php"
_SESSION = requests.Session()
_SESSION.headers.update(
    {
        "User-Agent": "MoviesCoupleApp/1.0 (https://example.local; contato@example.local)",
        "Accept": "application/json",
    }
)


def _strip_wiki_noise(text: str) -> str:
    s = html.unescape(text or "")
    s = re.sub(r"\{\{[^}]+\}\}", " ", s)
    s = re.sub(r"\[\[([^|\]]+)\|([^\]]+)\]\]", r"\2", s)
    s = re.sub(r"\[\[([^\]]+)\]\]", r"\1", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) > 900:
        s = s[:897].rsplit(" ", 1)[0] + "…"
    return s


def fetch_wikipedia_summary(title_pt: str, *, timeout: float = 12.0) -> dict[str, Any] | None:
    """
    Busca resumo por título (pt). Retorna dict com title, extract, url ou None.
    """
    if not title_pt or not str(title_pt).strip():
        return None
    params = {
        "action": "query",
        "format": "json",
        "prop": "extracts",
        "exintro": 1,
        "explaintext": 1,
        "titles": title_pt.strip(),
        "redirects": 1,
    }
    try:
        r = request_with_retry(
            _SESSION,
            "GET",
            _WIKI_API,
            params=params,
            timeout=timeout,
            max_attempts=3,
        )
        r.raise_for_status()
        data = r.json()
    except requests.RequestException:
        return None
    q = (data.get("query") or {}).get("pages") or {}
    for _pid, page in q.items():
        if page.get("missing"):
            continue
        title = page.get("title") or title_pt
        ext = page.get("extract") or ""
        ext = _strip_wiki_noise(ext)
        if not ext:
            continue
        safe_title = quote(title.replace(" ", "_"))
        url = f"https://pt.wikipedia.org/wiki/{safe_title}"
        return {
            "source": "wikipedia",
            "title": title,
            "summary": ext,
            "url": url,
        }
    return None


def wikidata_entity_url_from_imdb(imdb_id: str | None) -> str | None:
    """Link genérico para busca Wikidata por IMDB (sem SPARQL na Fase 1)."""
    if not imdb_id or not str(imdb_id).strip():
        return None
    imdb = str(imdb_id).strip()
    if not re.match(r"^tt\d+$", imdb):
        return None
    return f"https://www.wikidata.org/wiki/Special:EntityData/{imdb}.json"
