"""Associa ISO 3166-1 alpha-2 a ids de paths no SVG do mapa-múndi (Wikimedia low-res)."""
from __future__ import annotations

import re
import unicodedata
from functools import lru_cache
from pathlib import Path

import pycountry

# Casos em que o nome no SVG não coincide com pycountry.name.lower().
_ISO_TO_PATH_IDS: dict[str, tuple[str, ...]] = {
    "US": ("usa",),
    "GB": ("britain",),
    "JP": ("honshu", "hokkaido", "kyushu", "shikoku"),
    "KR": ("south korea",),
    "KP": ("north korea",),
    "CZ": ("czech",),
    "CI": ("ivoire",),
    "AE": ("united arab emirates",),
    "BO": ("bolivia",),
    "BA": ("bosnia",),
    "CD": ("congo",),  # SVG não distingue CD/CG
    "CG": ("congo",),
    "FM": ("micronesia",),
    "LA": ("laos",),
    "MD": ("moldova",),
    "RU": ("russia",),
    "SK": ("slovakia",),
    "VN": ("vietnam",),
    "TZ": ("tanzania",),
    "VE": ("venezuela",),
    "SY": ("syria",),
    "SS": ("south_sudan",),
    "SD": ("sudan",),
}


def _strip_accents(s: str) -> str:
    nk = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nk if not unicodedata.combining(c))


@lru_cache(maxsize=1)
def _svg_path_ids() -> frozenset[str]:
    svg_path = Path(__file__).resolve().parent.parent / "static" / "world-countries.svg"
    if not svg_path.is_file():
        return frozenset()
    text = svg_path.read_text(encoding="utf-8", errors="ignore")
    raw = set(re.findall(r'id="([^"]+)"', text))
    skip_prefixes = (
        "defs",
        "metadata",
        "svg",
        "namedview",
        "path-effect",
        "desc",
        "inkscape",
        "sodipodi",
        "showgrid",
    )
    out: set[str] = set()
    for x in raw:
        if not x or x.startswith(skip_prefixes) or "view" in x:
            continue
        out.add(x)
    return frozenset(out)


def path_ids_for_iso(iso: str) -> list[str]:
    """Lista de ids de `<path id="...">` no SVG para pintar o país (pode ser >1)."""
    u = (iso or "").strip().upper()
    if len(u) != 2:
        return []
    ids = _svg_path_ids()
    if not ids:
        return []
    if u in _ISO_TO_PATH_IDS:
        return [p for p in _ISO_TO_PATH_IDS[u] if p in ids]
    try:
        c = pycountry.countries.get(alpha_2=u)
    except (KeyError, LookupError, TypeError):
        return []
    candidates: list[str] = []
    for attr in ("name", "common_name", "official_name"):
        v = getattr(c, attr, None)
        if not v:
            continue
        s = str(v).strip().lower()
        candidates.append(s)
        candidates.append(s.split(",")[0].strip())
    for cand in candidates:
        if not cand:
            continue
        if cand in ids:
            return [cand]
        no_acc = _strip_accents(cand)
        if no_acc in ids:
            return [no_acc]
        # Hífens vs espaços (ex.: "guinea-bissau" / "guinea bissau")
        alt = cand.replace("-", " ")
        if alt in ids:
            return [alt]
    # Último recurso: primeira palavra (ex.: "congo, the democratic" -> "congo")
    first = candidates[0].split()[0] if candidates else ""
    if first and first in ids:
        return [first]
    return []


# Nomes em pt-BR para países muito frequentes no TMDB (fallback: pycountry em inglês).
_PT_NAME: dict[str, str] = {
    "BR": "Brasil",
    "US": "Estados Unidos",
    "PT": "Portugal",
    "ES": "Espanha",
    "FR": "França",
    "DE": "Alemanha",
    "IT": "Itália",
    "GB": "Reino Unido",
    "AR": "Argentina",
    "MX": "México",
    "JP": "Japão",
    "KR": "Coreia do Sul",
    "CN": "China",
    "IN": "Índia",
    "CA": "Canadá",
    "AU": "Austrália",
    "RU": "Rússia",
    "CO": "Colômbia",
    "CL": "Chile",
    "NL": "Países Baixos",
    "SE": "Suécia",
    "NO": "Noruega",
    "DK": "Dinamarca",
    "FI": "Finlândia",
    "PL": "Polónia",
    "TR": "Turquia",
    "GR": "Grécia",
    "IE": "Irlanda",
    "NZ": "Nova Zelândia",
    "ZA": "África do Sul",
    "EG": "Egipto",
    "NG": "Nigéria",
    "BE": "Bélgica",
    "CH": "Suíça",
    "AT": "Áustria",
    "CZ": "Chéquia",
    "HU": "Hungria",
    "RO": "Roménia",
    "IL": "Israel",
    "AE": "Emirados Árabes Unidos",
}


def country_label_pt(iso: str) -> str:
    u = (iso or "").strip().upper()
    if u in _PT_NAME:
        return _PT_NAME[u]
    try:
        c = pycountry.countries.get(alpha_2=u)
        return c.name
    except (KeyError, LookupError, TypeError, AttributeError):
        return u or "—"


def enrich_countries_for_map(rows: list[dict]) -> list[dict]:
    """Acrescenta `path_ids` a cada `{"iso": "BR", "count": n}`."""
    out = []
    for row in rows:
        iso = (row.get("iso") or "").upper()
        path_ids = path_ids_for_iso(iso)
        d = dict(row)
        d["path_ids"] = path_ids
        d["label_pt"] = country_label_pt(iso)
        out.append(d)
    return out
