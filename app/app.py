# Aplicação Flask: rastreador de filmes e séries com integração TMDB (proxy no servidor).
# O token TMDB nunca é enviado ao navegador — apenas requisições servidor → TMDB.
import json
import logging
import os
import queue
import random
import uuid
import re
import time
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import date, datetime, timedelta, timezone
from typing import Any
from pathlib import Path

import requests
from flask import (
    Flask,
    Response,
    abort,
    current_app,
    g,
    has_request_context,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)
from flask.sessions import SecureCookieSessionInterface
from werkzeug.middleware.proxy_fix import ProxyFix
from markupsafe import Markup
from flask_caching import Cache
from sqlalchemy import and_, desc, func, inspect, or_, text

from models import (
    AchievementProgress,
    Couple,
    CoupleXpState,
    DailyWatchEntry,
    TvEpisodeMark,
    GameSeason,
    GamificationEvent,
    Profile,
    SeasonProfileScore,
    SwipeItem,
    SwipeSessionMatch,
    SwipeSession,
    TodayPick,
    TriviaCache,
    WatchedItem,
    WatchBet,
    WatchLaterItem,
    MediaList,
    MediaListItem,
    WatchProfileRating,
    XpLedgerEntry,
    db,
)
from services.gemini_client import gemini_generate_text
from services.gemini_http_timeout import gemini_http_timeout_ms
from services.smart_search_service import run_smart_search
from services.structured_logging import IntegrationTimer
from services import presence as presence_service
from services.sse_manager import sse_manager
from services.swipe_fsm import transition_on_swipe
from services.swipe_session_reset import reset_swipe_items_for_new_session_deck
from services.http_resilience import request_with_retry
from services.tmdb_cached import tmdb_get_json_cached
from services.trivia_wiki import fetch_wikipedia_summary
from gamification.feature_flags import (
    bets_enabled,
    gamification_v2_enabled,
    seasons_enabled,
)
from gamification.display_pt import (
    achievement_icon_pt,
    achievement_title_pt,
    bet_status_pt,
    xp_reason_pt,
)
from gamification.snapshot import build_tmdb_snapshot, snapshot_to_json

# Base da API TMDB (todas as chamadas autenticadas no backend).
TMDB_BASE = "https://api.themoviedb.org/3"
TMDB_LANG = "pt-BR"

# Gemini: SDK oficial google-genai (não usar google.generativeai, está descontinuado).
# Nomes de modelo: ver https://ai.google.dev/gemini-api/docs/models — alias comuns mapeados abaixo.
GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-lite-preview"

# Nomes antigos / do exemplo deprecated que não existem na API atual
_GEMINI_MODEL_ALIASES = {
    "gemini-3-pro": "gemini-3-pro-preview",
    "gemini-3-flash": "gemini-3-flash-preview",
}

BASE_DIR = Path(__file__).resolve().parent
INSTANCE_DIR = BASE_DIR / "instance"
INSTANCE_DIR.mkdir(parents=True, exist_ok=True)

cache = Cache()
_TMDB_SESSION = requests.Session()


class _SessionCookieByRequestIsSecure(SecureCookieSessionInterface):
    """Cookie de sessão Secure só com HTTPS (ou X-Forwarded-Proto via ProxyFix)."""

    def get_cookie_secure(self, app) -> bool:
        if has_request_context():
            return bool(request.is_secure)
        return bool(app.config.get("SESSION_COOKIE_SECURE", False))


def _parse_exclude_drawn(body: dict[str, Any]) -> set[tuple[str, int]]:
    """IDs já sorteados na aba atual (lista enviada pelo cliente, sessionStorage).

    Formato: ``exclude_drawn``: ``[{\"id\": 123, \"media_type\": \"movie\"}, ...]``
    """
    raw = body.get("exclude_drawn")
    if not isinstance(raw, list):
        return set()
    out: set[tuple[str, int]] = set()
    for x in raw[:500]:
        if not isinstance(x, dict):
            continue
        mt = x.get("media_type")
        if mt not in ("movie", "tv"):
            continue
        tid = x.get("id")
        try:
            tid_i = int(tid)
        except (TypeError, ValueError):
            continue
        out.add((str(mt), tid_i))
    return out


def _load_secrets_env():
    """Carrega `secrets.env` na raiz do repositório (ao lado de `app/`).

    Não sobrescreve variáveis já definidas no ambiente (ex.: systemd
    com `EnvironmentFile=/etc/movies-app.env`).
    """
    path = BASE_DIR.parent / "secrets.env"
    if not path.is_file():
        return
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        if not key:
            continue
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        existing = os.environ.get(key)
        if existing is not None and str(existing).strip() != "":
            continue
        os.environ[key] = val


_load_secrets_env()


# TMDB: novelas / telenovelas usam o gênero interno "Soap" (pt-BR costuma vir como "Novela" no nome).
SOAP_NOVELA_GENRE_ID = 10766
# Palavra-chave "anime" no TMDB (desenhos japoneses / animação japonesa catalogada assim).
ANIME_KEYWORD_ID = 210024
TMDB_REGION_BR = "BR"

# TMDB devolve status frequentemente em inglês mesmo com language=pt-BR
_TMDB_SHOW_TYPE_PT = {
    "Scripted": "Ficção (roteirizada)",
    "Reality": "Reality show",
    "Documentary": "Documentário",
    "News": "Jornalismo",
    "Talk Show": "Talk show",
    "Video": "Vídeo",
    "Miniseries": "Minissérie",
}


_TMDB_STATUS_PT = {
    "Released": "Lançado",
    "Post Production": "Pós-produção",
    "In Production": "Em produção",
    "Planned": "Planejado",
    "Canceled": "Cancelado",
    "Cancelled": "Cancelado",
    "Ended": "Encerrada",
    "Returning Series": "Série em exibição",
    "Pilot": "Episódio piloto",
    "Rumored": "Rumor",
    "In Development": "Em desenvolvimento",
}


def _pt_tmdb_status(value):
    if not value:
        return value
    return _TMDB_STATUS_PT.get(str(value).strip(), value)


def _split_genres_csv(s: str):
    """Separa o campo de gêneros salvo (CSV do TMDB em pt-BR) em nomes."""
    if not s or not str(s).strip():
        return []
    return [x.strip() for x in str(s).split(",") if x.strip()]


# Nomes de gênero em inglês (TMDB / dados antigos) → rótulo em português na UI
_GENRE_EN_TO_PT = {
    "action": "Ação",
    "adventure": "Aventura",
    "animation": "Animação",
    "comedy": "Comédia",
    "crime": "Crime",
    "documentary": "Documentário",
    "drama": "Drama",
    "family": "Família",
    "fantasy": "Fantasia",
    "history": "História",
    "horror": "Terror",
    "music": "Música",
    "mystery": "Mistério",
    "romance": "Romance",
    "science fiction": "Ficção científica",
    "sci-fi & fantasy": "Ficção científica e fantasia",
    "tv movie": "Filme de TV",
    "thriller": "Suspense",
    "war": "Guerra",
    "western": "Faroeste",
    "soap": "Novela",
}


def _genre_label_pt(name: str) -> str:
    if not name:
        return name
    key = str(name).strip().lower()
    return _GENRE_EN_TO_PT.get(key, str(name).strip())


# Gênero TMDB (nome pt-BR típico) -> token CSS `data-genre-theme` (Fase 2 UI)
_GENRE_PT_TO_THEME_SLUG = {
    "Ação": "acao",
    "Aventura": "aventura",
    "Animação": "animacao",
    "Comédia": "comedia",
    "Crime": "crime",
    "Documentário": "documentario",
    "Drama": "drama",
    "Família": "familia",
    "Fantasia": "fantasia",
    "História": "historia",
    "Terror": "terror",
    "Música": "musica",
    "Mistério": "misterio",
    "Romance": "romance",
    "Ficção científica": "ficcao",
    "Ficção científica e fantasia": "ficcao",
    "Filme de TV": "tv_movie",
    "Suspense": "suspense",
    "Guerra": "guerra",
    "Faroeste": "western",
    "Novela": "novela",
    "Reality": "reality",
    "Action": "acao",
    "Adventure": "aventura",
    "Animation": "animacao",
    "Comedy": "comedia",
    "Horror": "terror",
    "Thriller": "suspense",
    "Science Fiction": "ficcao",
    "War": "guerra",
    "Western": "western",
    "Soap": "novela",
}


def _dominant_genre_theme_slug(genres_list) -> str:
    for g in genres_list or []:
        slug = _GENRE_PT_TO_THEME_SLUG.get(str(g).strip())
        if slug:
            return slug
    return "default"


def star_fills(rating):
    """Para cada uma das 10 estrelas, fração preenchida (0–1)."""
    try:
        r = float(rating)
    except (TypeError, ValueError):
        r = 0.0
    r = max(0.0, min(10.0, r))
    return [max(0.0, min(1.0, r - (i - 1))) for i in range(1, 11)]


def _ensure_watched_schema():
    """Adiciona coluna season_data em bancos antigos (SQLite)."""
    try:
        insp = inspect(db.engine)
        cols = {c["name"] for c in insp.get_columns("watched_items")}
        if "season_data" not in cols:
            with db.engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE watched_items ADD COLUMN season_data TEXT")
                )
    except Exception:
        pass


def _ensure_phase1_seed():
    """Casal único local + dois perfis (Fase 1)."""
    try:
        if Couple.query.count() == 0:
            c = Couple(label="Nós")
            db.session.add(c)
            db.session.flush()
            db.session.add(
                Profile(
                    couple_id=c.id,
                    slug="a",
                    display_name="Princesinha",
                )
            )
            db.session.add(
                Profile(
                    couple_id=c.id,
                    slug="b",
                    display_name="Gabe",
                )
            )
            db.session.commit()
    except Exception:
        db.session.rollback()


def _ensure_profile_display_names():
    """Atualiza nomes padrão antigos (Perfil A/B) para Princesinha/Gabe."""
    try:
        mapping = {
            ("a", "Perfil A"): "Princesinha",
            ("b", "Perfil B"): "Gabe",
        }
        for (slug, old_name), new_name in mapping.items():
            row = Profile.query.filter_by(slug=slug, display_name=old_name).first()
            if row:
                row.display_name = new_name
        db.session.commit()
    except Exception:
        db.session.rollback()


def _ensure_phase2_schema():
    """Colunas novas SQLite (Fase 2 gamificação). Tabelas novas via db.create_all."""
    try:
        insp = inspect(db.engine)
        cols = {c["name"] for c in insp.get_columns("watched_items")}
        if "tmdb_snapshot_json" not in cols:
            with db.engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE watched_items ADD COLUMN tmdb_snapshot_json TEXT"
                    )
                )
    except Exception:
        pass


def _ensure_swipe_session_public_id():
    """Coluna public_id em swipe_sessions (SQLite)."""
    try:
        insp = inspect(db.engine)
        if "swipe_sessions" not in insp.get_table_names():
            return
        cols = {c["name"] for c in insp.get_columns("swipe_sessions")}
        if "public_id" not in cols:
            with db.engine.begin() as conn:
                conn.execute(text("ALTER TABLE swipe_sessions ADD COLUMN public_id VARCHAR(40)"))
    except Exception:
        pass


def _ensure_swipe_session_profile_cursors():
    """Cursores por perfil (A/B) no swipe — deck igual, posição independente."""
    try:
        insp = inspect(db.engine)
        if "swipe_sessions" not in insp.get_table_names():
            return
        cols = {c["name"] for c in insp.get_columns("swipe_sessions")}
        added = False
        with db.engine.begin() as conn:
            if "cursor_index_a" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE swipe_sessions ADD COLUMN cursor_index_a INTEGER NOT NULL DEFAULT 0"
                    )
                )
                added = True
            if "cursor_index_b" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE swipe_sessions ADD COLUMN cursor_index_b INTEGER NOT NULL DEFAULT 0"
                    )
                )
                added = True
        if added:
            with db.engine.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE swipe_sessions SET cursor_index_a = cursor_index, "
                        "cursor_index_b = cursor_index"
                    )
                )
    except Exception:
        pass


def _ensure_swipe_session_list_id():
    """Coluna list_id em swipe_sessions (deck a partir de lista customizada)."""
    try:
        insp = inspect(db.engine)
        if "swipe_sessions" not in insp.get_table_names():
            return
        cols = {c["name"] for c in insp.get_columns("swipe_sessions")}
        if "list_id" not in cols:
            with db.engine.begin() as conn:
                conn.execute(text("ALTER TABLE swipe_sessions ADD COLUMN list_id INTEGER"))
    except Exception:
        pass


def _ensure_swipe_item_votes_schema():
    """Campos de voto por perfil no swipe_items (SQLite)."""
    try:
        insp = inspect(db.engine)
        if "swipe_items" not in insp.get_table_names():
            return
        cols = {c["name"] for c in insp.get_columns("swipe_items")}
        with db.engine.begin() as conn:
            if "vote_a" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE swipe_items ADD COLUMN vote_a VARCHAR(8) NOT NULL DEFAULT 'none'"
                    )
                )
            if "vote_b" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE swipe_items ADD COLUMN vote_b VARCHAR(8) NOT NULL DEFAULT 'none'"
                    )
                )
            if "last_session_public_id" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE swipe_items ADD COLUMN last_session_public_id VARCHAR(40)"
                    )
                )
            # Backfill para linhas antigas (antes de vote_a/vote_b).
            conn.execute(
                text(
                    "UPDATE swipe_items SET vote_a='like' "
                    "WHERE state='liked_a' AND COALESCE(vote_a,'none')='none'"
                )
            )
            conn.execute(
                text(
                    "UPDATE swipe_items SET vote_b='like' "
                    "WHERE state='liked_b' AND COALESCE(vote_b,'none')='none'"
                )
            )
            conn.execute(
                text(
                    "UPDATE swipe_items SET vote_a='like', vote_b='like' "
                    "WHERE state='matched' "
                    "AND (COALESCE(vote_a,'none')='none' OR COALESCE(vote_b,'none')='none')"
                )
            )
            conn.execute(
                text(
                    "UPDATE swipe_items SET vote_a='reject', vote_b='reject' "
                    "WHERE state='rejected' "
                    "AND (COALESCE(vote_a,'none')='none' OR COALESCE(vote_b,'none')='none')"
                )
            )
    except Exception:
        pass


def _tv_season_rows(saved, number_of_seasons: int):
    """Linhas para o formulário: temporadas 1..N com nota/resenha carregadas."""
    try:
        n = int(number_of_seasons or 1)
    except (TypeError, ValueError):
        n = 1
    n = max(1, min(n, 50))
    loaded = {}
    if saved and getattr(saved, "season_data", None):
        try:
            raw = json.loads(saved.season_data)
            if isinstance(raw, dict):
                for k, v in raw.items():
                    if not str(k).isdigit():
                        continue
                    sk = str(int(k))
                    if isinstance(v, dict):
                        loaded[sk] = v
        except (json.JSONDecodeError, ValueError, TypeError):
            pass
    if saved and not loaded and saved.rating is not None:
        try:
            rv = float(saved.rating)
            if 0.5 <= rv <= 10 and abs(rv * 2 - round(rv * 2)) <= 1e-6:
                loaded["1"] = {
                    "rating": rv,
                    "review": (saved.review or ""),
                }
        except (TypeError, ValueError):
            pass
    rows = []
    for i in range(1, n + 1):
        s = str(i)
        cell = loaded.get(s, {})
        rating_val = cell.get("rating") if isinstance(cell, dict) else None
        try:
            rfloat = float(rating_val) if rating_val is not None else None
        except (TypeError, ValueError):
            rfloat = None
        if rfloat is not None:
            if rfloat < 0.5 or rfloat > 10 or abs(rfloat * 2 - round(rfloat * 2)) > 1e-6:
                rfloat = None
        rev = ""
        if isinstance(cell, dict) and cell.get("review"):
            rev = str(cell.get("review")).strip()
        rows.append({"num": i, "rating": rfloat, "review": rev})
    return rows


def _parse_tv_season_json(raw: str):
    """Valida JSON do front e devolve temporadas limpas + média."""
    if not raw or not str(raw).strip():
        return None, "Envie as avaliações por temporada."
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None, "Dados de temporadas inválidos."
    if not isinstance(data, dict):
        return None, "Formato de temporadas inválido."
    cleaned = {}
    for k, v in data.items():
        if not str(k).isdigit():
            continue
        sn = str(int(k))
        if not isinstance(v, dict):
            continue
        try:
            rv = float(v.get("rating"))
        except (TypeError, ValueError):
            continue
        if rv < 0.5 or rv > 10:
            continue
        if abs(rv * 2 - round(rv * 2)) > 1e-6:
            continue
        rev = v.get("review")
        cleaned[sn] = {
            "rating": float(rv),
            "review": (str(rev).strip() if rev is not None else ""),
        }
    if not cleaned:
        return (
            None,
            "Marque ao menos uma temporada com nota entre 0,5 e 10 (passos de 0,5).",
        )
    ratings = [x["rating"] for x in cleaned.values()]
    avg = round(sum(ratings) / len(ratings), 2)
    return {"seasons": cleaned, "average": avg}, None


def _watched_stats(items):
    """Agrega contagens e percentuais para a página de estatísticas."""
    n = len(items)
    n_movie = sum(1 for i in items if i.media_type == "movie")
    n_tv = sum(1 for i in items if i.media_type == "tv")
    genre_counts = {}
    for it in items:
        for g in _split_genres_csv(it.genres or ""):
            label = _genre_label_pt(g)
            genre_counts[label] = genre_counts.get(label, 0) + 1
    genre_rows = []
    for name, cnt in sorted(
        genre_counts.items(),
        key=lambda x: (-x[1], x[0].lower()),
    ):
        pct = round(100.0 * cnt / n, 1) if n else 0.0
        genre_rows.append({"name": name, "count": cnt, "percent": pct})
    return {
        "total": n,
        "n_movie": n_movie,
        "n_tv": n_tv,
        "pct_movie": round(100.0 * n_movie / n, 1) if n else 0.0,
        "pct_tv": round(100.0 * n_tv / n, 1) if n else 0.0,
        "genres": genre_rows,
    }


def _fmt_usd_compact(value):
    """Formata orçamento/receita em dólares para exibição."""
    if value is None or value == 0:
        return None
    try:
        v = int(value)
    except (TypeError, ValueError):
        return None
    if v >= 1_000_000:
        return f"US$ {v / 1_000_000:.1f} milhões"
    return f"US$ {v:,}".replace(",", ".")


def _youtube_trailer_key(tmdb_data):
    """Primeiro trailer do YouTube nos vídeos anexados."""
    vids = (tmdb_data.get("videos") or {}).get("results") or []
    for v in vids:
        if v.get("site") == "YouTube" and v.get("type") in (
            "Trailer",
            "Teaser",
        ):
            return v.get("key")
    for v in vids:
        if v.get("site") == "YouTube":
            return v.get("key")
    return None


def _crew_unique_people(crew, jobs_filter):
    """Pessoas da equipe com foto, sem duplicar por nome."""
    seen = set()
    out = []
    for p in crew:
        if p.get("job") not in jobs_filter:
            continue
        name = p.get("name")
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(_crew_person_dict(p))
    return out


def _crew_writers_all(crew):
    """Roteiristas e colaboradores de escrita (vários cargos TMDB)."""
    writing_jobs = {
        "Screenplay",
        "Writer",
        "Story",
        "Teleplay",
        "Characters",
        "Novel",
        "Idea",
    }
    seen = set()
    out = []
    for p in crew:
        job = p.get("job") or ""
        if job not in writing_jobs and p.get("department") != "Writing":
            continue
        name = p.get("name")
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(_crew_person_dict(p))
    return out


def _cast_billing_order(person):
    """
    Ordem de relevância do elenco no TMDB: campo `order`, menor = mais destaque (0 = principal).
    """
    o = person.get("order")
    if o is None:
        return 9999
    try:
        return int(o)
    except (TypeError, ValueError):
        return 9999


def _details_credit_lines(tmdb_data, media_type):
    """Linhas curtas para a página de detalhes: direção e escrita (pt-BR nos nomes quando a API envia)."""
    credits = tmdb_data.get("credits") or {}
    crew = credits.get("crew") or []
    directors = []
    seen_d = set()
    for p in crew:
        if p.get("job") in ("Director", "Co-Director"):
            n = p.get("name")
            if n and n not in seen_d:
                seen_d.add(n)
                directors.append(n)

    writers = []
    seen_w = set()
    wjobs = (
        "Screenplay",
        "Writer",
        "Story",
        "Teleplay",
        "Characters",
    )
    for p in crew:
        if p.get("job") in wjobs or p.get("department") == "Writing":
            n = p.get("name")
            if n and n not in seen_w:
                seen_w.add(n)
                writers.append(n)
    # Séries: se não houver roteiristas na equipe, cai nos criadores.
    if media_type == "tv" and not writers:
        for cr in tmdb_data.get("created_by") or []:
            n = cr.get("name")
            if n and n not in seen_w:
                seen_w.add(n)
                writers.append(n)
    return {
        "credit_directors": ", ".join(directors) if directors else None,
        "credit_writers": ", ".join(writers[:14]) if writers else None,
    }


def _technical_page_context(tmdb_data, media_type):
    """
    Monta contexto rich para a página de ficha técnica (créditos, elenco com fotos, trailer, etc.).
    Conteúdo textual da API já solicitado com language=pt-BR.
    """
    credits = tmdb_data.get("credits") or {}
    crew = credits.get("crew") or []
    cast_raw = credits.get("cast") or []

    cast_list = []
    for c in sorted(cast_raw, key=_cast_billing_order):
        cast_list.append(
            {
                "id": c.get("id"),
                "name": c.get("name") or "",
                "character": (c.get("character") or "").strip() or "—",
                "profile_path": c.get("profile_path"),
                "order": c.get("order"),
            }
        )

    directors = _crew_unique_people(crew, {"Director", "Co-Director"})
    writers = _crew_writers_all(crew)
    producers = _crew_unique_people(crew, {"Producer", "Executive Producer"})[
        :24
    ]

    ext = tmdb_data.get("external_ids") or {}
    rec = tmdb_data.get("recommendations") or {}
    rec_results = (rec.get("results") or [])[:12]
    similar = []
    for r in rec_results:
        if media_type == "movie":
            tid = r.get("id")
            tit = r.get("title") or ""
        else:
            tid = r.get("id")
            tit = r.get("name") or ""
        if tid:
            similar.append(
                {
                    "id": tid,
                    "title": tit,
                    "media_type": media_type,
                    "poster_path": r.get("poster_path"),
                }
            )

    genres_list = [
        g.get("name")
        for g in (tmdb_data.get("genres") or [])
        if g.get("name")
    ]

    facts = []
    if media_type == "movie":
        title = tmdb_data.get("title") or ""
        original_title = tmdb_data.get("original_title") or ""
        release_date = tmdb_data.get("release_date") or ""
        runtime = tmdb_data.get("runtime")
        if runtime:
            facts.append({"label": "Duração", "value": f"{runtime} min"})
        status = tmdb_data.get("status")
        if status:
            facts.append(
                {"label": "Status", "value": _pt_tmdb_status(status)}
            )
        bud = _fmt_usd_compact(tmdb_data.get("budget"))
        if bud:
            facts.append({"label": "Orçamento", "value": bud})
        rev = _fmt_usd_compact(tmdb_data.get("revenue"))
        if rev:
            facts.append({"label": "Receita", "value": rev})
    else:
        title = tmdb_data.get("name") or ""
        original_title = tmdb_data.get("original_name") or ""
        release_date = tmdb_data.get("first_air_date") or ""
        seasons = tmdb_data.get("number_of_seasons")
        episodes = tmdb_data.get("number_of_episodes")
        if seasons is not None:
            facts.append({"label": "Temporadas", "value": str(seasons)})
        if episodes is not None:
            facts.append({"label": "Episódios", "value": str(episodes)})
        ert = tmdb_data.get("episode_run_time") or []
        if ert:
            avg = sum(ert) // len(ert)
            facts.append(
                {"label": "Duração típica do episódio", "value": f"{avg} min"}
            )
        netw = tmdb_data.get("networks") or []
        if netw:
            facts.append(
                {
                    "label": "Emissoras",
                    "value": ", ".join(
                        n.get("name") for n in netw if n.get("name")
                    ),
                }
            )
        st = tmdb_data.get("status")
        if st:
            facts.append({"label": "Status", "value": _pt_tmdb_status(st)})
        stype = tmdb_data.get("type")
        if stype:
            facts.append(
                {
                    "label": "Formato",
                    "value": _TMDB_SHOW_TYPE_PT.get(str(stype), stype),
                }
            )

    langs = tmdb_data.get("spoken_languages") or []
    if langs:
        facts.append(
            {
                "label": "Idiomas falados",
                "value": ", ".join(
                    l.get("name") or l.get("english_name") or ""
                    for l in langs
                    if l.get("name") or l.get("english_name")
                ),
            }
        )

    countries = tmdb_data.get("production_countries") or []
    if countries:
        facts.append(
            {
                "label": "Países de produção",
                "value": ", ".join(
                    c.get("name") for c in countries if c.get("name")
                ),
            }
        )

    companies = tmdb_data.get("production_companies") or []
    if companies:
        facts.append(
            {
                "label": "Estúdios / produtoras",
                "value": ", ".join(
                    c.get("name") for c in companies if c.get("name")
                ),
            }
        )

    created_by = []
    if media_type == "tv":
        for cr in tmdb_data.get("created_by") or []:
            if cr.get("name"):
                created_by.append(
                    {
                        "id": cr.get("id"),
                        "name": cr.get("name"),
                        "job": "Criador(a)",
                        "profile_path": cr.get("profile_path"),
                    }
                )

    cert_br = None
    if media_type == "movie":
        cert_br = _br_certification_movie(tmdb_data.get("release_dates"))
    else:
        cert_br = _br_certification_tv(tmdb_data.get("content_ratings"))

    extra_posters, extra_backdrops = _images_for_technical(tmdb_data)

    return {
        "title": title,
        "original_title": original_title,
        "tagline": (tmdb_data.get("tagline") or "").strip(),
        "overview": tmdb_data.get("overview") or "",
        "poster_path": tmdb_data.get("poster_path"),
        "backdrop_path": tmdb_data.get("backdrop_path"),
        "release_date": release_date,
        "genres_list": genres_list,
        "vote_average": tmdb_data.get("vote_average"),
        "facts": facts,
        "trailer_key": _youtube_trailer_key(tmdb_data),
        "homepage": (tmdb_data.get("homepage") or "").strip(),
        "imdb_id": ext.get("imdb_id"),
        "directors": directors,
        "writers": writers,
        "producers": producers,
        "cast": cast_list,
        "created_by": created_by,
        "similar": similar,
        "is_tv": media_type == "tv",
        "media_type": media_type,
        "certification_br": cert_br,
        "extra_posters": extra_posters,
        "extra_backdrops": extra_backdrops,
    }


def _tmdb_headers(token):
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }


def certification_br_css_modifier(cert_raw):
    """Retorna sufixo de classe CSS para classificação BR (ex.: livre, 16, 18)."""
    if not cert_raw or not str(cert_raw).strip():
        return "unknown"
    s = str(cert_raw).strip().upper().replace(" ", "")
    if s in ("L", "LIVRE", "G", "AL"):
        return "livre"
    if s in ("10", "A10"):
        return "10"
    if s in ("12", "A12"):
        return "12"
    if s in ("14", "A14"):
        return "14"
    if s in ("16", "A16"):
        return "16"
    if s in ("18", "A18", "R"):
        return "18"
    if s.isdigit() and len(s) <= 2:
        return s
    return "unknown"


def format_date_br(iso_date):
    """Converte YYYY-MM-DD (TMDB) para DD/MM/AAAA."""
    if not iso_date or not str(iso_date).strip():
        return iso_date or ""
    s = str(iso_date).strip()[:10]
    if len(s) < 10 or s[4] != "-" or s[7] != "-":
        return str(iso_date).strip()
    try:
        d = datetime.strptime(s, "%Y-%m-%d")
        return d.strftime("%d/%m/%Y")
    except ValueError:
        return str(iso_date).strip()


def _br_certification_movie(release_dates_root):
    """Certificação indicativa BR a partir do objeto release_dates (append TMDB)."""
    if not release_dates_root:
        return None
    for country in release_dates_root.get("results") or []:
        if country.get("iso_3166_1") != "BR":
            continue
        for rd in country.get("release_dates") or []:
            cert = (rd.get("certification") or "").strip()
            if cert:
                return cert
    return None


def _br_certification_tv(content_ratings_root):
    """Classificação BR para séries (content_ratings)."""
    if not content_ratings_root:
        return None
    for row in content_ratings_root.get("results") or []:
        if row.get("iso_3166_1") == "BR":
            r = (row.get("rating") or "").strip()
            if r:
                return r
    return None


def _recommendations_for_details(tmdb_data, media_type, limit=10):
    """Lista normalizada a partir de recommendations.results."""
    rec = tmdb_data.get("recommendations") or {}
    raw = (rec.get("results") or [])[:limit]
    out = []
    for r in raw:
        tid = r.get("id")
        if not tid:
            continue
        if media_type == "movie":
            tit = r.get("title") or ""
        else:
            tit = r.get("name") or ""
        out.append(
            {
                "id": tid,
                "title": tit,
                "media_type": media_type,
                "poster_path": r.get("poster_path"),
            }
        )
    return out


def _images_for_technical(tmdb_data, posters_limit=12, backdrops_limit=12):
    """Extrai listas de caminhos de imagem extras."""
    img = tmdb_data.get("images") or {}
    posters = [
        x.get("file_path")
        for x in (img.get("posters") or [])[:posters_limit]
        if x.get("file_path")
    ]
    backdrops = [
        x.get("file_path")
        for x in (img.get("backdrops") or [])[:backdrops_limit]
        if x.get("file_path")
    ]
    return posters, backdrops


def _crew_person_dict(p):
    """Crédito com id para links para a página da pessoa."""
    return {
        "id": p.get("id"),
        "name": p.get("name") or "",
        "job": p.get("job") or "",
        "profile_path": p.get("profile_path"),
    }


def _wants_gemini_error_detail():
    """Inclui mensagem técnica no JSON (útil para diagnóstico)."""
    if os.environ.get("GEMINI_DEBUG", "").lower() in ("1", "true", "yes"):
        return True
    try:
        return current_app.debug
    except RuntimeError:
        return False


def _resolve_gemini_model_id(name):
    """Normaliza o id do modelo (ex.: gemini-3-pro -> gemini-3-pro-preview)."""
    key = (name or "").strip()
    return _GEMINI_MODEL_ALIASES.get(key, key)


def _gemini_http_timeout_ms():
    """Compat: delega para serviço central de timeout Gemini."""
    return gemini_http_timeout_ms()


def _gemini_generate_text_sdk(prompt, api_key, model_name):
    """
    Gera texto com o Gemini usando o SDK Google Gen AI (pacote google-genai).
    Retorna (texto ou None, mensagem de erro interna ou None).
    """
    timer = IntegrationTimer("gemini", "generate_content")
    text, err = gemini_generate_text(
        prompt,
        api_key,
        model_name,
        resolve_model_id=_resolve_gemini_model_id,
    )
    if err:
        timer.done(status="error", detail=err[:200])
    else:
        timer.done(status="ok")
    return text, err


def _parse_gemini_suggestions_json(text):
    """Extrai JSON de sugestões do texto retornado pelo Gemini (limpa markdown se houver)."""
    if not text or not text.strip():
        return None
    s = text.strip()
    # Remove cercas ```json ... ``` se existirem
    fence = re.match(r"^```(?:json)?\s*([\s\S]*?)\s*```$", s, re.IGNORECASE)
    if fence:
        s = fence.group(1).strip()

    def _try_load(raw):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    data = _try_load(s)
    # Texto extra ao redor do JSON (comum quando o modelo ignora "só JSON")
    if data is None:
        start = s.find("{")
        end = s.rfind("}")
        if start >= 0 and end > start:
            data = _try_load(s[start : end + 1])
    if not isinstance(data, dict):
        return None

    suggestions = data.get("suggestions")
    if not isinstance(suggestions, list):
        return None
    out = []
    for x in suggestions:
        if isinstance(x, str) and x.strip():
            out.append(x.strip())
    return out if out else None


def create_app() -> Flask:
    app = Flask(
        __name__,
        template_folder="templates",
        static_folder="static",
        instance_path=str(INSTANCE_DIR),
    )
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
    app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=400)
    app.config["SQLALCHEMY_DATABASE_URI"] = (
        "sqlite:///" + str(INSTANCE_DIR / "movies.db")
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    db.init_app(app)

    _cache_cfg: dict = {
        "CACHE_TYPE": os.environ.get("CACHE_TYPE", "SimpleCache"),
        "CACHE_DEFAULT_TIMEOUT": 600,
    }
    if _cache_cfg["CACHE_TYPE"] == "FileSystemCache":
        _cdir = Path(os.environ.get("CACHE_DIR", str(INSTANCE_DIR / "http_cache")))
        _cdir.mkdir(parents=True, exist_ok=True)
        _cache_cfg["CACHE_DIR"] = str(_cdir)
    cache.init_app(app, config=_cache_cfg)

    app.wsgi_app = ProxyFix(
        app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1, x_prefix=1
    )
    app.session_interface = _SessionCookieByRequestIsSecure()

    app.extensions["metrics"] = {"tmdb_hit": 0, "tmdb_miss": 0}

    if not logging.getLogger().handlers:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(name)s %(message)s",
        )
    for _ln in ("movies_app.integrations", "movies_app.gemini", "movies_app.http"):
        logging.getLogger(_ln).setLevel(logging.INFO)

    with app.app_context():
        db.create_all()
        _ensure_watched_schema()
        _ensure_phase1_seed()
        _ensure_profile_display_names()
        _ensure_phase2_schema()
        _ensure_swipe_session_public_id()
        _ensure_swipe_session_profile_cursors()
        _ensure_swipe_session_list_id()
        _ensure_swipe_item_votes_schema()

    @app.before_request
    def _req_timer_start():
        g._req_t0 = time.perf_counter()

    @app.after_request
    def _req_timer_log(resp):
        try:
            dt = (time.perf_counter() - g._req_t0) * 1000
        except Exception:
            return resp
        if request.path.startswith("/static"):
            return resp
        current_app.logger.info(
            json.dumps(
                {
                    "event": "http_request",
                    "path": request.path,
                    "method": request.method,
                    "status": resp.status_code,
                    "duration_ms": round(dt, 2),
                },
                ensure_ascii=False,
            )
        )
        return resp

    @app.context_processor
    def _inject_phase2_flags():
        labels = {"a": "Princesinha", "b": "Gabe"}
        try:
            cpl = Couple.query.order_by(Couple.id).first()
            if cpl:
                for p in Profile.query.filter_by(couple_id=cpl.id).all():
                    if p.slug in labels:
                        labels[p.slug] = p.display_name or labels[p.slug]
        except Exception:
            pass
        return {
            "gamification_v2_nav": gamification_v2_enabled(),
            "bets_enabled_nav": bets_enabled(),
            "seasons_enabled_nav": seasons_enabled(),
            "profile_label_a": labels["a"],
            "profile_label_b": labels["b"],
        }

    @app.get("/sw.js")
    def service_worker():
        """PWA: serve o SW na raiz com Service-Worker-Allowed: / (ficheiro em static/sw.js)."""
        static_dir = app.static_folder
        if not static_dir:
            abort(404)
        resp = send_from_directory(
            static_dir,
            "sw.js",
            mimetype="application/javascript; charset=utf-8",
            max_age=0,
        )
        resp.headers["Service-Worker-Allowed"] = "/"
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp

    def _tmdb_json_cached(url, params, ttl, timeout=16.0, op="GET"):
        tok = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if not tok:
            return None
        return tmdb_get_json_cached(
            cache_get=cache.get,
            cache_set=lambda k, v, to: cache.set(k, v, timeout=to),
            session=_TMDB_SESSION,
            token=tok,
            url=url,
            params=params,
            headers=_tmdb_headers(tok),
            ttl=ttl,
            timeout=timeout,
            metrics=app.extensions["metrics"],
            log_op=op,
        )

    @app.template_filter("star_fills")
    def _tf_star_fills(rating):
        return star_fills(rating)

    @app.template_filter("date_br")
    def _tf_date_br(value):
        return format_date_br(value)

    @app.template_filter("cert_br_class")
    def _tf_cert_br_class(value):
        mod = certification_br_css_modifier(value)
        return f"cert-br cert-br--{mod}"

    app.template_filter("achievement_title_pt")(achievement_title_pt)
    app.template_filter("achievement_icon_pt")(achievement_icon_pt)
    app.template_filter("xp_reason_pt")(xp_reason_pt)
    app.template_filter("bet_status_pt")(bet_status_pt)

    # ---- Helper Vite ---------------------------------------------------
    # Lê frontend/app/static/build/manifest.json e devolve as tags <script>/<link>
    # para montar a ilha React do entry pedido. Em dev e prod o manifest é o
    # mesmo formato (vite build --watch grava manifest.json).
    _vite_manifest_cache: dict[str, Any] = {"mtime": 0, "data": None}

    def _vite_manifest() -> dict[str, Any]:
        manifest_path = Path(app.static_folder or "") / "build" / "manifest.json"
        if not manifest_path.is_file():
            return {}
        try:
            mtime = manifest_path.stat().st_mtime
        except OSError:
            return {}
        cached = _vite_manifest_cache
        if cached.get("mtime") == mtime and cached.get("data") is not None:
            return cached["data"]  # type: ignore[return-value]
        try:
            with open(manifest_path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError):
            return {}
        cached["mtime"] = mtime
        cached["data"] = data if isinstance(data, dict) else {}
        return cached["data"]  # type: ignore[return-value]

    def vite_entry_tags(entry_name: str) -> Markup:
        """Retorna <link rel=modulepreload> + <script type=module> da entrada."""
        manifest = _vite_manifest()
        if not manifest:
            msg = (
                f"<!-- vite: build ausente para entry '{entry_name}'. "
                "Rode `npm run build` em frontend/. -->"
            )
            return Markup(msg)
        key = f"src/entries/{entry_name}.tsx"
        entry = manifest.get(key)
        if not entry:
            return Markup(
                f"<!-- vite: entry '{entry_name}' não encontrado no manifest. -->"
            )
        prefix = "/static/build/"
        parts: list[str] = []
        for css in entry.get("css") or []:
            parts.append(
                f'<link rel="stylesheet" href="{prefix}{css}">'
            )
        for imp_key in entry.get("imports") or []:
            imp = manifest.get(imp_key) or {}
            imp_file = imp.get("file")
            if imp_file:
                parts.append(
                    f'<link rel="modulepreload" href="{prefix}{imp_file}">'
                )
        file_name = entry.get("file")
        if file_name:
            parts.append(
                f'<script type="module" src="{prefix}{file_name}"></script>'
            )
        return Markup("\n".join(parts))

    app.jinja_env.globals["vite_entry_tags"] = vite_entry_tags
    # --------------------------------------------------------------------

    def _home_fetch_trending(_headers_unused):
        rows = []
        data = _tmdb_json_cached(
            f"{TMDB_BASE}/trending/all/week",
            {"language": TMDB_LANG},
            ttl=480,
            timeout=14.0,
            op="trending_week",
        )
        if not isinstance(data, dict):
            return rows
        for it in data.get("results") or []:
            mt = it.get("media_type")
            if mt not in ("movie", "tv"):
                continue
            tid = it.get("id")
            if not tid:
                continue
            title = (
                it.get("title") if mt == "movie" else it.get("name")
            ) or ""
            rd = (
                it.get("release_date")
                if mt == "movie"
                else it.get("first_air_date")
            )
            rows.append(
                {
                    "id": tid,
                    "title": title,
                    "media_type": mt,
                    "poster_path": it.get("poster_path"),
                    "release_date": rd or "",
                }
            )
        return rows

    def _home_fetch_movie_list(path_key, _headers_unused):
        rows = []
        data = _tmdb_json_cached(
            f"{TMDB_BASE}/movie/{path_key}",
            {
                "language": TMDB_LANG,
                "region": TMDB_REGION_BR,
            },
            ttl=720,
            timeout=14.0,
            op=f"movie_{path_key}",
        )
        if not isinstance(data, dict):
            return rows
        for it in data.get("results") or []:
            tid = it.get("id")
            if not tid:
                continue
            rows.append(
                {
                    "id": tid,
                    "title": it.get("title") or "",
                    "media_type": "movie",
                    "poster_path": it.get("poster_path"),
                    "release_date": it.get("release_date") or "",
                }
            )
        return rows

    def _home_tmdb_carousels(token):
        """Trending + now_playing + upcoming em paralelo, com teto de tempo total.

        Evita travar a home/API se o TMDB ou a rede ficarem presos: após ~22s
        retorna listas parciais (vazias para futures que não terminaram).
        """
        headers = _tmdb_headers(token)
        with ThreadPoolExecutor(max_workers=3) as pool:
            f_tr = pool.submit(_home_fetch_trending, headers)
            f_np = pool.submit(_home_fetch_movie_list, "now_playing", headers)
            f_up = pool.submit(_home_fetch_movie_list, "upcoming", headers)
            futures = (f_tr, f_np, f_up)
            done, not_done = wait(futures, timeout=22.0)

            def _safe_result(f):
                if f not in done:
                    return []
                try:
                    return f.result(timeout=0) or []
                except Exception:
                    return []

            trending = _safe_result(f_tr)
            now_playing = _safe_result(f_np)
            upcoming = _safe_result(f_up)
            for f in not_done:
                try:
                    f.cancel()
                except Exception:
                    pass
        return trending, now_playing, upcoming

    # --- Páginas e API interna ---

    @app.get("/bem-vindo")
    def bem_vindo_page():
        """Escolha única do perfil ativo (aparelho); depois redireciona para a home."""
        return render_template("bem_vindo.html")

    @app.get("/")
    def index():
        """Entrada do app: busca TMDB (Assistir) + destaques TMDB + últimos vistos."""
        recent_items = (
            WatchedItem.query.order_by(WatchedItem.added_at.desc()).limit(10).all()
        )
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        trending_items = []
        now_playing_items = []
        upcoming_items = []
        if token:
            trending_items, now_playing_items, upcoming_items = (
                _home_tmdb_carousels(token)
            )
        return render_template(
            "home.html",
            recent_items=recent_items,
            trending_items=trending_items,
            now_playing_items=now_playing_items,
            upcoming_items=upcoming_items,
        )

    @app.get("/api/home/feed")
    def api_home_feed():
        """Payload consolidado para a HomeApp React (trending + now_playing + upcoming + recent)."""
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        trending_items: list[dict[str, Any]] = []
        now_playing_items: list[dict[str, Any]] = []
        upcoming_items: list[dict[str, Any]] = []
        if token:
            trending_items, now_playing_items, upcoming_items = (
                _home_tmdb_carousels(token)
            )
        recent_items = (
            WatchedItem.query.order_by(WatchedItem.added_at.desc()).limit(10).all()
        )
        recent_payload = [
            {
                "id": it.id,
                "tmdb_id": it.tmdb_id,
                "title": it.title,
                "media_type": it.media_type,
                "poster_path": getattr(it, "poster_path", None),
                "rating": getattr(it, "rating", None),
                "added_at": it.added_at.isoformat() if getattr(it, "added_at", None) else None,
            }
            for it in recent_items
        ]
        resp = jsonify(
            {
                "trending": trending_items,
                "now_playing": now_playing_items,
                "upcoming": upcoming_items,
                "recent": recent_payload,
                "hero_message": "O que vamos ver hoje baby?",
            }
        )
        resp.headers["Cache-Control"] = "private, max-age=120"
        return resp

    @app.get("/historico")
    def history():
        """Lista avaliada + filtros."""
        items = WatchedItem.query.order_by(WatchedItem.added_at.desc()).all()
        return render_template("history.html", items=items)

    @app.get("/assistir-depois")
    def watch_later_redirect():
        """Compat: URL antiga redireciona para Listas."""
        return redirect(url_for("listas_index"), code=301)

    @app.get("/listas")
    def listas_index():
        return render_template("listas.html", listas_view="grid", list_id=None)

    @app.get("/listas/nova")
    def listas_nova():
        return render_template("listas.html", listas_view="create", list_id=None)

    @app.get("/listas/fila")
    def listas_fila():
        """Fila fixa 'Assistir depois' (watch_later_items)."""
        return render_template("listas.html", listas_view="queue", list_id=None)

    @app.get("/listas/<int:list_id>")
    def listas_detail(list_id: int):
        return render_template("listas.html", listas_view="detail", list_id=list_id)

    def _parse_cursor_limit(
        default_limit: int = 60,
        max_limit: int = 500,
    ) -> tuple[str | None, int]:
        """Lê ?cursor= e ?limit= dos query params (cursor = ISO datetime).

        Quando nem cursor nem limit forem informados, retorna default_limit —
        mas o endpoint pode passar um default alto para preservar o comportamento
        "retornar tudo" esperado por clientes legados.
        """
        cursor_raw = (request.args.get("cursor") or "").strip() or None
        try:
            limit = int(request.args.get("limit", default_limit))
        except (TypeError, ValueError):
            limit = default_limit
        limit = max(1, min(limit, max_limit))
        return cursor_raw, limit

    @app.get("/api/history")
    def api_history_list():
        """Lista do histórico (avaliados) com paginação por cursor (added_at)."""
        cursor_raw, limit = _parse_cursor_limit(default_limit=500)
        total = WatchedItem.query.count()
        q = WatchedItem.query.order_by(WatchedItem.added_at.desc())
        if cursor_raw:
            try:
                cursor_dt = datetime.fromisoformat(cursor_raw)
                q = q.filter(WatchedItem.added_at < cursor_dt)
            except ValueError:
                pass
        rows = q.limit(limit + 1).all()
        has_more = len(rows) > limit
        items = rows[:limit]
        next_cursor = (
            items[-1].added_at.isoformat()
            if (has_more and items and items[-1].added_at)
            else None
        )
        payload = [
            {
                "id": it.id,
                "tmdb_id": it.tmdb_id,
                "media_type": it.media_type,
                "title": it.title,
                "original_title": it.original_title,
                "poster_path": it.poster_path,
                "backdrop_path": it.backdrop_path,
                "release_date": it.release_date,
                "genres": it.genres or "",
                "vote_average": it.vote_average,
                "rating": float(it.rating) if it.rating is not None else None,
                "added_at": it.added_at.isoformat() if it.added_at else None,
            }
            for it in items
        ]
        return jsonify(
            {
                "items": payload,
                "total": total,
                "next_cursor": next_cursor,
                "has_more": has_more,
            }
        )

    @app.get("/api/watch-later")
    def api_watch_later_list():
        """Fila 'assistir depois' com paginação por cursor (added_at)."""
        cursor_raw, limit = _parse_cursor_limit(default_limit=500)
        total = WatchLaterItem.query.count()
        q = WatchLaterItem.query.order_by(WatchLaterItem.added_at.desc())
        if cursor_raw:
            try:
                cursor_dt = datetime.fromisoformat(cursor_raw)
                q = q.filter(WatchLaterItem.added_at < cursor_dt)
            except ValueError:
                pass
        rows = q.limit(limit + 1).all()
        has_more = len(rows) > limit
        items = rows[:limit]
        next_cursor = (
            items[-1].added_at.isoformat()
            if (has_more and items and items[-1].added_at)
            else None
        )
        payload = [
            {
                "id": it.id,
                "tmdb_id": it.tmdb_id,
                "media_type": it.media_type,
                "title": it.title,
                "original_title": it.original_title,
                "overview": it.overview,
                "poster_path": it.poster_path,
                "backdrop_path": it.backdrop_path,
                "release_date": it.release_date,
                "genres": it.genres or "",
                "vote_average": it.vote_average,
                "added_at": it.added_at.isoformat() if it.added_at else None,
            }
            for it in items
        ]
        return jsonify(
            {
                "items": payload,
                "total": total,
                "next_cursor": next_cursor,
                "has_more": has_more,
            }
        )

    @app.get("/api/media-lists")
    def api_media_lists_summary():
        """Resumo para grid Listas + seletores (swipe / sorteio)."""
        cid = _couple_id()
        wl_first = WatchLaterItem.query.order_by(WatchLaterItem.added_at.asc()).first()
        wl_count = WatchLaterItem.query.count()
        custom = (
            MediaList.query.filter_by(couple_id=cid)
            .order_by(MediaList.updated_at.desc())
            .all()
        )
        lists_out = []
        for row in custom:
            first = (
                MediaListItem.query.filter_by(list_id=row.id)
                .order_by(MediaListItem.added_at.asc())
                .first()
            )
            cnt = MediaListItem.query.filter_by(list_id=row.id).count()
            lists_out.append(
                {
                    "id": row.id,
                    "name": row.name,
                    "description": row.description or "",
                    "item_count": cnt,
                    "cover_poster_path": first.poster_path if first else None,
                    "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                }
            )
        return jsonify(
            {
                "builtin": {
                    "key": "fila",
                    "name": "Assistir depois",
                    "item_count": wl_count,
                    "cover_poster_path": wl_first.poster_path if wl_first else None,
                },
                "custom": lists_out,
            }
        )

    @app.post("/api/media-lists")
    def api_media_lists_create():
        cid = _couple_id()
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        if len(name) < 1 or len(name) > 160:
            return jsonify({"error": "Nome da lista inválido (1–160 caracteres)."}), 400
        desc = (body.get("description") or "").strip() or None
        row = MediaList(couple_id=cid, name=name, description=desc)
        db.session.add(row)
        db.session.commit()
        return jsonify(
            {
                "id": row.id,
                "name": row.name,
                "description": row.description or "",
            }
        )

    @app.get("/api/media-lists/<int:list_id>")
    def api_media_lists_get(list_id: int):
        cid = _couple_id()
        row = MediaList.query.filter_by(id=list_id, couple_id=cid).first()
        if not row:
            return jsonify({"error": "Não encontrada"}), 404
        items = (
            MediaListItem.query.filter_by(list_id=list_id)
            .order_by(MediaListItem.sort_order.desc(), MediaListItem.added_at.desc())
            .all()
        )
        return jsonify(
            {
                "id": row.id,
                "name": row.name,
                "description": row.description or "",
                "items": [
                    {
                        "id": it.id,
                        "tmdb_id": it.tmdb_id,
                        "media_type": it.media_type,
                        "title": it.title,
                        "original_title": it.original_title,
                        "overview": it.overview,
                        "poster_path": it.poster_path,
                        "backdrop_path": it.backdrop_path,
                        "release_date": it.release_date,
                        "genres": it.genres or "",
                        "vote_average": it.vote_average,
                        "added_at": it.added_at.isoformat() if it.added_at else None,
                    }
                    for it in items
                ],
            }
        )

    @app.route("/api/media-lists/<int:list_id>", methods=["PATCH"])
    def api_media_lists_patch(list_id: int):
        cid = _couple_id()
        row = MediaList.query.filter_by(id=list_id, couple_id=cid).first()
        if not row:
            return jsonify({"error": "Não encontrada"}), 404
        body = request.get_json(silent=True) or {}
        if "name" in body:
            name = (body.get("name") or "").strip()
            if len(name) < 1 or len(name) > 160:
                return jsonify({"error": "Nome inválido"}), 400
            row.name = name
        if "description" in body:
            d = body.get("description")
            row.description = (str(d).strip() or None) if d is not None else None
        row.updated_at = datetime.utcnow()
        db.session.commit()
        return jsonify({"ok": True, "id": row.id, "name": row.name, "description": row.description or ""})

    @app.delete("/api/media-lists/<int:list_id>")
    def api_media_lists_delete(list_id: int):
        cid = _couple_id()
        row = MediaList.query.filter_by(id=list_id, couple_id=cid).first()
        if not row:
            return jsonify({"error": "Não encontrada"}), 404
        db.session.delete(row)
        db.session.commit()
        return jsonify({"ok": True})

    @app.post("/api/media-lists/<int:list_id>/items")
    def api_media_lists_add_item(list_id: int):
        cid = _couple_id()
        row = MediaList.query.filter_by(id=list_id, couple_id=cid).first()
        if not row:
            return jsonify({"error": "Não encontrada"}), 404
        body = request.get_json(silent=True) or {}
        try:
            tmdb_id = int(body.get("tmdb_id"))
        except (TypeError, ValueError):
            return jsonify({"error": "tmdb_id inválido"}), 400
        media_type = (body.get("media_type") or "movie").strip()
        if media_type not in ("movie", "tv"):
            return jsonify({"error": "media_type inválido"}), 400
        title = (body.get("title") or "").strip() or "Sem título"
        original_title = (body.get("original_title") or "").strip() or None
        overview = body.get("overview") or ""
        poster_path = (body.get("poster_path") or "") or None
        backdrop_path = (body.get("backdrop_path") or "") or None
        release_date = (body.get("release_date") or "") or None
        genres_str = (body.get("genres") or "") or None
        try:
            vote_average = float(body.get("vote_average") or 0)
        except (TypeError, ValueError):
            vote_average = 0.0
        existing = MediaListItem.query.filter_by(
            list_id=list_id, tmdb_id=tmdb_id, media_type=media_type
        ).first()
        if existing:
            existing.title = title
            existing.original_title = original_title
            existing.overview = overview
            existing.poster_path = poster_path
            existing.backdrop_path = backdrop_path
            existing.release_date = release_date
            existing.genres = genres_str
            existing.vote_average = vote_average
        else:
            mx = db.session.query(func.max(MediaListItem.sort_order)).filter_by(list_id=list_id).scalar()
            try:
                so = int(mx or 0) + 1
            except (TypeError, ValueError):
                so = 1
            db.session.add(
                MediaListItem(
                    list_id=list_id,
                    tmdb_id=tmdb_id,
                    media_type=media_type,
                    title=title,
                    original_title=original_title,
                    overview=overview,
                    poster_path=poster_path,
                    backdrop_path=backdrop_path,
                    release_date=release_date,
                    genres=genres_str,
                    vote_average=vote_average,
                    sort_order=so,
                )
            )
        row.updated_at = datetime.utcnow()
        db.session.commit()
        return jsonify({"ok": True})

    @app.delete("/api/media-lists/<int:list_id>/items/<int:item_id>")
    def api_media_lists_remove_item(list_id: int, item_id: int):
        cid = _couple_id()
        row = MediaList.query.filter_by(id=list_id, couple_id=cid).first()
        if not row:
            return jsonify({"error": "Não encontrada"}), 404
        it = MediaListItem.query.filter_by(id=item_id, list_id=list_id).first()
        if not it:
            return jsonify({"error": "Item não encontrado"}), 404
        db.session.delete(it)
        row.updated_at = datetime.utcnow()
        db.session.commit()
        return jsonify({"ok": True})

    @app.get("/estatisticas")
    def stats_page():
        items = WatchedItem.query.all()
        stats = _watched_stats(items)
        return render_template("stats.html", stats=stats)

    @app.get("/api/stats/overview")
    def api_stats_overview():
        """Agrega dados de estatísticas para o dashboard React."""
        items = WatchedItem.query.order_by(WatchedItem.added_at.asc()).all()
        base = _watched_stats(items)

        ratings = [float(i.rating) for i in items if i.rating is not None]
        avg_rating = round(sum(ratings) / len(ratings), 2) if ratings else 0.0
        rating_buckets = {str(i): 0 for i in range(1, 11)}
        for r in ratings:
            key = str(max(1, min(10, int(round(r)))))
            rating_buckets[key] = rating_buckets.get(key, 0) + 1

        monthly: dict[str, dict] = {}
        for it in items:
            if not it.added_at:
                continue
            key = it.added_at.strftime("%Y-%m")
            slot = monthly.setdefault(key, {"key": key, "total": 0, "movie": 0, "tv": 0})
            slot["total"] += 1
            if it.media_type == "movie":
                slot["movie"] += 1
            elif it.media_type == "tv":
                slot["tv"] += 1
        monthly_rows = [monthly[k] for k in sorted(monthly.keys())][-12:]

        heatmap = [[0] * 7 for _ in range(24)]
        dow_counts = [0] * 7
        for it in items:
            if not it.added_at:
                continue
            dow = it.added_at.weekday()
            dow_idx = (dow + 1) % 7
            hour = it.added_at.hour
            heatmap[hour][dow_idx] += 1
            dow_counts[dow_idx] += 1

        top_rated = sorted(
            [i for i in items if i.rating is not None],
            key=lambda i: (-(i.rating or 0), i.title or ""),
        )[:8]
        top_rated_rows = [
            {
                "id": i.id,
                "tmdb_id": i.tmdb_id,
                "media_type": i.media_type,
                "title": i.title,
                "poster_path": i.poster_path,
                "rating": i.rating,
                "genres": i.genres or "",
            }
            for i in top_rated
        ]

        decade_counts: dict[str, int] = {}
        for it in items:
            rd = (it.release_date or "").strip()
            if len(rd) < 4 or not rd[:4].isdigit():
                continue
            y = int(rd[:4])
            dec = f"{(y // 10) * 10}s"
            decade_counts[dec] = decade_counts.get(dec, 0) + 1
        decade_rows = [
            {"label": k, "count": v}
            for k, v in sorted(decade_counts.items(), key=lambda x: x[0])
        ]

        return jsonify(
            {
                **base,
                "avg_rating": avg_rating,
                "rating_distribution": rating_buckets,
                "monthly": monthly_rows,
                "heatmap": heatmap,
                "dow_counts": dow_counts,
                "top_rated": top_rated_rows,
                "decades": decade_rows,
            }
        )

    @app.get("/suggestions")
    def suggestions_page():
        return render_template("suggestions.html")

    @app.get("/healthz")
    def healthz():
        return jsonify(
            {
                "status": "ok",
                "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            }
        )

    @app.get("/metrics")
    def metrics_json():
        m = app.extensions.get("metrics") or {}
        out = {
            "tmdb_cache_hits": m.get("tmdb_hit", 0),
            "tmdb_cache_misses": m.get("tmdb_miss", 0),
            "gamification_v2": gamification_v2_enabled(),
            "bets_enabled": bets_enabled(),
            "seasons_enabled": seasons_enabled(),
        }
        if gamification_v2_enabled():
            try:
                out["gamification_events_total"] = GamificationEvent.query.count()
                out["achievements_unlocked_total"] = (
                    AchievementProgress.query.filter(
                        AchievementProgress.unlocked_at.isnot(None)
                    ).count()
                )
            except Exception:
                pass
        return jsonify(out)

    @app.get("/search")
    def search():
        """Proxy de busca TMDB: retorna JSON para o frontend (sem expor o token)."""
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if not token:
            return jsonify({"error": "TMDB_READ_ACCESS_TOKEN não configurado"}), 500

        query = (request.args.get("q") or "").strip()
        search_type = (request.args.get("type") or "multi").lower()
        if search_type not in ("multi", "movie", "tv"):
            search_type = "multi"

        if not query:
            return jsonify({"results": []})

        if search_type == "multi":
            path = "search/multi"
        elif search_type == "movie":
            path = "search/movie"
        else:
            path = "search/tv"

        url = f"{TMDB_BASE}/{path}"
        params = {"query": query, "language": TMDB_LANG}
        data = _tmdb_json_cached(
            url,
            params,
            ttl=300,
            timeout=15.0,
            op="search_multi" if path.endswith("multi") else path.split("/")[-1],
        )
        if not isinstance(data, dict):
            return jsonify({"error": "Falha ao consultar TMDB"}), 502

        raw_results = data.get("results") or []
        out = []
        for item in raw_results:
            mtype = item.get("media_type") or search_type
            if mtype not in ("movie", "tv"):
                continue
            title = item.get("title") if mtype == "movie" else item.get("name")
            rd = item.get("release_date") if mtype == "movie" else item.get(
                "first_air_date"
            )
            out.append(
                {
                    "id": item.get("id"),
                    "title": title,
                    "media_type": mtype,
                    "poster_path": item.get("poster_path"),
                    "release_date": rd,
                    "overview": item.get("overview") or "",
                }
            )
        return jsonify({"results": out})

    @app.get("/search/keyword")
    def search_keyword():
        """Proxy de busca de palavras-chave TMDB (autocomplete)."""
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if not token:
            return jsonify({"error": "TMDB_READ_ACCESS_TOKEN não configurado"}), 500

        query = (request.args.get("q") or "").strip()
        if not query:
            return jsonify({"results": []})

        url = f"{TMDB_BASE}/search/keyword"
        params = {"query": query, "language": TMDB_LANG}
        data = _tmdb_json_cached(
            url,
            params,
            ttl=600,
            timeout=12.0,
            op="search_keyword",
        )
        if not isinstance(data, dict):
            return jsonify({"error": "Falha ao consultar TMDB"}), 502

        out = []
        for item in (data.get("results") or [])[:25]:
            kid = item.get("id")
            if not kid:
                continue
            out.append(
                {
                    "id": kid,
                    "name": item.get("name") or "",
                }
            )
        return jsonify({"results": out})

    def _smart_search_tmdb_list(q: str, search_type: str):
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if not token:
            return []
        st = (search_type or "multi").lower()
        if st not in ("multi", "movie", "tv"):
            st = "multi"
        if st == "multi":
            path = "search/multi"
        elif st == "movie":
            path = "search/movie"
        else:
            path = "search/tv"
        url = f"{TMDB_BASE}/{path}"
        params = {"query": q, "language": TMDB_LANG, "page": 1}
        data = _tmdb_json_cached(
            url,
            params,
            ttl=240,
            timeout=15.0,
            op="smart_search_tmdb",
        )
        if not isinstance(data, dict):
            return []
        raw_results = data.get("results") or []
        out = []
        for item in raw_results[:30]:
            mtype = item.get("media_type") or st
            if mtype not in ("movie", "tv"):
                continue
            title = item.get("title") if mtype == "movie" else item.get("name")
            rd = (
                item.get("release_date")
                if mtype == "movie"
                else item.get("first_air_date")
            )
            out.append(
                {
                    "id": item.get("id"),
                    "title": title,
                    "media_type": mtype,
                    "poster_path": item.get("poster_path"),
                    "release_date": rd,
                    "overview": item.get("overview") or "",
                    "vote_average": item.get("vote_average"),
                }
            )
        return out

    def _smart_search_details(media_type: str, tmdb_id: int):
        url = f"{TMDB_BASE}/{media_type}/{tmdb_id}"
        params = {"language": TMDB_LANG, "append_to_response": "credits"}
        data = _tmdb_json_cached(
            url,
            params,
            ttl=900,
            timeout=18.0,
            op="smart_search_details",
        )
        if not isinstance(data, dict):
            return None
        genres_list = [
            g.get("name")
            for g in (data.get("genres") or [])
            if g.get("name")
        ]
        credits = data.get("credits") or {}
        cast = credits.get("cast") or []
        crew = credits.get("crew") or []
        names = []
        for p in cast[:12]:
            if p.get("name"):
                names.append(p["name"])
        for p in crew:
            if p.get("job") in ("Director", "Screenplay", "Writer") and p.get("name"):
                names.append(p["name"])
        blob = " ".join(names[:40])
        title = (
            data.get("title") if media_type == "movie" else data.get("name")
        ) or ""
        return {
            "overview": data.get("overview") or "",
            "genres_csv": ", ".join(genres_list),
            "credits_blob": blob,
            "vote_average": data.get("vote_average"),
            "title": title,
        }

    @app.get("/search/smart")
    def search_smart():
        """Busca híbrida: intenção + embeddings + lexical (sem quebrar /search)."""
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if not token:
            return jsonify({"error": "TMDB_READ_ACCESS_TOKEN não configurado"}), 500
        query = (request.args.get("q") or "").strip()
        search_type = (request.args.get("type") or "multi").lower()
        hide_horror = request.args.get("hide_horror", "").lower() in (
            "1",
            "true",
            "yes",
        )
        hide_violence = request.args.get("hide_violence", "").lower() in (
            "1",
            "true",
            "yes",
        )
        gemini_key = os.environ.get("GEMINI_API_KEY")
        results, meta = run_smart_search(
            tmdb_search_fn=_smart_search_tmdb_list,
            tmdb_details_fn=_smart_search_details,
            query=query,
            search_type=search_type,
            hide_horror=hide_horror,
            hide_violence=hide_violence,
            gemini_key=gemini_key,
        )
        return jsonify({"results": results, "meta": meta})

    @app.get("/details/<media_type>/<int:tmdb_id>")
    def details(media_type: str, tmdb_id: int):
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if not token:
            return (
                "Configure a variável de ambiente TMDB_READ_ACCESS_TOKEN.",
                500,
            )
        if media_type not in ("movie", "tv"):
            return redirect(url_for("index"))

        url = f"{TMDB_BASE}/{media_type}/{tmdb_id}"
        headers = _tmdb_headers(token)
        append_parts = ["credits", "videos", "recommendations", "keywords"]
        if media_type == "movie":
            append_parts.append("release_dates")
        else:
            append_parts.append("content_ratings")
        params = {
            "language": TMDB_LANG,
            "append_to_response": ",".join(append_parts),
        }
        try:
            r = request_with_retry(
                _TMDB_SESSION,
                "GET",
                url,
                params=params,
                headers=headers,
                timeout=20.0,
                max_attempts=4,
            )
            if r.status_code == 404:
                return redirect(url_for("index"))
            r.raise_for_status()
            tmdb_data = r.json()
        except requests.RequestException:
            return "Erro ao carregar dados do TMDB.", 502

        saved = WatchedItem.query.filter_by(
            tmdb_id=tmdb_id, media_type=media_type
        ).first()
        watch_later = WatchLaterItem.query.filter_by(
            tmdb_id=tmdb_id, media_type=media_type
        ).first()

        if media_type == "movie":
            title = tmdb_data.get("title") or ""
            original_title = tmdb_data.get("original_title") or ""
            release_date = tmdb_data.get("release_date") or ""
            runtime_mins = tmdb_data.get("runtime")
            duration_label = (
                f"{runtime_mins} min"
                if runtime_mins
                else None
            )
        else:
            title = tmdb_data.get("name") or ""
            original_title = tmdb_data.get("original_name") or ""
            release_date = tmdb_data.get("first_air_date") or ""
            seasons = tmdb_data.get("number_of_seasons")
            duration_label = (
                f"{seasons} temporada(s)" if seasons else None
            )

        try:
            n_seasons = int(tmdb_data.get("number_of_seasons") or 1)
        except (TypeError, ValueError):
            n_seasons = 1
        n_seasons = max(1, min(n_seasons, 50))
        tv_season_rows = (
            _tv_season_rows(saved, n_seasons)
            if media_type == "tv"
            else []
        )

        genres_list = [
            g.get("name")
            for g in (tmdb_data.get("genres") or [])
            if g.get("name")
        ]
        genres_csv = ", ".join(genres_list)

        credit_lines = _details_credit_lines(tmdb_data, media_type)

        if media_type == "movie":
            certification_br = _br_certification_movie(
                tmdb_data.get("release_dates")
            )
        else:
            certification_br = _br_certification_tv(
                tmdb_data.get("content_ratings")
            )

        recommendation_items = _recommendations_for_details(
            tmdb_data, media_type, limit=10
        )

        collection_info = None
        if media_type == "movie":
            bc = tmdb_data.get("belongs_to_collection")
            if isinstance(bc, dict) and bc.get("id"):
                collection_info = {
                    "id": int(bc["id"]),
                    "name": (bc.get("name") or "Coleção").strip(),
                }

        snap = build_tmdb_snapshot(tmdb_data, media_type)
        profiles = []
        ratings_by_profile_slug = {}
        cpl = Couple.query.order_by(Couple.id).first()
        if cpl:
            profiles = (
                Profile.query.filter_by(couple_id=cpl.id)
                .order_by(Profile.slug)
                .all()
            )
        if saved:
            for pr in WatchProfileRating.query.filter_by(
                watched_item_id=saved.id
            ).all():
                prof = db.session.get(Profile, pr.profile_id)
                if prof:
                    ratings_by_profile_slug[prof.slug] = pr.rating

        context = {
            "media_type": media_type,
            "tmdb_id": tmdb_id,
            "title": title,
            "original_title": original_title,
            "tagline": (tmdb_data.get("tagline") or "").strip(),
            "overview": tmdb_data.get("overview") or "",
            "poster_path": tmdb_data.get("poster_path"),
            "backdrop_path": tmdb_data.get("backdrop_path"),
            "release_date": release_date,
            "genres_list": genres_list,
            "genres_csv": genres_csv,
            "vote_average": tmdb_data.get("vote_average"),
            "duration_label": duration_label,
            "saved": saved,
            "number_of_seasons": n_seasons,
            "tv_season_rows": tv_season_rows,
            "watch_later": watch_later,
            "certification_br": certification_br,
            "recommendation_items": recommendation_items,
            "collection_info": collection_info,
            "tmdb_snapshot_json": snapshot_to_json(snap),
            "profiles": profiles,
            "ratings_by_profile_slug": ratings_by_profile_slug,
            "data_genre_theme": _dominant_genre_theme_slug(genres_list),
            **credit_lines,
        }
        return render_template("details.html", **context)

    @app.get("/api/details/<media_type>/<int:tmdb_id>")
    def api_details_payload(media_type: str, tmdb_id: int):
        """Payload JSON consumido pelo DetailsApp React (hero + tabs + recs)."""
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if not token:
            return jsonify({"error": "TMDB_READ_ACCESS_TOKEN ausente"}), 500
        if media_type not in ("movie", "tv"):
            return jsonify({"error": "media_type inválido"}), 400
        url = f"{TMDB_BASE}/{media_type}/{tmdb_id}"
        headers = _tmdb_headers(token)
        append_parts = ["credits", "videos", "recommendations", "keywords"]
        if media_type == "movie":
            append_parts.append("release_dates")
        else:
            append_parts.append("content_ratings")
        params = {
            "language": TMDB_LANG,
            "append_to_response": ",".join(append_parts),
        }
        try:
            r = request_with_retry(
                _TMDB_SESSION,
                "GET",
                url,
                params=params,
                headers=headers,
                timeout=20.0,
                max_attempts=3,
            )
            if r.status_code == 404:
                return jsonify({"error": "não encontrado"}), 404
            r.raise_for_status()
            tmdb_data = r.json()
        except requests.RequestException:
            return jsonify({"error": "TMDB indisponível"}), 502

        saved = WatchedItem.query.filter_by(
            tmdb_id=tmdb_id, media_type=media_type
        ).first()
        watch_later = WatchLaterItem.query.filter_by(
            tmdb_id=tmdb_id, media_type=media_type
        ).first()

        if media_type == "movie":
            title = tmdb_data.get("title") or ""
            original_title = tmdb_data.get("original_title") or ""
            release_date = tmdb_data.get("release_date") or ""
            runtime_mins = tmdb_data.get("runtime")
            duration_label = f"{runtime_mins} min" if runtime_mins else None
            certification_br = _br_certification_movie(tmdb_data.get("release_dates"))
        else:
            title = tmdb_data.get("name") or ""
            original_title = tmdb_data.get("original_name") or ""
            release_date = tmdb_data.get("first_air_date") or ""
            seasons = tmdb_data.get("number_of_seasons")
            duration_label = f"{seasons} temporada(s)" if seasons else None
            certification_br = _br_certification_tv(tmdb_data.get("content_ratings"))

        genres_list = [
            g.get("name") for g in (tmdb_data.get("genres") or []) if g.get("name")
        ]
        credits = tmdb_data.get("credits") or {}
        cast = [
            {
                "id": p.get("id"),
                "name": p.get("name"),
                "character": p.get("character") or "",
                "profile_path": p.get("profile_path"),
                "order": p.get("order") or 999,
            }
            for p in (credits.get("cast") or [])[:18]
            if p.get("id")
        ]
        crew = credits.get("crew") or []
        directors = [c.get("name") for c in crew if c.get("job") == "Director" and c.get("name")]
        writers = [
            c.get("name")
            for c in crew
            if c.get("department") == "Writing" and c.get("name")
        ]
        # deduplica preservando ordem
        def _dedup(seq):
            seen: set[str] = set()
            out: list[str] = []
            for item in seq:
                if item and item not in seen:
                    seen.add(item)
                    out.append(item)
            return out
        directors = _dedup(directors)
        writers = _dedup(writers)

        videos = tmdb_data.get("videos") or {}
        video_results = [
            {
                "id": v.get("id"),
                "key": v.get("key"),
                "name": v.get("name"),
                "site": v.get("site"),
                "type": v.get("type"),
                "official": bool(v.get("official")),
            }
            for v in (videos.get("results") or [])
            if v.get("site") == "YouTube" and v.get("key")
        ]
        video_results.sort(
            key=lambda v: (0 if v["type"] == "Trailer" else 1, 0 if v["official"] else 1)
        )

        recs_raw = (tmdb_data.get("recommendations") or {}).get("results") or []
        recommendations: list[dict[str, Any]] = []
        for it in recs_raw:
            tid = it.get("id")
            if not tid:
                continue
            mt = it.get("media_type") or media_type
            if mt not in ("movie", "tv"):
                mt = media_type
            rec_title = it.get("title") or it.get("name") or ""
            rec_date = it.get("release_date") or it.get("first_air_date") or ""
            recommendations.append(
                {
                    "id": tid,
                    "media_type": mt,
                    "title": rec_title,
                    "poster_path": it.get("poster_path"),
                    "release_date": rec_date,
                    "vote_average": it.get("vote_average"),
                }
            )
            if len(recommendations) >= 14:
                break

        keywords = [
            {"id": k.get("id"), "name": k.get("name")}
            for k in ((tmdb_data.get("keywords") or {}).get("keywords") or [])
            if k.get("name")
        ][:12]

        collection_info = None
        if media_type == "movie":
            bc = tmdb_data.get("belongs_to_collection")
            if isinstance(bc, dict) and bc.get("id"):
                collection_info = {
                    "id": int(bc["id"]),
                    "name": (bc.get("name") or "Coleção").strip(),
                }

        return jsonify(
            {
                "media_type": media_type,
                "tmdb_id": tmdb_id,
                "title": title,
                "original_title": original_title,
                "tagline": (tmdb_data.get("tagline") or "").strip(),
                "overview": tmdb_data.get("overview") or "",
                "poster_path": tmdb_data.get("poster_path"),
                "backdrop_path": tmdb_data.get("backdrop_path"),
                "release_date": release_date,
                "duration_label": duration_label,
                "genres": genres_list,
                "vote_average": tmdb_data.get("vote_average"),
                "vote_count": tmdb_data.get("vote_count"),
                "popularity": tmdb_data.get("popularity"),
                "certification_br": certification_br,
                "cast": cast,
                "directors": directors,
                "writers": writers,
                "videos": video_results[:8],
                "recommendations": recommendations,
                "keywords": keywords,
                "collection": collection_info,
                "saved": (
                    {
                        "id": saved.id,
                        "rating": float(saved.rating) if saved.rating is not None else None,
                    }
                    if saved
                    else None
                ),
                "watch_later": (
                    {"id": watch_later.id} if watch_later else None
                ),
                "theme_slug": _dominant_genre_theme_slug(genres_list),
            }
        )

    def _build_technical_payload(media_type: str, tmdb_id: int):
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if not token:
            return None, ("TMDB_READ_ACCESS_TOKEN não configurado.", 500)
        if media_type not in ("movie", "tv"):
            return None, ("media_type inválido.", 400)
        url = f"{TMDB_BASE}/{media_type}/{tmdb_id}"
        headers = _tmdb_headers(token)
        append_tech = [
            "credits",
            "videos",
            "external_ids",
            "recommendations",
            "images",
        ]
        if media_type == "movie":
            append_tech.append("release_dates")
        else:
            append_tech.append("content_ratings")
        params = {
            "language": TMDB_LANG,
            "append_to_response": ",".join(append_tech),
        }
        try:
            r = requests.get(url, params=params, headers=headers, timeout=25)
            if r.status_code == 404:
                return None, ("Título não encontrado.", 404)
            r.raise_for_status()
            tmdb_data = r.json()
        except requests.RequestException:
            return None, ("Erro ao carregar dados do TMDB.", 502)

        tech = _technical_page_context(tmdb_data, media_type)
        tech["tmdb_id"] = tmdb_id
        tech["media_type"] = media_type
        collection_info = None
        if media_type == "movie":
            bc = tmdb_data.get("belongs_to_collection")
            if isinstance(bc, dict) and bc.get("id"):
                collection_info = {
                    "id": int(bc["id"]),
                    "name": (bc.get("name") or "Coleção").strip(),
                }
        tech["collection_info"] = collection_info
        return tech, None

    @app.get("/details/<media_type>/<int:tmdb_id>/ficha-tecnica")
    def technical_sheet(media_type: str, tmdb_id: int):
        """Shell React: a ilha consome /api/technical/<mt>/<id>."""
        if media_type not in ("movie", "tv"):
            return redirect(url_for("index"))
        return render_template(
            "technical_sheet.html",
            media_type=media_type,
            tmdb_id=tmdb_id,
        )

    @app.get("/api/technical/<media_type>/<int:tmdb_id>")
    def api_technical(media_type: str, tmdb_id: int):
        payload, err = _build_technical_payload(media_type, tmdb_id)
        if err:
            msg, status = err
            return jsonify({"error": msg}), status
        return jsonify(payload)

    def _build_person_payload(person_id: int):
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if not token:
            return None, ("TMDB_READ_ACCESS_TOKEN não configurado.", 500)
        url = f"{TMDB_BASE}/person/{person_id}"
        headers = _tmdb_headers(token)
        params = {
            "language": TMDB_LANG,
            "append_to_response": "combined_credits",
        }
        try:
            r = requests.get(url, params=params, headers=headers, timeout=22)
            if r.status_code == 404:
                return None, ("Pessoa não encontrada.", 404)
            r.raise_for_status()
            pdata = r.json()
        except requests.RequestException:
            return None, ("Erro ao carregar dados do TMDB.", 502)

        name = pdata.get("name") or "Pessoa"
        profile_path = pdata.get("profile_path")
        biography = (pdata.get("biography") or "").strip()
        known = (pdata.get("known_for_department") or "").strip()
        birthday = pdata.get("birthday")
        deathday = pdata.get("deathday")
        place = (pdata.get("place_of_birth") or "").strip()
        popularity = pdata.get("popularity")

        cc = pdata.get("combined_credits") or {}
        cast_raw = cc.get("cast") or []
        crew_raw = cc.get("crew") or []

        def _add_entry(bucket, entry):
            tid = entry.get("id")
            mt = entry.get("media_type")
            if mt not in ("movie", "tv") or not tid:
                return
            key = (mt, tid)
            if key in bucket["_seen"]:
                return
            bucket["_seen"].add(key)
            if mt == "movie":
                title = entry.get("title") or ""
                rd = entry.get("release_date") or ""
            else:
                title = entry.get("name") or ""
                rd = entry.get("first_air_date") or ""
            role = (entry.get("character") or entry.get("job") or "").strip()
            bucket["rows"].append(
                {
                    "tmdb_id": tid,
                    "media_type": mt,
                    "title": title,
                    "release_date": rd,
                    "poster_path": entry.get("poster_path"),
                    "vote_average": entry.get("vote_average"),
                    "role": role or "—",
                }
            )

        movie_acc = {"_seen": set(), "rows": []}
        tv_acc = {"_seen": set(), "rows": []}
        for c in cast_raw:
            mt = c.get("media_type")
            if mt == "movie":
                _add_entry(movie_acc, c)
            elif mt == "tv":
                _add_entry(tv_acc, c)
        for c in crew_raw:
            mt = c.get("media_type")
            if mt == "movie":
                _add_entry(movie_acc, c)
            elif mt == "tv":
                _add_entry(tv_acc, c)

        def _sort_key(row):
            d = row.get("release_date") or ""
            return d

        movie_rows = sorted(
            movie_acc["rows"],
            key=_sort_key,
            reverse=True,
        )
        tv_rows = sorted(tv_acc["rows"], key=_sort_key, reverse=True)

        return {
            "person_id": person_id,
            "name": name,
            "profile_path": profile_path,
            "biography": biography,
            "known_for_department": known,
            "birthday": birthday,
            "deathday": deathday,
            "place_of_birth": place,
            "popularity": popularity,
            "movie_rows": movie_rows,
            "tv_rows": tv_rows,
            "total_credits": len(movie_rows) + len(tv_rows),
        }, None

    @app.get("/pessoa/<int:person_id>")
    def person_page(person_id: int):
        """Shell React: a ilha consome /api/person/<id>."""
        return render_template("person.html", person_id=person_id)

    @app.get("/api/person/<int:person_id>")
    def api_person(person_id: int):
        payload, err = _build_person_payload(person_id)
        if err:
            msg, status = err
            return jsonify({"error": msg}), status
        return jsonify(payload)

    def _build_collection_payload(collection_id: int):
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if not token:
            return None, ("TMDB_READ_ACCESS_TOKEN não configurado.", 500)
        url = f"{TMDB_BASE}/collection/{collection_id}"
        headers = _tmdb_headers(token)
        params = {"language": TMDB_LANG}
        try:
            r = requests.get(url, params=params, headers=headers, timeout=20)
            if r.status_code == 404:
                return None, ("Coleção não encontrada.", 404)
            r.raise_for_status()
            cdata = r.json()
        except requests.RequestException:
            return None, ("Erro ao carregar dados do TMDB.", 502)

        name = cdata.get("name") or "Coleção"
        overview = (cdata.get("overview") or "").strip()
        backdrop_path = cdata.get("backdrop_path")
        poster_path = cdata.get("poster_path")
        parts = []
        for p in cdata.get("parts") or []:
            tid = p.get("id")
            if not tid:
                continue
            parts.append(
                {
                    "tmdb_id": tid,
                    "title": p.get("title") or "",
                    "overview": (p.get("overview") or "").strip(),
                    "release_date": p.get("release_date") or "",
                    "poster_path": p.get("poster_path"),
                    "backdrop_path": p.get("backdrop_path"),
                    "vote_average": p.get("vote_average"),
                }
            )
        parts.sort(
            key=lambda x: x.get("release_date") or "",
            reverse=True,
        )
        return {
            "collection_id": collection_id,
            "name": name,
            "overview": overview,
            "backdrop_path": backdrop_path,
            "poster_path": poster_path,
            "parts": parts,
        }, None

    @app.get("/colecao/<int:collection_id>")
    def collection_page(collection_id: int):
        """Shell React: a ilha consome /api/collection/<id>."""
        return render_template("collection.html", collection_id=collection_id)

    @app.get("/api/collection/<int:collection_id>")
    def api_collection(collection_id: int):
        payload, err = _build_collection_payload(collection_id)
        if err:
            msg, status = err
            return jsonify({"error": msg}), status
        return jsonify(payload)

    @app.post("/add")
    def add_item():
        try:
            tmdb_id = int(request.form.get("tmdb_id", 0))
        except (TypeError, ValueError):
            return redirect(url_for("history"))
        media_type = request.form.get("media_type") or "movie"
        if media_type not in ("movie", "tv"):
            return redirect(url_for("history"))

        season_json_str = None
        if media_type == "tv":
            raw_json = request.form.get("season_data_json") or ""
            parsed, err = _parse_tv_season_json(raw_json)
            if err:
                abort(400, description=err)
            rating = float(parsed["average"])
            season_json_str = json.dumps(
                parsed["seasons"],
                ensure_ascii=False,
            )
            review = None
        else:
            try:
                rating = float(request.form.get("rating", 0))
            except (TypeError, ValueError):
                rating = 0.0
            if rating < 0.5 or rating > 10 or abs(rating * 2 - round(rating * 2)) > 1e-6:
                abort(
                    400,
                    description="Avaliação inválida: informe uma nota de 0,5 a 10 (passos de 0,5).",
                )
            review = request.form.get("review")
            if review is not None:
                review = review.strip() or None

        title = (request.form.get("title") or "").strip() or "Sem título"
        original_title = (request.form.get("original_title") or "").strip()
        overview = request.form.get("overview") or ""
        poster_path = request.form.get("poster_path") or ""
        backdrop_path = request.form.get("backdrop_path") or ""
        release_date = request.form.get("release_date") or ""

        genres_str = request.form.get("genres") or ""
        try:
            vote_average = float(request.form.get("vote_average") or 0)
        except (TypeError, ValueError):
            vote_average = 0.0

        snap_raw = (request.form.get("tmdb_snapshot_json") or "").strip() or None

        existing = WatchedItem.query.filter_by(
            tmdb_id=tmdb_id, media_type=media_type
        ).first()
        if existing:
            item = existing
            item.title = title
            item.original_title = original_title
            item.overview = overview
            item.poster_path = poster_path or None
            item.backdrop_path = backdrop_path or None
            item.release_date = release_date or None
            item.genres = genres_str or None
            item.vote_average = vote_average
            item.rating = rating
            item.review = review
            item.season_data = season_json_str
            item.tmdb_snapshot_json = snap_raw
        else:
            item = WatchedItem(
                tmdb_id=tmdb_id,
                media_type=media_type,
                title=title,
                original_title=original_title or None,
                overview=overview or None,
                poster_path=poster_path or None,
                backdrop_path=backdrop_path or None,
                release_date=release_date or None,
                genres=genres_str or None,
                vote_average=vote_average,
                rating=rating,
                review=review,
                season_data=season_json_str,
                tmdb_snapshot_json=snap_raw,
            )
            db.session.add(item)

        WatchLaterItem.query.filter_by(
            tmdb_id=tmdb_id, media_type=media_type
        ).delete(synchronize_session=False)
        db.session.flush()

        WatchProfileRating.query.filter_by(watched_item_id=item.id).delete(
            synchronize_session=False
        )
        cpl = Couple.query.order_by(Couple.id).first()

        if gamification_v2_enabled() and cpl:
            from gamification.engine import on_watched_saved

            joint = float(rating)
            pr_list = [
                (p.id, joint, None)
                for p in Profile.query.filter_by(couple_id=cpl.id).all()
            ]
            try:
                on_watched_saved(db, cpl.id, item, pr_list)
            except Exception as exc:
                current_app.logger.warning("gamification on_watched: %s", exc)

        db.session.commit()
        return redirect(url_for("history", saved="1"))

    @app.post("/watch-later/add")
    def watch_later_add():
        try:
            tmdb_id = int(request.form.get("tmdb_id", 0))
        except (TypeError, ValueError):
            return redirect(url_for("index"))
        media_type = request.form.get("media_type") or "movie"
        if media_type not in ("movie", "tv"):
            return redirect(url_for("index"))

        title = (request.form.get("title") or "").strip() or "Sem título"
        original_title = (request.form.get("original_title") or "").strip()
        overview = request.form.get("overview") or ""
        poster_path = request.form.get("poster_path") or ""
        backdrop_path = request.form.get("backdrop_path") or ""
        release_date = request.form.get("release_date") or ""
        genres_str = request.form.get("genres") or ""
        try:
            vote_average = float(request.form.get("vote_average") or 0)
        except (TypeError, ValueError):
            vote_average = 0.0

        row = WatchLaterItem.query.filter_by(
            tmdb_id=tmdb_id, media_type=media_type
        ).first()
        if row:
            row.title = title
            row.original_title = original_title or None
            row.overview = overview or None
            row.poster_path = poster_path or None
            row.backdrop_path = backdrop_path or None
            row.release_date = release_date or None
            row.genres = genres_str or None
            row.vote_average = vote_average
        else:
            db.session.add(
                WatchLaterItem(
                    tmdb_id=tmdb_id,
                    media_type=media_type,
                    title=title,
                    original_title=original_title or None,
                    overview=overview or None,
                    poster_path=poster_path or None,
                    backdrop_path=backdrop_path or None,
                    release_date=release_date or None,
                    genres=genres_str or None,
                    vote_average=vote_average,
                )
            )
        db.session.commit()
        return redirect(
            url_for("details", media_type=media_type, tmdb_id=tmdb_id)
        )

    @app.post("/watch-later/remove/<int:item_id>")
    def watch_later_remove(item_id: int):
        row = WatchLaterItem.query.get(item_id)
        mt = None
        tid = None
        if row:
            mt = row.media_type
            tid = row.tmdb_id
            db.session.delete(row)
            db.session.commit()
        dest = (request.form.get("return_to") or "").strip()
        if dest == "details" and mt in ("movie", "tv") and tid is not None:
            return redirect(url_for("details", media_type=mt, tmdb_id=tid))
        return redirect(url_for("listas_fila"))

    @app.post("/delete/<int:item_id>")
    def delete_item(item_id: int):
        row = WatchedItem.query.get(item_id)
        if row:
            cpl_del = Couple.query.order_by(Couple.id).first()
            if gamification_v2_enabled() and cpl_del:
                db.session.add(
                    GamificationEvent(
                        couple_id=cpl_del.id,
                        event_type="media.deleted",
                        payload_json=json.dumps(
                            {
                                "watched_item_id": row.id,
                                "tmdb_id": row.tmdb_id,
                                "media_type": row.media_type,
                            },
                            default=str,
                        ),
                        created_at=datetime.utcnow(),
                    )
                )
            db.session.delete(row)
            db.session.commit()
        return redirect(url_for("history"))

    @app.post("/suggestions/random")
    def suggestions_random():
        """Uma sugestão aleatória via discover do TMDB (gênero opcional) ou 1 item de lista local."""
        body = request.get_json(silent=True) or {}
        list_pick = body.get("list_pick")
        if list_pick is not None and str(list_pick).strip() != "":
            cid = _couple_id()
            lp = str(list_pick).strip().lower()
            rows_all: list = []
            if lp in ("fila", "watchlater", "queue", "assistir_depois"):
                rows_all = WatchLaterItem.query.order_by(WatchLaterItem.added_at.asc()).all()
            else:
                try:
                    lid = int(list_pick)
                except (TypeError, ValueError):
                    return jsonify({"error": "Lista inválida"}), 400
                ml = MediaList.query.filter_by(id=lid, couple_id=cid).first()
                if not ml:
                    return jsonify({"error": "Lista não encontrada."}), 404
                rows_all = (
                    MediaListItem.query.filter_by(list_id=lid)
                    .order_by(MediaListItem.added_at.asc())
                    .all()
                )
            if not rows_all:
                return jsonify({"error": "A lista está vazia."}), 404
            excluded = _parse_exclude_drawn(body)
            rows_ok = [
                r
                for r in rows_all
                if (str(r.media_type), int(r.tmdb_id)) not in excluded
            ]
            if not rows_ok:
                return jsonify(
                    {
                        "error": (
                            "Nesta aba já sorteamos todos os títulos desta lista. "
                            "Recarregue a página para zerar o histórico ou escolha outra lista."
                        )
                    }
                ), 404
            pick = random.choice(rows_ok)
            return jsonify(
                {
                    "id": pick.tmdb_id,
                    "title": pick.title,
                    "media_type": pick.media_type,
                    "poster_path": pick.poster_path,
                    "overview": (pick.overview or "") or "",
                }
            )

        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if not token:
            return jsonify({"error": "TMDB não configurado"}), 500

        genre_id = body.get("genre_id")
        genre_ids_raw = body.get("genre_ids")
        keyword_id_raw = body.get("keyword_id")
        media_type = body.get("media_type")
        if media_type not in (None, "movie", "tv"):
            return jsonify({"error": "media_type inválido"}), 400
        if media_type is None:
            media_type = random.choice(("movie", "tv"))

        with_keywords = None
        if keyword_id_raw is not None and str(keyword_id_raw).strip() != "":
            try:
                with_keywords = int(keyword_id_raw)
            except (TypeError, ValueError):
                return jsonify({"error": "keyword_id inválido"}), 400

        with_genres: int | str | None = None
        if with_keywords is None:
            parsed_multi: list[int] = []
            if isinstance(genre_ids_raw, list) and genre_ids_raw:
                for raw in genre_ids_raw[:12]:
                    try:
                        parsed_multi.append(int(raw))
                    except (TypeError, ValueError):
                        continue
                parsed_multi = list(dict.fromkeys(parsed_multi))
            if parsed_multi:
                # TMDB Discover: pipe (|) = OR entre gêneros
                with_genres = "|".join(str(g) for g in parsed_multi)
            elif genre_id is not None and genre_id != "":
                if isinstance(genre_id, str) and genre_id.strip().lower() in (
                    "soap",
                    "novela",
                ):
                    with_genres = SOAP_NOVELA_GENRE_ID
                else:
                    try:
                        with_genres = int(genre_id)
                    except (TypeError, ValueError):
                        return jsonify({"error": "genre_id inválido"}), 400

        # Gênero Soap (novelas): no TMDB quase só existem séries; discover/movie costuma vir vazio.
        if with_genres is not None and (
            with_genres == SOAP_NOVELA_GENRE_ID
            or (
                isinstance(with_genres, str)
                and str(SOAP_NOVELA_GENRE_ID) in with_genres.split("|")
            )
        ):
            media_type = "tv"

        def try_discover(mt, min_votes, pages):
            """Testa várias páginas até obter resultados (evita 404 por página vazia)."""
            base = {
                "language": TMDB_LANG,
                "sort_by": "popularity.desc",
                "vote_count.gte": min_votes,
            }
            if with_genres is not None:
                base["with_genres"] = with_genres
            if with_keywords is not None:
                base["with_keywords"] = with_keywords
            random.shuffle(pages)
            url = f"{TMDB_BASE}/discover/{mt}"
            for page in pages:
                params = {**base, "page": page}
                j = _tmdb_json_cached(
                    url,
                    params,
                    ttl=180,
                    timeout=20.0,
                    op="discover_random",
                )
                if isinstance(j, dict):
                    res = j.get("results") or []
                    if res:
                        return res, mt
            return [], mt

        pages_pool = list(range(1, 21))

        _has_novela = with_genres == SOAP_NOVELA_GENRE_ID or (
            isinstance(with_genres, str)
            and str(SOAP_NOVELA_GENRE_ID) in with_genres.split("|")
        )

        def full_discover_pass(start_mt: str) -> tuple[list[Any], str]:
            """Uma passagem completa do pipeline discover (votos, novela, anime)."""
            mt = start_mt
            res, mt = try_discover(mt, 100, pages_pool[:])
            if not res and (with_genres is not None or with_keywords is not None):
                res, mt = try_discover(mt, 1, pages_pool[:])
            if not res and _has_novela:
                other = "movie" if mt == "tv" else "tv"
                res, mt = try_discover(other, 1, pages_pool[:])
            if not res and with_keywords == ANIME_KEYWORD_ID:
                other = "movie" if mt == "tv" else "tv"
                res, mt = try_discover(other, 1, pages_pool[:])
            return res, mt

        excluded = _parse_exclude_drawn(body)

        def pool_eligible(res_list: list[Any], mt: str) -> list[Any]:
            pool: list[Any] = []
            for it in res_list:
                if not isinstance(it, dict):
                    continue
                mid_raw = it.get("id")
                if mid_raw is None:
                    continue
                try:
                    mid_i = int(mid_raw)
                except (TypeError, ValueError):
                    continue
                if (str(mt), mid_i) in excluded:
                    continue
                pool.append(it)
            return pool

        item: dict[str, Any] | None = None
        picked_mt: str | None = None
        cur_mt = str(media_type)
        last_nonempty: list[Any] | None = None
        last_nonempty_mt: str | None = None
        for _attempt in range(50):
            results, cur_mt = full_discover_pass(cur_mt)
            if not results:
                break
            last_nonempty, last_nonempty_mt = results, cur_mt
            pool = pool_eligible(results, cur_mt)
            if pool:
                item = random.choice(pool)
                picked_mt = cur_mt
                break

        if item is None:
            if last_nonempty is None:
                return (
                    jsonify(
                        {
                            "error": (
                                "Nenhum título encontrado com esses critérios. "
                                "Tente outro gênero ou tipo."
                            )
                        }
                    ),
                    404,
                )
            return (
                jsonify(
                    {
                        "error": (
                            "Nesta aba já sorteamos muitos títulos com esses filtros e "
                            "não há candidatos novos agora. Recarregue a página para zerar "
                            "o histórico ou mude gênero / tipo / lista."
                        )
                    }
                ),
                404,
            )

        mid = item.get("id")
        media_type = str(picked_mt or last_nonempty_mt or cur_mt)
        if mid is None:
            return jsonify({"error": "Resposta inválida"}), 502

        title = (
            item.get("title")
            if media_type == "movie"
            else item.get("name")
        ) or ""

        return jsonify(
            {
                "id": mid,
                "title": title,
                "media_type": media_type,
                "poster_path": item.get("poster_path"),
                "overview": item.get("overview") or "",
            }
        )

    @app.post("/suggestions/gemini")
    def suggestions_gemini():
        """Sugestões via Gemini + enriquecimento com search/multi TMDB."""
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if not token:
            return jsonify({"error": "TMDB não configurado"}), 500

        gemini_key = os.environ.get("GEMINI_API_KEY")
        if not gemini_key:
            return (
                jsonify(
                    {
                        "error": "Não foi possível gerar sugestões agora. Tente novamente."
                    }
                ),
                503,
            )

        body = request.get_json(silent=True) or {}
        titles = body.get("titles")
        if not isinstance(titles, list):
            return jsonify({"error": "Lista de títulos inválida"}), 400

        cleaned = []
        for t in titles:
            if isinstance(t, str) and t.strip():
                cleaned.append(t.strip())
        if not cleaned:
            return jsonify({"error": "Informe pelo menos um título."}), 400

        media_scope = body.get("media_scope") or "mixed"
        if media_scope not in ("movie", "tv", "mixed"):
            media_scope = "mixed"

        titles_csv = ", ".join(cleaned)
        if media_scope == "movie":
            type_rules = """IMPORTANTE: As 10 sugestões devem ser EXCLUSIVAMENTE FILMES (longas-metragens). Não inclua séries de TV, minisséries nem documentários-seriados. Apenas filmes."""
            balance_extra = "Varie gêneros e países. Títulos como costumam aparecer no Brasil."
        elif media_scope == "tv":
            type_rules = """IMPORTANTE: As 10 sugestões devem ser EXCLUSIVAMENTE SÉRIES DE TV (incluindo minisséries e séries documentais em formato seriado). Não inclua filmes."""
            balance_extra = "Varie gêneros e países. Títulos como costumam aparecer no Brasil."
        else:
            type_rules = """Sugira filmes E séries (misture os dois formatos na lista de 10)."""
            balance_extra = """Varie gêneros, países e formatos (filme/série). Títulos como costumam aparecer no Brasil."""

        prompt = f"""Você é curador de cinema e séries para um casal que já assistiu muitos filmes e séries.

Títulos que eles curtem (referência de gosto, não repetir): {titles_csv}

Tarefa: sugira EXATAMENTE 10 títulos diferentes que NÃO estejam na lista acima (nem continuações óbvias só por fan-service).

{type_rules}

Balance obrigatório (o casal já viu muito conteúdo óbvio; priorize descoberta):
- Cerca de 3 títulos (no máximo): grandes sucessos, blockbusters ou séries muito famosas que ainda façam sentido com o gosto deles.
- Os outros 7 títulos: priorize obras NICHADAS — pouco divulgadas, subestimadas, festival/cult, séries canceladas cedo, filmes de autor em catálogo de grandes streamers ou estúdios, coproduções internacionais, animações adultas raras, documentários fora do radar, thrillers europeus/asiáticos/latinos, minisséries esquecidas. Evite repetir fórmulas das franquias mais óbvias.
- Mesmo no nicho, prefira qualidade de produção (não sugestões amadoras): ligar a A24, Searchlight, HBO, Netflix, Apple TV+, Amazon, Canal+, BBC, Arte, etc., é desejável.

{balance_extra}

Responda APENAS com um JSON válido, sem markdown, sem texto antes ou depois, neste formato exato:
{{"suggestions": ["Título 1", "Título 2", "Título 3", "Título 4", "Título 5", "Título 6", "Título 7", "Título 8", "Título 9", "Título 10"]}}"""

        # SDK google-genai: Client + models.generate_content (documentação atual).
        model = (os.environ.get("GEMINI_MODEL") or GEMINI_DEFAULT_MODEL).strip()
        model_resolved = _resolve_gemini_model_id(model)
        text, sdk_err = _gemini_generate_text_sdk(prompt, gemini_key, model)
        if sdk_err:
            current_app.logger.warning(
                "Gemini (modelo=%s → %s): %s",
                model,
                model_resolved,
                sdk_err[:800],
            )
            return (
                jsonify(
                    {
                        "error": "Não foi possível gerar sugestões agora. Tente novamente.",
                        **(
                            {"detail": sdk_err}
                            if _wants_gemini_error_detail()
                            else {}
                        ),
                    }
                ),
                502,
            )
        if not text:
            return (
                jsonify(
                    {
                        "error": "Não foi possível gerar sugestões agora. Tente novamente."
                    }
                ),
                502,
            )

        suggestion_titles = _parse_gemini_suggestions_json(text)
        if not suggestion_titles:
            current_app.logger.warning(
                "Gemini: não foi possível extrair JSON de sugestões. Trecho: %s",
                (text[:400] + "…") if len(text) > 400 else text,
            )
            return (
                jsonify(
                    {
                        "error": "Não foi possível gerar sugestões agora. Tente novamente.",
                        **(
                            {"detail": text[:500]}
                            if _wants_gemini_error_detail()
                            else {}
                        ),
                    }
                ),
                502,
            )

        if media_scope == "movie":
            search_endpoint = "search/movie"
        elif media_scope == "tv":
            search_endpoint = "search/tv"
        else:
            search_endpoint = "search/multi"

        results_out = []
        for st in suggestion_titles[:14]:
            if len(results_out) >= 10:
                break
            sdata = _tmdb_json_cached(
                f"{TMDB_BASE}/{search_endpoint}",
                {"query": st, "language": TMDB_LANG, "page": 1},
                ttl=3600,
                timeout=15.0,
                op="gemini_title_lookup",
            )
            if not isinstance(sdata, dict):
                continue

            picked = None
            if media_scope == "movie":
                for row in sdata.get("results") or []:
                    picked = row
                    break
                if picked:
                    mt = "movie"
                    tid = picked.get("id")
                    t_title = picked.get("title") or ""
            elif media_scope == "tv":
                for row in sdata.get("results") or []:
                    picked = row
                    break
                if picked:
                    mt = "tv"
                    tid = picked.get("id")
                    t_title = picked.get("name") or ""
            else:
                for row in sdata.get("results") or []:
                    mt = row.get("media_type")
                    if mt not in ("movie", "tv"):
                        continue
                    picked = row
                    break
                if not picked:
                    continue
                mt = picked.get("media_type")
                tid = picked.get("id")
                t_title = (
                    picked.get("title") if mt == "movie" else picked.get("name")
                ) or ""

            if not picked or not tid:
                continue

            results_out.append(
                {
                    "id": tid,
                    "title": t_title,
                    "media_type": mt,
                    "poster_path": picked.get("poster_path"),
                    "overview": picked.get("overview") or "",
                }
            )

        return jsonify({"results": results_out})

    @app.post("/suggestions/keywords")
    def suggestions_keywords():
        """Sorteio por palavras-chave (discover AND; fallback OR)."""
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if not token:
            return jsonify({"error": "TMDB não configurado"}), 500

        body = request.get_json(silent=True) or {}
        raw_ids = body.get("keyword_ids")
        media_type = body.get("media_type") or "movie"
        if media_type not in ("movie", "tv"):
            return jsonify({"error": "media_type inválido"}), 400
        if not isinstance(raw_ids, list) or not raw_ids:
            return (
                jsonify({"error": "Selecione ao menos uma palavra-chave."}),
                400,
            )

        clean_ids = []
        for x in raw_ids[:10]:
            try:
                clean_ids.append(int(x))
            except (TypeError, ValueError):
                continue
        if not clean_ids:
            return jsonify({"error": "IDs de palavras-chave inválidos."}), 400

        kw_and = ",".join(str(i) for i in clean_ids)
        pages_pool = list(range(1, 16))
        random.shuffle(pages_pool)

        def _discover(with_kw):
            url = f"{TMDB_BASE}/discover/{media_type}"
            for page in pages_pool:
                params = {
                    "language": TMDB_LANG,
                    "sort_by": "popularity.desc",
                    "vote_count.gte": 15,
                    "with_keywords": with_kw,
                    "page": page,
                }
                j = _tmdb_json_cached(
                    url,
                    params,
                    ttl=240,
                    timeout=20.0,
                    op="discover_keywords",
                )
                if isinstance(j, dict):
                    res = j.get("results") or []
                    if res:
                        return res
            return []

        results = _discover(kw_and)
        if not results:
            results = _discover("|".join(str(i) for i in clean_ids))

        if not results:
            return (
                jsonify(
                    {
                        "error": "Nenhum título encontrado com essas palavras-chave. Tente menos termos ou outra combinação."
                    }
                ),
                404,
            )

        item = random.choice(results)
        mid = item.get("id")
        if mid is None:
            return jsonify({"error": "Resposta inválida"}), 502

        title = (
            item.get("title")
            if media_type == "movie"
            else item.get("name")
        ) or ""

        return jsonify(
            {
                "id": mid,
                "title": title,
                "media_type": media_type,
                "poster_path": item.get("poster_path"),
                "overview": item.get("overview") or "",
            }
        )

    def _couple_id() -> int:
        row = Couple.query.order_by(Couple.id).first()
        return int(row.id) if row else 1

    def _abort_gamification_off():
        if not gamification_v2_enabled():
            abort(404)

    @app.get("/perfil")
    def profile_gamification_page():
        _abort_gamification_off()
        from gamification.seasons import ensure_current_season

        cpl = Couple.query.order_by(Couple.id).first()
        if not cpl:
            abort(500, description="Sem casal configurado")
        ensure_current_season(db, GameSeason)
        # Dados concretos são servidos pelo endpoint /api/profile/state
        # consumido pela ilha React em templates/perfil.html.
        return render_template(
            "perfil.html",
            data_genre_theme="default",
        )

    @app.get("/temporada")
    def season_info_page():
        _abort_gamification_off()
        return render_template(
            "temporada_info.html",
            data_genre_theme="default",
        )

    def _tmdb_movie_brief(tmdb_id: int, media_type: str = "movie"):
        mt = "movie" if media_type not in ("movie", "tv") else media_type
        url = f"{TMDB_BASE}/{mt}/{int(tmdb_id)}"
        params = {"language": TMDB_LANG}
        data = _tmdb_json_cached(url, params, ttl=86400, timeout=10.0, op=f"{mt}_brief")
        if not isinstance(data, dict):
            return None
        title = data.get("title") if mt == "movie" else data.get("name")
        rd = data.get("release_date") if mt == "movie" else data.get("first_air_date")
        return {
            "tmdb_id": int(tmdb_id),
            "media_type": mt,
            "title": title or "",
            "poster_path": data.get("poster_path") or "",
            "year": (str(rd)[:4] if rd else None),
            "vote_average": data.get("vote_average"),
        }

    def _tmdb_discover_by_keyword(keyword_id: int, limit: int = 12):
        url = f"{TMDB_BASE}/discover/movie"
        params = {
            "language": TMDB_LANG,
            "sort_by": "popularity.desc",
            "with_keywords": str(int(keyword_id)),
            "page": 1,
        }
        data = _tmdb_json_cached(
            url, params, ttl=86400, timeout=12.0, op="discover_keyword"
        )
        if not isinstance(data, dict):
            return []
        out = []
        for item in (data.get("results") or [])[:limit]:
            out.append(
                {
                    "tmdb_id": int(item.get("id") or 0),
                    "media_type": "movie",
                    "title": item.get("title") or "",
                    "poster_path": item.get("poster_path") or "",
                    "year": (str(item.get("release_date") or "")[:4] or None),
                    "vote_average": item.get("vote_average"),
                }
            )
        return [o for o in out if o["tmdb_id"]]

    @app.get("/api/season/current")
    def season_current_api():
        from gamification.feature_flags import gamification_v2_enabled, seasons_enabled
        from gamification.season_themes import get_theme
        from gamification.seasons import current_season
        from gamification.engine import load_achievements_catalog

        if not gamification_v2_enabled() or not seasons_enabled():
            return jsonify({"enabled": False})

        season = current_season(db, GameSeason)
        if not season:
            return jsonify({"enabled": False})

        theme = get_theme(season.theme_key) or {}
        now = datetime.utcnow()
        start = season.starts_at
        end = season.ends_at
        total_sec = max(1, int((end - start).total_seconds())) if start and end else 1
        elapsed = max(0, int((now - start).total_seconds())) if start else 0
        progress_pct = min(100.0, 100.0 * elapsed / total_sec)

        cpl = Couple.query.order_by(Couple.id).first()
        ach_rows_by_id: dict[str, AchievementProgress] = {}
        if cpl:
            for row in AchievementProgress.query.filter_by(couple_id=cpl.id).all():
                ach_rows_by_id[row.achievement_id] = row

        catalog_by_id = {ach.get("id"): ach for ach in load_achievements_catalog()}
        seasonal_achievements: list[dict[str, Any]] = []
        for ach_id in theme.get("seasonal_achievements", []) or []:
            ach = catalog_by_id.get(ach_id)
            if not ach:
                continue
            rule = ach.get("rule") or {}
            row = ach_rows_by_id.get(ach_id)
            progress = int(row.progress) if row and row.progress is not None else 0
            target = int(rule.get("target") or (row.target if row else 1) or 1)
            seasonal_achievements.append(
                {
                    "id": ach_id,
                    "title": ach.get("title"),
                    "description": ach.get("description"),
                    "icon": ach.get("icon"),
                    "rarity": ach.get("rarity", "seasonal"),
                    "xp_reward": int(ach.get("xp_reward") or 0),
                    "rule_type": rule.get("type"),
                    "progress": progress,
                    "target": target,
                    "unlocked": bool(row and row.unlocked_at),
                }
            )

        curated_lists: list[dict[str, Any]] = []
        for lst in theme.get("curated_lists", []) or []:
            items: list[dict[str, Any]] = []
            for it in (lst.get("items") or [])[:12]:
                brief = _tmdb_movie_brief(
                    it.get("tmdb_id"), it.get("media_type", "movie")
                )
                if brief:
                    items.append(brief)
            curated_lists.append(
                {
                    "id": lst.get("id"),
                    "title": lst.get("title"),
                    "subtitle": lst.get("subtitle"),
                    "items": items,
                }
            )

        keyword_showcases: list[dict[str, Any]] = []
        for kw in theme.get("tmdb_keywords", []) or []:
            kid = kw.get("id")
            if not kid:
                continue
            items = _tmdb_discover_by_keyword(int(kid), limit=12)
            keyword_showcases.append(
                {
                    "keyword_id": int(kid),
                    "title": f"Filmes com {kw.get('name', 'keyword')}",
                    "subtitle": "Selecionados pelo TMDB.",
                    "items": items,
                }
            )

        return jsonify(
            {
                "enabled": True,
                "label": season.label,
                "theme_key": season.theme_key,
                "title": theme.get("title") or season.title,
                "emoji": theme.get("emoji") or season.trophy_icon,
                "tagline": theme.get("tagline", ""),
                "long_intro": theme.get("long_intro", ""),
                "xp_multiplier": float(theme.get("xp_multiplier", 1.0)),
                "bonus_genres": theme.get("bonus_genres", []),
                "starts_at": season.starts_at.isoformat() if season.starts_at else None,
                "ends_at": season.ends_at.isoformat() if season.ends_at else None,
                "progress_pct": round(progress_pct, 1),
                "seasonal_achievements": seasonal_achievements,
                "curated_lists": curated_lists,
                "keyword_showcases": keyword_showcases,
            }
        )

    @app.get("/api/profile/state")
    def profile_state_api():
        from gamification.display_pt import (
            achievement_icon_pt as _ach_icon,
            achievement_title_pt as _ach_title,
            xp_reason_pt as _xp_reason,
        )
        from gamification.feature_flags import gamification_v2_enabled, seasons_enabled
        from gamification.season_themes import get_theme
        from gamification.seasons import current_season
        from gamification.xp_levels import level_and_progress

        if not gamification_v2_enabled():
            return jsonify({"enabled": False})

        cpl = Couple.query.order_by(Couple.id).first()
        if not cpl:
            return jsonify({"enabled": False})

        st = CoupleXpState.query.filter_by(couple_id=cpl.id).first()
        total = int(st.total_xp or 0) if st else 0
        lv, into, need, title = level_and_progress(total)

        profiles_rows = (
            Profile.query.filter_by(couple_id=cpl.id).order_by(Profile.slug).all()
        )
        profiles_payload: list[dict[str, Any]] = []
        season = current_season(db, GameSeason) if seasons_enabled() else None
        season_scores_by_pid: dict[int, int] = {}
        if season:
            for sc in SeasonProfileScore.query.filter_by(season_id=season.id).all():
                season_scores_by_pid[sc.profile_id] = int(sc.points or 0)
        for p in profiles_rows:
            profiles_payload.append(
                {
                    "slug": p.slug,
                    "display_name": p.display_name,
                    "season_points": season_scores_by_pid.get(p.id, 0),
                }
            )

        recent_xp = (
            XpLedgerEntry.query.filter_by(couple_id=cpl.id)
            .order_by(XpLedgerEntry.created_at.desc())
            .limit(20)
            .all()
        )
        recent_xp_payload = [
            {
                "amount": int(e.amount or 0),
                "reason": e.reason or "",
                "reason_pt": _xp_reason(e.reason),
                "created_at": e.created_at.isoformat() if e.created_at else None,
                "ref": e.ref,
            }
            for e in recent_xp
        ]

        unlocked = (
            AchievementProgress.query.filter_by(couple_id=cpl.id)
            .filter(AchievementProgress.unlocked_at.isnot(None))
            .order_by(AchievementProgress.unlocked_at.desc())
            .limit(20)
            .all()
        )
        unlocks_payload = [
            {
                "achievement_id": a.achievement_id,
                "title": _ach_title(a.achievement_id),
                "icon": _ach_icon(a.achievement_id),
                "rarity": "common",
                "unlocked_at": a.unlocked_at.isoformat() if a.unlocked_at else None,
            }
            for a in unlocked
        ]

        season_payload: dict[str, Any] | None = None
        if season:
            theme = get_theme(season.theme_key) or {}
            now = datetime.utcnow()
            total_sec = max(1, int((season.ends_at - season.starts_at).total_seconds()))
            elapsed = max(0, int((now - season.starts_at).total_seconds()))
            season_payload = {
                "label": season.label,
                "theme_key": season.theme_key,
                "title": theme.get("title") or season.title,
                "emoji": theme.get("emoji") or season.trophy_icon,
                "starts_at": season.starts_at.isoformat(),
                "ends_at": season.ends_at.isoformat(),
                "progress_pct": round(min(100.0, 100.0 * elapsed / total_sec), 1),
            }

        return jsonify(
            {
                "enabled": True,
                "couple_label": cpl.label,
                "total_xp": total,
                "level": lv,
                "level_title": title,
                "level_into": into,
                "level_need": need,
                "profiles": profiles_payload,
                "recent_xp": recent_xp_payload,
                "recent_unlocks": unlocks_payload,
                "season": season_payload,
            }
        )

    @app.get("/api/achievements/list")
    def achievements_list_api():
        from gamification.engine import load_achievements_catalog
        from gamification.feature_flags import gamification_v2_enabled

        if not gamification_v2_enabled():
            return jsonify({"enabled": False, "items": []})

        cpl = Couple.query.order_by(Couple.id).first()
        progress_by_id: dict[str, AchievementProgress] = {}
        if cpl:
            for row in AchievementProgress.query.filter_by(couple_id=cpl.id).all():
                progress_by_id[row.achievement_id] = row

        items: list[dict[str, Any]] = []
        for ach in load_achievements_catalog():
            aid = ach.get("id")
            if not aid:
                continue
            rule = ach.get("rule") or {}
            target = int(rule.get("target") or 1)
            rarity = (ach.get("rarity") or "common").lower()
            group = "sazonal" if rarity == "seasonal" else "geral"
            row = progress_by_id.get(aid)
            progress = int(row.progress) if row and row.progress is not None else 0
            unlocked = bool(row and row.unlocked_at)
            items.append(
                {
                    "id": aid,
                    "title": ach.get("title") or aid,
                    "description": ach.get("description") or "",
                    "icon": ach.get("icon") or "🏅",
                    "rarity": rarity,
                    "group": group,
                    "xp_reward": int(ach.get("xp_reward") or 0),
                    "progress": progress,
                    "target": target,
                    "unlocked": unlocked,
                    "rule_type": rule.get("type"),
                }
            )

        return jsonify({"enabled": True, "items": items})

    @app.get("/conquistas")
    def conquistas_page():
        from gamification.feature_flags import gamification_v2_enabled

        if not gamification_v2_enabled():
            return render_template(
                "conquistas_disabled.html",
                data_genre_theme="default",
            )

        # O React consome /api/achievements/list para popular a lista e os
        # estados de progresso/desbloqueio. Essa rota só serve o shell.
        return render_template(
            "conquistas.html",
            data_genre_theme="default",
        )

    @app.get("/perfil/partials/xp-bar")
    def profile_xp_bar_partial():
        _abort_gamification_off()
        from gamification.xp_levels import level_and_progress

        cpl = Couple.query.order_by(Couple.id).first()
        if not cpl:
            return "", 404
        st = CoupleXpState.query.filter_by(couple_id=cpl.id).first()
        total = int(st.total_xp or 0) if st else 0
        lv, into, need, title = level_and_progress(total)
        return render_template(
            "perfil_xp_fragment.html",
            xp_total=total,
            xp_level=lv,
            xp_into=into,
            xp_need=need,
            level_title=title,
        )

    @app.get("/api/gamification/achievements")
    def api_gamification_achievements():
        if not gamification_v2_enabled():
            return jsonify({"error": "desativado"}), 404
        cpl = Couple.query.order_by(Couple.id).first()
        if not cpl:
            return jsonify({"items": []})
        rows = AchievementProgress.query.filter_by(couple_id=cpl.id).all()
        from gamification.engine import load_achievements_catalog

        cat_by_id = {a.get("id"): a for a in load_achievements_catalog() if a.get("id")}
        items = []
        for r in rows:
            meta = cat_by_id.get(r.achievement_id, {})
            items.append(
                {
                    "id": r.achievement_id,
                    "progress": r.progress,
                    "target": r.target,
                    "unlocked_at": r.unlocked_at.isoformat() + "Z"
                    if r.unlocked_at
                    else None,
                    "title": meta.get("title", r.achievement_id),
                    "icon": meta.get("icon", "🏅"),
                }
            )
        return jsonify({"items": items})

    @app.get("/api/gamification/profile-summary")
    def api_profile_summary():
        if not gamification_v2_enabled():
            return jsonify({"error": "desativado"}), 404
        from gamification.xp_levels import level_and_progress

        cpl = Couple.query.order_by(Couple.id).first()
        if not cpl:
            return jsonify({})
        st = CoupleXpState.query.filter_by(couple_id=cpl.id).first()
        total = int(st.total_xp or 0) if st else 0
        lv, into, need, title = level_and_progress(total)
        n_ach = AchievementProgress.query.filter(
            AchievementProgress.couple_id == cpl.id,
            AchievementProgress.unlocked_at.isnot(None),
        ).count()
        return jsonify(
            {
                "total_xp": total,
                "level": lv,
                "xp_into_level": into,
                "xp_for_next": need,
                "level_title": title,
                "achievements_unlocked": n_ach,
            }
        )

    @app.post("/api/gamification/bets")
    def api_bets_create():
        if not bets_enabled():
            return jsonify({"error": "desativado"}), 404
        cid = _couple_id()
        body = request.get_json(silent=True) or {}
        try:
            tid = int(body.get("tmdb_id"))
        except (TypeError, ValueError):
            return jsonify({"error": "tmdb_id inválido"}), 400
        mt = (body.get("media_type") or "movie").strip()
        if mt not in ("movie", "tv"):
            return jsonify({"error": "media_type inválido"}), 400
        prof_slug = (body.get("profile") or "a").strip().lower()
        prof = Profile.query.filter_by(couple_id=cid, slug=prof_slug).first()
        if not prof:
            return jsonify({"error": "perfil inválido"}), 400
        try:
            pred = float(body.get("predicted_rating"))
        except (TypeError, ValueError):
            return jsonify({"error": "predicted_rating inválido"}), 400
        if pred < 0.5 or pred > 10 or abs(pred * 2 - round(pred * 2)) > 1e-6:
            return jsonify({"error": "nota entre 0,5 e 10 (passos de 0,5)"}), 400
        title = (body.get("title") or "").strip() or "Sem título"
        existing_open = (
            WatchBet.query.filter_by(
                couple_id=cid,
                profile_id=prof.id,
                tmdb_id=tid,
                media_type=mt,
                status="open",
            )
            .order_by(WatchBet.created_at.desc())
            .first()
        )
        if existing_open:
            existing_open.predicted_rating = pred
            existing_open.title = title
            existing_open.created_at = datetime.utcnow()
            b = existing_open
        else:
            b = WatchBet(
                couple_id=cid,
                profile_id=prof.id,
                tmdb_id=tid,
                media_type=mt,
                title=title,
                predicted_rating=pred,
                status="open",
            )
            db.session.add(b)
        db.session.commit()
        return jsonify({"id": b.id})

    @app.get("/api/gamification/bets")
    def api_bets_list():
        if not bets_enabled():
            return jsonify({"error": "desativado"}), 404
        cid = _couple_id()
        rows = (
            WatchBet.query.filter_by(couple_id=cid)
            .order_by(WatchBet.created_at.desc())
            .limit(50)
            .all()
        )
        out = []
        for b in rows:
            out.append(
                {
                    "id": b.id,
                    "tmdb_id": b.tmdb_id,
                    "media_type": b.media_type,
                    "title": b.title,
                    "predicted_rating": b.predicted_rating,
                    "status": b.status,
                    "won": b.won,
                    "error_abs": b.error_abs,
                }
            )
        return jsonify({"items": out})

    def _bets_abort_if_disabled():
        if not gamification_v2_enabled():
            abort(404)
        if not bets_enabled():
            abort(404)

    def _build_bets_overview_payload():
        from collections import defaultdict

        cid = _couple_id()
        rows = (
            WatchBet.query.filter_by(couple_id=cid)
            .order_by(WatchBet.created_at.desc())
            .limit(200)
            .all()
        )
        profiles = {p.id: p for p in Profile.query.filter_by(couple_id=cid).all()}
        victories_by_slug = {"a": 0, "b": 0}
        by_key: dict[tuple[int, str], list] = defaultdict(list)
        for b in rows:
            by_key[(b.tmdb_id, b.media_type)].append(b)
        cards = []
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        for (tid, mt), lst in by_key.items():
            by_prof: dict[int, WatchBet] = {}
            for b in sorted(lst, key=lambda x: x.created_at or datetime.min, reverse=True):
                if b.profile_id not in by_prof:
                    by_prof[b.profile_id] = b
            uniq = list(by_prof.values())
            poster_path = None
            title = (uniq[0].title if uniq else "") or "Sem título"
            if token:
                url = f"{TMDB_BASE}/{mt}/{tid}"
                data = _tmdb_json_cached(
                    url,
                    {"language": TMDB_LANG},
                    ttl=3600,
                    timeout=14.0,
                    op=f"bets_card_{mt}_{tid}",
                )
                if isinstance(data, dict):
                    poster_path = data.get("poster_path")
                    t = (data.get("title") if mt == "movie" else data.get("name")) or ""
                    if t.strip():
                        title = t.strip()
            opens = [x for x in uniq if (x.status or "") == "open"]
            resolved = [x for x in uniq if (x.status or "") == "resolved"]
            watched = WatchedItem.query.filter_by(tmdb_id=tid, media_type=mt).first()
            joint = (
                float(watched.rating)
                if watched and watched.rating is not None
                else None
            )
            if joint is None:
                for x in uniq:
                    if x.actual_rating is not None:
                        joint = float(x.actual_rating)
                        break
            status_line = "Esperando resolução"
            if not opens and resolved:
                winner_pids = set()
                if joint is not None:
                    errs = {
                        int(x.profile_id): abs(float(x.predicted_rating) - float(joint))
                        for x in resolved
                    }
                    if errs:
                        best = min(errs.values())
                        winner_pids = {
                            pid
                            for pid, err in errs.items()
                            if abs(err - best) < 1e-6
                        }
                if len(winner_pids) == 1:
                    wpid = next(iter(winner_pids))
                    pr = profiles.get(wpid)
                    nm = pr.display_name if pr else "?"
                    status_line = f"{nm} venceu!"
                    wslug = (pr.slug if pr else "").lower()
                    if wslug in victories_by_slug:
                        victories_by_slug[wslug] += 1
                elif len(winner_pids) > 1:
                    status_line = "Empate entre os palpites!"
                else:
                    status_line = "Resolvida"
            cards.append(
                {
                    "tmdb_id": tid,
                    "media_type": mt,
                    "title": title,
                    "poster_path": poster_path,
                    "status_line": status_line,
                    "has_open": bool(opens),
                }
            )
        cards.sort(key=lambda c: (0 if c["has_open"] else 1, c["title"].lower()))
        prof_a = next((p for p in profiles.values() if (p.slug or "").lower() == "a"), None)
        prof_b = next((p for p in profiles.values() if (p.slug or "").lower() == "b"), None)
        return {
            "cards": cards,
            "victories": victories_by_slug,
            "profile_a": {
                "label": prof_a.display_name if prof_a else "Princesinha",
                "slug": "a",
            },
            "profile_b": {
                "label": prof_b.display_name if prof_b else "Gabe",
                "slug": "b",
            },
        }

    @app.get("/api/bets/overview")
    def api_bets_overview():
        _bets_abort_if_disabled()
        return jsonify(_build_bets_overview_payload())

    @app.get("/apostas")
    def bets_list_page():
        _bets_abort_if_disabled()
        from collections import defaultdict  # noqa: F401 — mantido para compatibilidade

        cid = _couple_id()
        rows = (
            WatchBet.query.filter_by(couple_id=cid)
            .order_by(WatchBet.created_at.desc())
            .limit(200)
            .all()
        )
        profiles = {p.id: p for p in Profile.query.filter_by(couple_id=cid).all()}
        victories_by_slug = {"a": 0, "b": 0}
        by_key: dict[tuple[int, str], list] = defaultdict(list)
        for b in rows:
            by_key[(b.tmdb_id, b.media_type)].append(b)

        cards = []
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        for (tid, mt), lst in by_key.items():
            by_prof: dict[int, WatchBet] = {}
            for b in sorted(lst, key=lambda x: x.created_at or datetime.min, reverse=True):
                if b.profile_id not in by_prof:
                    by_prof[b.profile_id] = b
            uniq = list(by_prof.values())
            poster_path = None
            title = (uniq[0].title if uniq else "") or "Sem título"
            if token:
                url = f"{TMDB_BASE}/{mt}/{tid}"
                data = _tmdb_json_cached(
                    url,
                    {"language": TMDB_LANG},
                    ttl=3600,
                    timeout=14.0,
                    op=f"bets_card_{mt}_{tid}",
                )
                if isinstance(data, dict):
                    poster_path = data.get("poster_path")
                    t = (data.get("title") if mt == "movie" else data.get("name")) or ""
                    if t.strip():
                        title = t.strip()
            opens = [x for x in uniq if (x.status or "") == "open"]
            resolved = [x for x in uniq if (x.status or "") == "resolved"]
            watched = WatchedItem.query.filter_by(tmdb_id=tid, media_type=mt).first()
            joint = (
                float(watched.rating)
                if watched and watched.rating is not None
                else None
            )
            if joint is None:
                for x in uniq:
                    if x.actual_rating is not None:
                        joint = float(x.actual_rating)
                        break

            status_line = "Esperando resolução"
            if not opens and resolved:
                winner_pids = set()
                if joint is not None:
                    errs = {
                        int(x.profile_id): abs(float(x.predicted_rating) - float(joint))
                        for x in resolved
                    }
                    if errs:
                        best = min(errs.values())
                        winner_pids = {
                            pid
                            for pid, err in errs.items()
                            if abs(err - best) < 1e-6
                        }
                if len(winner_pids) == 1:
                    wpid = next(iter(winner_pids))
                    pr = profiles.get(wpid)
                    nm = pr.display_name if pr else "?"
                    status_line = f"{nm} venceu!"
                    wslug = (pr.slug if pr else "").lower()
                    if wslug in victories_by_slug:
                        victories_by_slug[wslug] += 1
                elif len(winner_pids) > 1:
                    status_line = "Empate entre os palpites!"
                else:
                    status_line = "Resolvida"
            cards.append(
                {
                    "tmdb_id": tid,
                    "media_type": mt,
                    "title": title,
                    "poster_path": poster_path,
                    "status_line": status_line,
                    "has_open": bool(opens),
                }
            )
        cards.sort(key=lambda c: (0 if c["has_open"] else 1, c["title"].lower()))
        return render_template(
            "apostas.html",
            bet_cards=cards,
            victories_by_slug=victories_by_slug,
            data_genre_theme="default",
        )

    def _build_bets_detail_payload(media_type: str, tmdb_id: int):
        cid = _couple_id()
        rows = (
            WatchBet.query.filter_by(
                couple_id=cid, tmdb_id=tmdb_id, media_type=media_type
            )
            .order_by(WatchBet.created_at.desc())
            .all()
        )
        if not rows:
            return None
        profiles = {
            p.id: p
            for p in Profile.query.filter_by(couple_id=cid).all()
        }
        by_prof: dict[int, WatchBet] = {}
        for b in rows:
            if b.profile_id not in by_prof:
                by_prof[b.profile_id] = b
        uniq = list(by_prof.values())
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        hero = {
            "title": rows[0].title,
            "poster_path": None,
            "backdrop_path": None,
            "overview": "",
            "media_type": media_type,
            "tmdb_id": tmdb_id,
        }
        if token:
            url = f"{TMDB_BASE}/{media_type}/{tmdb_id}"
            data = _tmdb_json_cached(
                url,
                {"language": TMDB_LANG},
                ttl=3600,
                timeout=14.0,
                op=f"bets_detail_{media_type}_{tmdb_id}",
            )
            if isinstance(data, dict):
                hero["poster_path"] = data.get("poster_path")
                hero["backdrop_path"] = data.get("backdrop_path")
                hero["overview"] = (data.get("overview") or "")[:600]
                nm = (data.get("title") if media_type == "movie" else data.get("name"))
                if nm:
                    hero["title"] = str(nm).strip()
        watched = WatchedItem.query.filter_by(
            tmdb_id=tmdb_id, media_type=media_type
        ).first()
        joint = float(watched.rating) if watched and watched.rating is not None else None
        if joint is None and uniq:
            for b in uniq:
                if b.actual_rating is not None:
                    joint = float(b.actual_rating)
                    break
        resolved = [x for x in uniq if (x.status or "") == "resolved"]
        winner_pids: set[int] = set()
        winner_diff = None
        winner_name = None
        winner_draw = False
        if resolved:
            errs: dict[int, float] = {}
            if joint is not None:
                errs = {
                    int(x.profile_id): abs(float(x.predicted_rating) - float(joint))
                    for x in resolved
                }
            if errs:
                best = min(errs.values())
                winner_diff = best
                winner_pids = {
                    pid for pid, err in errs.items() if abs(err - best) < 1e-6
                }
                if len(winner_pids) == 1:
                    wpid = next(iter(winner_pids))
                    pr = profiles.get(wpid)
                    winner_name = pr.display_name if pr else "?"
                elif len(winner_pids) > 1:
                    winner_draw = True

        bet_view_rows = []
        for b in sorted(
            uniq,
            key=lambda x: (
                ((profiles.get(x.profile_id).slug if profiles.get(x.profile_id) else "z")),
                -(int(x.id or 0)),
            ),
        ):
            pr = profiles.get(b.profile_id)
            slug = (pr.slug if pr else "a").lower()
            diff = None
            if (b.status or "") == "resolved" and joint is not None:
                diff = abs(float(b.predicted_rating) - float(joint))
            outcome = "open"
            if (b.status or "") == "resolved":
                if winner_pids:
                    if len(winner_pids) > 1 and int(b.profile_id) in winner_pids:
                        outcome = "draw"
                    elif int(b.profile_id) in winner_pids:
                        outcome = "win"
                    else:
                        outcome = "loss"
                elif b.won is True:
                    outcome = "win"
                elif b.won is False:
                    outcome = "loss"
                else:
                    outcome = "draw"
            bet_view_rows.append(
                {
                    "profile_name": pr.display_name if pr else "Perfil",
                    "profile_slug": slug if slug in ("a", "b") else "a",
                    "predicted_rating": float(b.predicted_rating),
                    "status": b.status or "open",
                    "actual_rating": b.actual_rating,
                    "diff": diff,
                    "exact_hit": (diff is not None and diff < 1e-6),
                    "outcome": outcome,
                }
            )
        return {
            "hero": hero,
            "joint_rating": joint,
            "winner_name": winner_name,
            "winner_diff": winner_diff,
            "winner_draw": winner_draw,
            "bet_view_rows": bet_view_rows,
        }

    @app.get("/api/bets/detail/<media_type>/<int:tmdb_id>")
    def api_bets_detail(media_type: str, tmdb_id: int):
        _bets_abort_if_disabled()
        if media_type not in ("movie", "tv"):
            return jsonify({"error": "media_type inválido"}), 400
        payload = _build_bets_detail_payload(media_type, tmdb_id)
        if payload is None:
            return jsonify({"error": "nenhuma aposta"}), 404
        return jsonify(payload)

    @app.get("/apostas/<media_type>/<int:tmdb_id>")
    def bets_detail_page(media_type: str, tmdb_id: int):
        _bets_abort_if_disabled()
        if media_type not in ("movie", "tv"):
            abort(404)
        cid = _couple_id()
        rows = (
            WatchBet.query.filter_by(
                couple_id=cid, tmdb_id=tmdb_id, media_type=media_type
            )
            .order_by(WatchBet.created_at.desc())
            .all()
        )
        if not rows:
            abort(404)
        profiles = {
            p.id: p
            for p in Profile.query.filter_by(couple_id=cid).all()
        }
        by_prof: dict[int, WatchBet] = {}
        for b in rows:
            if b.profile_id not in by_prof:
                by_prof[b.profile_id] = b
        uniq = list(by_prof.values())
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        hero = {
            "title": rows[0].title,
            "poster_path": None,
            "backdrop_path": None,
            "overview": "",
            "media_type": media_type,
            "tmdb_id": tmdb_id,
        }
        if token:
            url = f"{TMDB_BASE}/{media_type}/{tmdb_id}"
            data = _tmdb_json_cached(
                url,
                {"language": TMDB_LANG},
                ttl=3600,
                timeout=14.0,
                op=f"bets_detail_{media_type}_{tmdb_id}",
            )
            if isinstance(data, dict):
                hero["poster_path"] = data.get("poster_path")
                hero["backdrop_path"] = data.get("backdrop_path")
                hero["overview"] = (data.get("overview") or "")[:600]
                nm = (data.get("title") if media_type == "movie" else data.get("name"))
                if nm:
                    hero["title"] = str(nm).strip()
        watched = WatchedItem.query.filter_by(
            tmdb_id=tmdb_id, media_type=media_type
        ).first()
        joint = float(watched.rating) if watched and watched.rating is not None else None
        if joint is None and uniq:
            for b in uniq:
                if b.actual_rating is not None:
                    joint = float(b.actual_rating)
                    break
        pred_by_slug = {"a": None, "b": None}
        for b in uniq:
            pr = profiles.get(b.profile_id)
            slug = (pr.slug if pr else "a").lower()
            if slug in pred_by_slug:
                pred_by_slug[slug] = float(b.predicted_rating)
        winner_name = None
        winner_diff = None
        winner_draw = False
        resolved = [x for x in uniq if (x.status or "") == "resolved"]
        winner_pids = set()
        if resolved:
            errs = {}
            if joint is not None:
                errs = {
                    int(x.profile_id): abs(float(x.predicted_rating) - float(joint))
                    for x in resolved
                }
            if errs:
                best = min(errs.values())
                winner_diff = best
                winner_pids = {
                    pid for pid, err in errs.items() if abs(err - best) < 1e-6
                }
                if len(winner_pids) == 1:
                    wpid = next(iter(winner_pids))
                    pr = profiles.get(wpid)
                    winner_name = pr.display_name if pr else "?"
                elif len(winner_pids) > 1:
                    winner_draw = True

        bet_view_rows = []
        for b in sorted(
            uniq,
            key=lambda x: (
                ((profiles.get(x.profile_id).slug if profiles.get(x.profile_id) else "z")),
                -(int(x.id or 0)),
            ),
        ):
            pr = profiles.get(b.profile_id)
            slug = (pr.slug if pr else "a").lower()
            diff = None
            if (b.status or "") == "resolved" and joint is not None:
                diff = abs(float(b.predicted_rating) - float(joint))
            outcome = "open"
            if (b.status or "") == "resolved":
                if winner_pids:
                    if len(winner_pids) > 1 and int(b.profile_id) in winner_pids:
                        outcome = "draw"
                    elif int(b.profile_id) in winner_pids:
                        outcome = "win"
                    else:
                        outcome = "loss"
                elif b.won is True:
                    outcome = "win"
                elif b.won is False:
                    outcome = "loss"
                else:
                    outcome = "draw"
            bet_view_rows.append(
                {
                    "profile_name": pr.display_name if pr else "Perfil",
                    "profile_slug": slug if slug in ("a", "b") else "a",
                    "predicted_rating": float(b.predicted_rating),
                    "status": b.status or "open",
                    "actual_rating": b.actual_rating,
                    "diff": diff,
                    "exact_hit": (diff is not None and diff < 1e-6),
                    "outcome": outcome,
                }
            )
        return render_template(
            "apostas_detalhe.html",
            hero=hero,
            bets=uniq,
            bet_view_rows=bet_view_rows,
            joint_rating=joint,
            pred_by_slug=pred_by_slug,
            winner_name=winner_name,
            winner_diff=winner_diff,
            winner_draw=winner_draw,
            profiles=profiles,
            data_genre_theme="default",
        )

    def _tmdb_compare_payload(mt: str, tid: int):
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if not token:
            return None
        url = f"{TMDB_BASE}/{mt}/{tid}"
        headers = _tmdb_headers(token)
        params = {"language": TMDB_LANG, "append_to_response": "credits"}
        try:
            r = requests.get(url, params=params, headers=headers, timeout=18)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()
        except requests.RequestException:
            return None

    def _compare_card_from_tmdb(j: dict, mt: str, tid: int) -> dict:
        """Monta cartão comparável a partir do JSON TMDB (já com credits)."""
        title = (j.get("title") if mt == "movie" else j.get("name")) or ""
        rd = j.get("release_date") if mt == "movie" else j.get("first_air_date")
        year = (rd or "")[:4] if rd else ""
        genres = ", ".join(
            g.get("name") for g in (j.get("genres") or []) if g.get("name")
        )
        directors = []
        for c in (j.get("credits") or {}).get("crew") or []:
            job = (c.get("job") or "").strip().lower()
            if job in ("director", "diretor", "co-director", "codirector"):
                nm = (c.get("name") or "").strip()
                if nm:
                    directors.append(nm)
        directors_label = ", ".join(directors[:4])
        countries = ", ".join(
            (c.get("name") or "").strip()
            for c in (j.get("production_countries") or [])
            if c.get("name")
        )
        runtime_label = None
        if mt == "movie":
            rt = j.get("runtime")
            if rt:
                runtime_label = f"{int(rt)} min"
        else:
            ns = j.get("number_of_seasons")
            if ns is not None:
                try:
                    nsi = int(ns)
                    runtime_label = f"{nsi} temporada(s)" if nsi else None
                except (TypeError, ValueError):
                    runtime_label = None
        overview = (j.get("overview") or "").strip()
        if len(overview) > 520:
            overview = overview[:520].rstrip() + "…"
        return {
            "tmdb_id": tid,
            "media_type": mt,
            "title": title,
            "overview": overview,
            "poster_path": j.get("poster_path"),
            "year": year,
            "release_date": rd or "",
            "vote": j.get("vote_average"),
            "genres_label": genres,
            "directors_label": directors_label,
            "countries_label": countries,
            "runtime_label": runtime_label,
        }

    def _parse_compare_pick(prefix: str):
        mt = (request.args.get(f"{prefix}_mt") or "movie").strip().lower()
        if mt not in ("movie", "tv"):
            mt = "movie"
        try:
            tid = int(request.args.get(prefix) or 0)
        except (TypeError, ValueError):
            tid = 0
        if tid < 0:
            tid = 0
        return mt, tid

    def _cast_map(raw):
        cr = raw.get("credits") or {}
        cst = cr.get("cast") or []
        mp = {}
        for c in cst[:80]:
            i = c.get("id")
            nm = (c.get("name") or "").strip()
            if i and nm:
                mp[int(i)] = nm
        return mp

    @app.get("/api/comparar")
    def compare_api():
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if not token:
            return jsonify({"error": "TMDB_READ_ACCESS_TOKEN não configurado"}), 500
        a_mt, a_id = _parse_compare_pick("a")
        b_mt, b_id = _parse_compare_pick("b")
        if not a_id and not b_id:
            return jsonify({"left": None, "right": None, "common": []})
        left = right = None
        common = []
        ja = jb = None
        if a_id:
            ja = _tmdb_compare_payload(a_mt, a_id)
            if not ja:
                return (
                    jsonify(
                        {
                            "error": "Não foi possível carregar o título da coluna esquerda no TMDB."
                        }
                    ),
                    502,
                )
            left = _compare_card_from_tmdb(ja, a_mt, a_id)
        if b_id:
            jb = _tmdb_compare_payload(b_mt, b_id)
            if not jb:
                return (
                    jsonify(
                        {
                            "error": "Não foi possível carregar o título da coluna direita no TMDB."
                        }
                    ),
                    502,
                )
            right = _compare_card_from_tmdb(jb, b_mt, b_id)
        if ja and jb:
            ca = _cast_map(ja)
            cb = _cast_map(jb)
            shared_ids = sorted(set(ca) & set(cb), key=lambda i: ca[i].lower())[:24]
            common = [{"id": i, "name": ca[i]} for i in shared_ids]
        return jsonify({"left": left, "right": right, "common": common})

    @app.get("/comparar")
    def compare_page():
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if not token:
            return (
                "Configure a variável de ambiente TMDB_READ_ACCESS_TOKEN.",
                500,
            )
        a_mt, a_id = _parse_compare_pick("a")
        b_mt, b_id = _parse_compare_pick("b")
        return render_template(
            "comparar.html",
            a_mt=a_mt,
            b_mt=b_mt,
            a_id=a_id,
            b_id=b_id,
            data_genre_theme="default",
        )

    def _build_map_countries_payload():
        from collections import defaultdict

        from gamification.snapshot import snapshot_from_json
        from services.world_map_match import enrich_countries_for_map

        counts: dict[str, int] = defaultdict(int)
        titles_by_iso: dict[str, list[dict]] = defaultdict(list)
        for row in WatchedItem.query.all():
            snap = snapshot_from_json(getattr(row, "tmdb_snapshot_json", None))
            if not snap:
                continue
            for c in snap.get("production_countries") or []:
                iso = (c.get("iso") or "").upper()
                if iso:
                    counts[iso] += 1
                    if len(titles_by_iso[iso]) < 6:
                        titles_by_iso[iso].append(
                            {
                                "tmdb_id": row.tmdb_id,
                                "media_type": row.media_type,
                                "title": row.title,
                                "poster_path": row.poster_path,
                            }
                        )
        items = sorted(
            ({"iso": k, "count": v} for k, v in counts.items()),
            key=lambda x: (-x["count"], x["iso"]),
        )
        enriched = enrich_countries_for_map(list(items))
        for c in enriched:
            c["titles"] = titles_by_iso.get((c.get("iso") or "").upper(), [])
        return enriched

    @app.get("/api/map/countries")
    def api_map_countries():
        resp = jsonify({"countries": _build_map_countries_payload()})
        resp.headers["Cache-Control"] = "private, max-age=60"
        return resp

    @app.get("/mapa")
    def mapa_paises_page():
        countries = _build_map_countries_payload()
        return render_template(
            "mapa.html",
            countries=countries,
            data_genre_theme="default",
        )

    @app.get("/api/trivia/<media_type>/<int:tmdb_id>")
    def api_trivia(media_type: str, tmdb_id: int):
        if media_type not in ("movie", "tv"):
            return jsonify({"error": "Tipo inválido"}), 400
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if not token:
            return jsonify({"error": "TMDB não configurado"}), 500
        ck = f"trivia:v2:{media_type}:{tmdb_id}"
        now_naive = datetime.utcnow()
        cached = TriviaCache.query.filter_by(cache_key=ck).first()
        if cached and cached.expires_at > now_naive:
            try:
                return jsonify(json.loads(cached.payload_json))
            except json.JSONDecodeError:
                pass
        url = f"{TMDB_BASE}/{media_type}/{tmdb_id}"
        params = {"language": TMDB_LANG, "append_to_response": "external_ids"}
        data = _tmdb_json_cached(
            url,
            params,
            ttl=86400,
            timeout=18.0,
            op="trivia_details",
        )
        if not isinstance(data, dict):
            return jsonify({"items": [], "sources": []}), 200
        title = (data.get("title") if media_type == "movie" else data.get("name")) or ""
        original = (
            (data.get("original_title") if media_type == "movie" else data.get("original_name"))
            or ""
        ).strip()
        ext = data.get("external_ids") or {}
        imdb = ext.get("imdb_id")
        wiki = None
        for cand in (title, original):
            if not cand or not str(cand).strip():
                continue
            wiki = fetch_wikipedia_summary(str(cand).strip())
            if wiki and (wiki.get("summary") or "").strip():
                break
        items = []
        if wiki and (wiki.get("summary") or "").strip():
            items.append(
                {
                    "kind": "curiosity",
                    "title": "Você sabia?",
                    "body": wiki.get("summary") or "",
                    "source_label": "Wikipédia",
                    "source_url": wiki.get("url"),
                }
            )
        if imdb and str(imdb).strip().startswith("tt"):
            items.append(
                {
                    "kind": "reference",
                    "title": "IMDb",
                    "body": f"Identificador IMDb: {imdb}",
                    "source_label": "IMDb",
                    "source_url": f"https://www.imdb.com/title/{imdb.strip()}/",
                }
            )
        payload = {"items": items, "sources": ["wikipedia", "tmdb"]}
        exp = now_naive + timedelta(hours=48)
        raw = json.dumps(payload, ensure_ascii=False)
        if cached:
            cached.payload_json = raw
            cached.expires_at = exp
        else:
            db.session.add(
                TriviaCache(
                    cache_key=ck,
                    payload_json=raw,
                    expires_at=exp,
                )
            )
        db.session.commit()
        return jsonify(payload)

    def _swipe_swiped_out_keys(swipe_cid: int) -> set[tuple[int, str]]:
        return {
            (s.tmdb_id, s.media_type)
            for s in SwipeItem.query.filter(
                SwipeItem.couple_id == swipe_cid,
                SwipeItem.state.in_(("matched", "rejected", "no_match")),
            ).all()
        }

    def _swipe_filter_deck_for_profile(deck: list[dict], profile: str) -> list[dict]:
        """Cada perfil vê apenas cartas em que ainda pode agir (curtir/rejeitar 1x por pessoa)."""
        if profile not in ("a", "b"):
            profile = "a"
        out: list[dict] = []
        for c in deck:
            st = str(c.get("state") or "pending").lower()
            if st in ("matched", "rejected", "no_match"):
                continue
            if st == "pending":
                out.append(c)
            elif st == "liked_a":
                if profile == "b":
                    out.append(c)
            elif st == "liked_b":
                if profile == "a":
                    out.append(c)
            elif st == "rejected_a":
                if profile == "b":
                    out.append(c)
            elif st == "rejected_b":
                if profile == "a":
                    out.append(c)
            else:
                out.append(c)
        return out

    def _swipe_attach_card_states(swipe_cid: int, cards: list[dict]) -> list[dict]:
        """Uma query em lote em vez de N SELECTs (deck grande)."""
        if not cards:
            return cards
        keys: list[tuple[int, str]] = []
        seen: set[tuple[int, str]] = set()
        for card in cards:
            try:
                tid = int(card["tmdb_id"])
            except (TypeError, ValueError, KeyError):
                card.setdefault("state", "pending")
                continue
            mt = str(card.get("media_type") or "")
            k = (tid, mt)
            if k in seen:
                continue
            seen.add(k)
            keys.append(k)
        if not keys:
            for card in cards:
                card.setdefault("state", "pending")
            return cards
        conds = [
            and_(
                SwipeItem.couple_id == swipe_cid,
                SwipeItem.tmdb_id == tid,
                SwipeItem.media_type == mt,
            )
            for tid, mt in keys
        ]
        # SQLite pode falhar ou degradar com OR enorme; consultamos em blocos.
        mp: dict[tuple[int, str], str] = {}
        chunk = 28
        for i in range(0, len(conds), chunk):
            sub = conds[i : i + chunk]
            if not sub:
                continue
            rows = SwipeItem.query.filter(or_(*sub)).all()
            for r in rows:
                mp[(int(r.tmdb_id), str(r.media_type))] = r.state
        for card in cards:
            try:
                tid = int(card["tmdb_id"])
            except (TypeError, ValueError, KeyError):
                card.setdefault("state", "pending")
                continue
            mt = str(card.get("media_type") or "")
            st = mp.get((tid, mt))
            if st:
                card["state"] = st
            else:
                card.setdefault("state", "pending")
        return cards

    def _build_swipe_watchlater_deck(swipe_cid: int, excluded: set[tuple[int, str]], limit: int) -> list[dict]:
        out: list[dict] = []
        for wl in WatchLaterItem.query.order_by(WatchLaterItem.added_at.desc()).limit(max(limit * 2, 40)):
            key = (wl.tmdb_id, wl.media_type)
            if key in excluded:
                continue
            out.append(
                {
                    "tmdb_id": wl.tmdb_id,
                    "media_type": wl.media_type,
                    "title": wl.title,
                    "poster_path": wl.poster_path,
                    "state": "pending",
                }
            )
            if len(out) >= limit:
                break
        return out

    def _build_swipe_custom_list_deck(
        swipe_cid: int, list_id: int, excluded: set[tuple[int, str]], limit: int
    ) -> list[dict]:
        row = MediaList.query.filter_by(id=list_id, couple_id=swipe_cid).first()
        if not row:
            return []
        out: list[dict] = []
        for li in (
            MediaListItem.query.filter_by(list_id=list_id)
            .order_by(MediaListItem.added_at.asc(), MediaListItem.id.asc())
            .limit(max(limit * 2, 40))
        ):
            key = (li.tmdb_id, li.media_type)
            if key in excluded:
                continue
            out.append(
                {
                    "tmdb_id": li.tmdb_id,
                    "media_type": li.media_type,
                    "title": li.title,
                    "poster_path": li.poster_path,
                    "state": "pending",
                }
            )
            if len(out) >= limit:
                break
        return out

    def _build_swipe_genre_deck_round_robin(
        media: str,
        parsed_ids: list[int],
        excluded: set[tuple[int, str]],
        limit: int,
    ) -> list[dict]:
        if not parsed_ids:
            return []
        n = len(parsed_ids)
        quotas = [limit // n] * n
        for r in range(limit % n):
            quotas[r] += 1

        def _one_genre_bucket(gid_quota: tuple[int, int]) -> list[dict]:
            gid, quota = gid_quota
            bucket: list[dict] = []
            seen_local: set[tuple[int, str]] = set()
            if quota <= 0:
                return bucket
            for min_votes in (40, 1):
                if len(bucket) >= quota:
                    break
                for page in range(1, 9):
                    if len(bucket) >= quota:
                        break
                    j = _tmdb_json_cached(
                        f"{TMDB_BASE}/discover/{media}",
                        {
                            "language": TMDB_LANG,
                            "with_genres": str(gid),
                            "sort_by": "popularity.desc",
                            "page": page,
                            "vote_count.gte": min_votes,
                        },
                        ttl=180,
                        timeout=12.0,
                        op=f"swipe_discover_{media}_{gid}_p{page}_v{min_votes}",
                    )
                    if not isinstance(j, dict):
                        continue
                    for it in (j.get("results") or [])[:25]:
                        tid = it.get("id")
                        if not tid:
                            continue
                        key = (int(tid), media)
                        if key in excluded or key in seen_local:
                            continue
                        seen_local.add(key)
                        tit = (
                            it.get("title") if media == "movie" else it.get("name")
                        ) or ""
                        bucket.append(
                            {
                                "tmdb_id": int(tid),
                                "media_type": media,
                                "title": tit,
                                "poster_path": it.get("poster_path"),
                                "state": "pending",
                            }
                        )
                        if len(bucket) >= quota:
                            break
            return bucket

        workers = min(6, max(1, n))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            buckets = list(pool.map(_one_genre_bucket, zip(parsed_ids, quotas)))
        deck: list[dict] = []
        seen: set[tuple[int, str]] = set()
        max_len = max((len(b) for b in buckets), default=0)
        for r in range(max_len):
            for b in buckets:
                if r < len(b):
                    c = b[r]
                    k = (c["tmdb_id"], c["media_type"])
                    if k in seen:
                        continue
                    seen.add(k)
                    deck.append(c)
                if len(deck) >= limit:
                    return deck
        return deck[:limit]

    def _swipe_profile_can_act_on_state(st: str, profile: str) -> bool:
        """Alinhado a _swipe_filter_deck_for_profile: este perfil ainda pode curtir/recusar nesta carta?"""
        s = (st or "pending").lower()
        if profile not in ("a", "b"):
            profile = "a"
        if s in ("matched", "rejected", "no_match"):
            return False
        if s == "pending":
            return True
        if s == "liked_a":
            return profile == "b"
        if s == "liked_b":
            return profile == "a"
        if s == "rejected_a":
            return profile == "b"
        if s == "rejected_b":
            return profile == "a"
        return True

    def _sess_cursor_for_profile(sess: SwipeSession, profile: str) -> int:
        if profile == "b":
            try:
                return max(0, int(sess.cursor_index_b))
            except (TypeError, ValueError):
                return max(0, int(getattr(sess, "cursor_index", 0) or 0))
        try:
            return max(0, int(sess.cursor_index_a))
        except (TypeError, ValueError):
            return max(0, int(getattr(sess, "cursor_index", 0) or 0))

    def _sess_set_cursor_for_profile(sess: SwipeSession, profile: str, i: int) -> None:
        i = max(0, int(i))
        if profile == "b":
            sess.cursor_index_b = i
        else:
            sess.cursor_index_a = i
        # Mantém coluna legada coerente com o “mais atrás” no deck (depuração / ferramentas).
        try:
            ca = int(sess.cursor_index_a)
            cb = int(sess.cursor_index_b)
            sess.cursor_index = min(ca, cb)
        except (TypeError, ValueError):
            sess.cursor_index = i

    def _sync_swipe_session_cursor_one(
        sess: SwipeSession, swipe_cid: int, profile: str
    ) -> None:
        if profile not in ("a", "b"):
            profile = "a"
        if not sess.deck_json:
            return
        try:
            deck_full = json.loads(sess.deck_json)
        except (TypeError, json.JSONDecodeError):
            return
        if not isinstance(deck_full, list):
            return
        i = _sess_cursor_for_profile(sess, profile)
        i = max(0, min(i, len(deck_full)))
        while i < len(deck_full):
            c = deck_full[i]
            try:
                tid = int(c.get("tmdb_id", 0))
            except (TypeError, ValueError):
                i += 1
                continue
            mt = str(c.get("media_type") or "")
            row = SwipeItem.query.filter_by(
                couple_id=swipe_cid, tmdb_id=tid, media_type=mt
            ).first()
            st = (row.state if row else "pending") or "pending"
            if st in ("matched", "rejected", "no_match"):
                i += 1
                continue
            if not _swipe_profile_can_act_on_state(st, profile):
                i += 1
                continue
            break
        _sess_set_cursor_for_profile(sess, profile, i)
        sess.updated_at = datetime.utcnow()

    def _sync_swipe_session_cursor(swipe_cid: int) -> None:
        sess = SwipeSession.query.filter_by(couple_id=swipe_cid, active=True).first()
        if not sess:
            return
        _sync_swipe_session_cursor_one(sess, swipe_cid, "a")
        _sync_swipe_session_cursor_one(sess, swipe_cid, "b")

    def _swipe_session_json(
        swipe_cid: int, sess: SwipeSession, viewer_profile: str | None = None
    ) -> dict:
        try:
            deck_full = json.loads(sess.deck_json or "[]")
        except (TypeError, json.JSONDecodeError):
            deck_full = []
        if not isinstance(deck_full, list):
            deck_full = []
        prof = (viewer_profile or "").strip().lower()
        if prof not in ("a", "b"):
            prof = "a"
        cur = max(0, min(_sess_cursor_for_profile(sess, prof), len(deck_full)))
        visible = [dict(x) for x in deck_full[cur:]]
        _swipe_attach_card_states(swipe_cid, visible)
        gids: list[int] = []
        if sess.genre_ids_csv:
            for p in sess.genre_ids_csv.split(","):
                p = p.strip()
                if p.isdigit():
                    gids.append(int(p))
        filtered = _swipe_filter_deck_for_profile(visible, prof)
        has_tail = cur < len(deck_full)
        session_waiting = bool(has_tail and not filtered and visible)
        lid = getattr(sess, "list_id", None)
        return {
            "active": True,
            "source": sess.source,
            "media": sess.media,
            "genre_ids": gids,
            "list_id": int(lid) if lid is not None else None,
            "deck": filtered,
            "cursor_index": cur,
            "cursor_index_a": int(getattr(sess, "cursor_index_a", 0) or 0),
            "cursor_index_b": int(getattr(sess, "cursor_index_b", 0) or 0),
            "deck_total": len(deck_full),
            "session_public_id": getattr(sess, "public_id", None) or "",
            "viewer_profile": prof,
            "session_has_tail": has_tail,
            "session_waiting": session_waiting,
        }

    @app.get("/casal")
    def couple_swipe_page():
        return render_template("couple_swipe.html")

    def _active_profile_slug_from_session() -> str | None:
        slug = session.get("profile_slug")
        if isinstance(slug, str):
            s = slug.strip().lower()
            if s in ("a", "b"):
                return s
        return None

    def _swipe_viewer_profile() -> str:
        got = _active_profile_slug_from_session()
        if got:
            return got
        p = (request.args.get("profile") or "").strip().lower()
        if p in ("a", "b"):
            return p
        return "a"

    def _swipe_acting_profile() -> str:
        got = _active_profile_slug_from_session()
        if got:
            return got
        body = request.get_json(silent=True) or {}
        p = (body.get("profile") or "").strip().lower()
        if p in ("a", "b"):
            return p
        return "a"

    @app.get("/api/active-profile")
    def api_active_profile_get():
        """Perfil do swipe/apostas: cookie de sessão (definido em Bem-vindo ou no header)."""
        cid = _couple_id()
        labels: dict[str, str] = {"a": "Princesinha", "b": "Gabe"}
        try:
            for row in Profile.query.filter_by(couple_id=cid).order_by(Profile.slug):
                if row.slug in ("a", "b"):
                    labels[row.slug] = row.display_name or labels.get(row.slug, row.slug)
        except Exception:
            pass
        slug = _active_profile_slug_from_session()
        return jsonify({"slug": slug, "labels": labels})

    @app.post("/api/active-profile")
    def api_active_profile_post():
        body = request.get_json(silent=True) or {}
        slug = (body.get("slug") or body.get("profile") or "").strip().lower()
        if slug not in ("a", "b"):
            return jsonify({"error": "slug deve ser a ou b"}), 400
        session["profile_slug"] = slug
        session.permanent = True
        return jsonify({"ok": True, "slug": slug})

    @app.get("/api/swipe/sessions")
    def api_swipe_sessions_list():
        """Lista sessões ativas do casal (hoje: no máximo uma linha por casal)."""
        cid = _couple_id()
        prof = _swipe_viewer_profile()
        sess = SwipeSession.query.filter_by(couple_id=cid, active=True).first()
        if not sess:
            return jsonify({"items": []})
        payload = _swipe_session_json(cid, sess, prof)
        return jsonify(
            {
                "items": [
                    {
                        "public_id": payload.get("session_public_id") or "",
                        "active": True,
                        "source": sess.source,
                        "media": sess.media,
                        "genre_ids": payload.get("genre_ids") or [],
                        "list_id": payload.get("list_id"),
                        "deck_count": len(payload.get("deck") or []),
                        "session_waiting": payload.get("session_waiting"),
                        "deck_total": payload.get("deck_total"),
                    }
                ]
            }
        )

    @app.get("/api/swipe/session")
    def api_swipe_session_get():
        cid = _couple_id()
        prof = _swipe_viewer_profile()
        sess = SwipeSession.query.filter_by(couple_id=cid, active=True).first()
        if not sess:
            return jsonify({"active": False})
        return jsonify(_swipe_session_json(cid, sess, prof))

    @app.post("/api/swipe/session/end")
    def api_swipe_session_end():
        cid = _couple_id()
        sess = SwipeSession.query.filter_by(couple_id=cid).first()
        if sess:
            sess.active = False
            sess.updated_at = datetime.utcnow()
            db.session.commit()
        return jsonify({"ok": True})

    @app.post("/api/swipe/session")
    def api_swipe_session_start():
        cid = _couple_id()
        try:
            body = request.get_json(silent=True) or {}
            source = (body.get("source") or "watchlater").strip().lower()
            if source not in ("watchlater", "genre", "list"):
                return jsonify({"error": "source inválido"}), 400
            excluded = _swipe_swiped_out_keys(cid)
            genre_ids_csv = ""
            deck_list_id_val: int | None = None
            media = (body.get("media") or "movie").strip()
            if media not in ("movie", "tv"):
                media = "movie"
            if source == "watchlater":
                deck = _build_swipe_watchlater_deck(cid, excluded, 100)
            elif source == "list":
                try:
                    lid = int(body.get("list_id"))
                except (TypeError, ValueError):
                    return jsonify({"error": "list_id inválido"}), 400
                deck = _build_swipe_custom_list_deck(cid, lid, excluded, 100)
                if not deck:
                    return jsonify({"error": "Lista vazia ou não encontrada."}), 400
                deck_list_id_val = lid
                media = "movie"
            else:
                raw_ids = body.get("genre_ids")
                parsed_ids: list[int] = []
                if isinstance(raw_ids, list):
                    for x in raw_ids[:12]:
                        try:
                            parsed_ids.append(int(x))
                        except (TypeError, ValueError):
                            continue
                parsed_ids = list(dict.fromkeys(parsed_ids))
                if not parsed_ids:
                    return jsonify({"error": "Selecione ao menos um gênero"}), 400
                if SOAP_NOVELA_GENRE_ID in parsed_ids:
                    media = "tv"
                genre_ids_csv = ",".join(str(x) for x in parsed_ids)
                deck = _build_swipe_genre_deck_round_robin(
                    media, parsed_ids, excluded, 100
                )
            sess = SwipeSession.query.filter_by(couple_id=cid).first()
            new_public = str(uuid.uuid4())
            if not sess:
                sess = SwipeSession(
                    couple_id=cid,
                    active=True,
                    source=source,
                    media=media if source == "genre" else None,
                    genre_ids_csv=genre_ids_csv if source == "genre" else "",
                    list_id=deck_list_id_val,
                    deck_json=json.dumps(deck, ensure_ascii=False),
                    cursor_index=0,
                    cursor_index_a=0,
                    cursor_index_b=0,
                    public_id=new_public,
                    updated_at=datetime.utcnow(),
                )
                db.session.add(sess)
            else:
                sess.active = True
                sess.source = source
                sess.media = media if source == "genre" else None
                sess.genre_ids_csv = genre_ids_csv if source == "genre" else ""
                sess.list_id = deck_list_id_val
                sess.deck_json = json.dumps(deck, ensure_ascii=False)
                sess.cursor_index = 0
                sess.cursor_index_a = 0
                sess.cursor_index_b = 0
                sess.public_id = new_public
                sess.updated_at = datetime.utcnow()
            reset_swipe_items_for_new_session_deck(cid, deck, new_public)
            prof = _swipe_viewer_profile()
            db.session.commit()
            _sync_swipe_session_cursor(cid)
            db.session.commit()
            db.session.refresh(sess)
            return jsonify(_swipe_session_json(cid, sess, prof))
        except Exception:
            current_app.logger.exception("api_swipe_session_start failed")
            db.session.rollback()
            return (
                jsonify(
                    {
                        "error": "Não foi possível criar a sessão de swipe. Tente de novo daqui a pouco.",
                        "active": False,
                    }
                ),
                500,
            )

    @app.get("/api/swipe/deck")
    def api_swipe_deck():
        """Compat: monta deck sem sessão (legado). Preferir /api/swipe/session."""
        cid = _couple_id()
        excluded = _swipe_swiped_out_keys(cid)
        source = (request.args.get("source") or "watchlater").strip().lower()
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")

        if source == "watchlater":
            deck = _build_swipe_watchlater_deck(cid, excluded, 20)
            return jsonify({"deck": _swipe_attach_card_states(cid, deck)})

        if source == "list":
            try:
                lid = int(request.args.get("list_id") or 0)
            except (TypeError, ValueError):
                return jsonify({"error": "list_id inválido"}), 400
            if lid <= 0:
                return jsonify({"error": "list_id obrigatório"}), 400
            deck = _build_swipe_custom_list_deck(cid, lid, excluded, 20)
            return jsonify({"deck": _swipe_attach_card_states(cid, deck)})

        if source != "genre":
            return jsonify({"error": "source inválido (watchlater|genre|list)"}), 400

        media = (request.args.get("media") or "movie").strip()
        if media not in ("movie", "tv"):
            media = "movie"
        parsed_ids: list[int] = []
        for part in (request.args.get("genre_ids") or "").split(","):
            part = part.strip()
            if not part:
                continue
            try:
                parsed_ids.append(int(part))
            except ValueError:
                continue
        parsed_ids = parsed_ids[:12]
        if not token:
            return jsonify({"deck": [], "message": "TMDB não configurado"})
        if not parsed_ids:
            return jsonify({"deck": []})
        if SOAP_NOVELA_GENRE_ID in parsed_ids:
            media = "tv"
        deck = _build_swipe_genre_deck_round_robin(media, parsed_ids, excluded, 20)
        random.shuffle(deck)
        return jsonify({"deck": _swipe_attach_card_states(cid, deck[:20])})

    @app.get("/api/swipe/match-cursor")
    def api_swipe_match_cursor():
        if not gamification_v2_enabled():
            return jsonify({"last_id": 0})
        cid = _couple_id()
        row = (
            GamificationEvent.query.filter_by(
                couple_id=cid,
                event_type="swipe.matched",
            )
            .order_by(desc(GamificationEvent.id))
            .first()
        )
        return jsonify({"last_id": int(row.id) if row else 0})

    @app.get("/api/swipe/matches")
    def api_swipe_matches_since():
        if not gamification_v2_enabled():
            return jsonify({"items": []})
        cid = _couple_id()
        since = request.args.get("since_id", type=int) or 0
        rows = (
            GamificationEvent.query.filter(
                GamificationEvent.couple_id == cid,
                GamificationEvent.event_type == "swipe.matched",
                GamificationEvent.id > since,
            )
            .order_by(GamificationEvent.id.asc())
            .limit(15)
            .all()
        )
        items = []
        for r in rows:
            try:
                pl = json.loads(r.payload_json or "{}")
            except json.JSONDecodeError:
                pl = {}
            items.append(
                {
                    "id": r.id,
                    "tmdb_id": pl.get("tmdb_id"),
                    "media_type": pl.get("media_type"),
                    "title": pl.get("title") or "",
                }
            )
        return jsonify({"items": items})

    @app.get("/api/swipe/session/matches")
    def api_swipe_session_matches():
        """Histórico de matches da sessão ativa do swipe."""
        cid = _couple_id()
        sess = SwipeSession.query.filter_by(couple_id=cid, active=True).first()
        sid = (getattr(sess, "public_id", None) or "").strip() if sess else ""
        if not sid:
            return jsonify({"session_public_id": "", "items": []})
        rows = (
            SwipeSessionMatch.query.filter_by(
                couple_id=cid, session_public_id=sid
            )
            .order_by(SwipeSessionMatch.id.desc())
            .limit(80)
            .all()
        )
        items = [
            {
                "id": int(r.id),
                "tmdb_id": int(r.tmdb_id),
                "media_type": r.media_type,
                "title": r.title or "",
                "poster_path": r.poster_path,
                "created_at": (
                    r.created_at.isoformat()
                    if getattr(r, "created_at", None)
                    else None
                ),
            }
            for r in rows
        ]
        return jsonify({"session_public_id": sid, "items": items})

    @app.get("/api/swipe/card-meta")
    def api_swipe_card_meta():
        """Metadados compactos para o card do swipe (sinopse + 3 nomes de elenco)."""
        mt = (request.args.get("media_type") or "").strip().lower()
        if mt not in ("movie", "tv"):
            return jsonify({"error": "media_type inválido"}), 400
        try:
            tid = int(request.args.get("tmdb_id") or 0)
        except (TypeError, ValueError):
            return jsonify({"error": "tmdb_id inválido"}), 400
        if tid <= 0:
            return jsonify({"error": "tmdb_id inválido"}), 400
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if not token:
            return jsonify({"overview": "", "cast_top": []})
        url = f"{TMDB_BASE}/{mt}/{tid}"
        params = {"language": TMDB_LANG, "append_to_response": "credits"}
        data = _tmdb_json_cached(
            url,
            params,
            ttl=21600,
            timeout=14.0,
            op="swipe_card_meta",
        )
        if not isinstance(data, dict):
            return jsonify({"overview": "", "cast_top": []})
        overview = (data.get("overview") or "").strip()
        credits = data.get("credits") or {}
        cast_raw = credits.get("cast") or []
        cast_sorted = sorted(cast_raw, key=_cast_billing_order)
        cast_top: list[str] = []
        seen: set[str] = set()
        for p in cast_sorted:
            nm = (p.get("name") or "").strip()
            if not nm or nm in seen:
                continue
            seen.add(nm)
            cast_top.append(nm)
            if len(cast_top) >= 3:
                break
        return jsonify({"overview": overview, "cast_top": cast_top})

    @app.get("/api/swipe/stream/<session_public_id>")
    def api_swipe_stream(session_public_id: str):
        """SSE: votos, matches e presença da sessão de swipe."""
        cid = _couple_id()
        sess = SwipeSession.query.filter_by(couple_id=cid, active=True).first()
        sid = (getattr(sess, "public_id", None) or "").strip() if sess else ""
        want = (session_public_id or "").strip()
        if not sess or not sid or sid != want:
            return jsonify({"error": "sessão inválida"}), 404
        profile = (request.args.get("profile") or "a").strip().lower()
        if profile not in ("a", "b"):
            profile = "a"

        def event_stream():
            q = sse_manager.subscribe(sid, profile)
            try:
                yield f"data: {json.dumps({'type': 'connected', 'profile': profile})}\n\n"
                presence_service.update_presence(sid, profile)
                presence_service.update_couple_presence(cid, profile)
                sse_manager.broadcast(
                    sid,
                    {
                        "type": "presence",
                        "online": presence_service.get_presence(sid),
                    },
                )
                while True:
                    try:
                        ev = q.get(timeout=25)
                        yield f"data: {json.dumps(ev, default=str)}\n\n"
                    except queue.Empty:
                        presence_service.update_presence(sid, profile)
                        presence_service.update_couple_presence(cid, profile)
                        sse_manager.broadcast(
                            sid,
                            {
                                "type": "presence",
                                "online": presence_service.get_presence(sid),
                            },
                        )
                        yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
            finally:
                sse_manager.unsubscribe(sid, q)

        return Response(
            event_stream(),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    @app.get("/api/couple/stream")
    def api_couple_stream():
        """SSE global do casal (match fora do swipe, assistindo agora, etc.)."""
        cid = _couple_id()
        profile = (request.args.get("profile") or "a").strip().lower()
        if profile not in ("a", "b"):
            profile = "a"

        def event_stream():
            q = sse_manager.subscribe_couple(cid)
            try:
                yield f"data: {json.dumps({'type': 'connected', 'scope': 'couple'})}\n\n"
                while True:
                    try:
                        ev = q.get(timeout=25)
                        yield f"data: {json.dumps(ev, default=str)}\n\n"
                    except queue.Empty:
                        presence_service.update_couple_presence(cid, profile)
                        yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
            finally:
                sse_manager.unsubscribe_couple(cid, q)

        return Response(
            event_stream(),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    @app.get("/api/presence")
    def api_presence():
        """Presença do casal; toca o perfil atual (útil com polling no shell)."""
        cid = _couple_id()
        prof = _active_profile_slug_from_session()
        if prof in ("a", "b"):
            presence_service.update_couple_presence(cid, prof)
        return jsonify({"online": presence_service.get_couple_presence(cid)})

    @app.post("/api/activity/watching")
    def api_activity_watching():
        """Notifica o parceiro (via SSE do casal) que este perfil abriu/está vendo um título."""
        cid = _couple_id()
        body = request.get_json(silent=True) or {}
        try:
            tmdb_id = int(body.get("tmdb_id"))
        except (TypeError, ValueError):
            return jsonify({"error": "tmdb_id inválido"}), 400
        mt = (body.get("media_type") or "movie").strip()
        if mt not in ("movie", "tv"):
            mt = "movie"
        title = (body.get("title") or "").strip() or "Sem título"
        profile = _swipe_acting_profile()
        sse_manager.broadcast_couple(
            cid,
            {
                "type": "watching",
                "profile": profile,
                "title": title,
                "tmdb_id": tmdb_id,
                "media_type": mt,
            },
        )
        return jsonify({"ok": True})

    @app.post("/api/swipe/action")
    def api_swipe_action():
        cid = _couple_id()
        body = request.get_json(silent=True) or {}
        try:
            tid = int(body.get("tmdb_id"))
        except (TypeError, ValueError):
            return jsonify({"error": "tmdb_id inválido"}), 400
        mt = (body.get("media_type") or "").strip()
        if mt not in ("movie", "tv"):
            return jsonify({"error": "media_type inválido"}), 400
        profile = _swipe_acting_profile()
        action = (body.get("action") or "").strip().lower()
        if action not in ("like", "reject"):
            return jsonify({"error": "action deve ser like ou reject"}), 400

        row = SwipeItem.query.filter_by(
            couple_id=cid, tmdb_id=tid, media_type=mt
        ).first()
        sess = SwipeSession.query.filter_by(couple_id=cid, active=True).first()
        session_public_id = (getattr(sess, "public_id", None) or "").strip() if sess else ""
        title = (body.get("title") or "").strip() or "Sem título"
        poster = (body.get("poster_path") or "").strip() or None
        if not row:
            row = SwipeItem(
                couple_id=cid,
                tmdb_id=tid,
                media_type=mt,
                title=title,
                poster_path=poster,
                state="pending",
                vote_a="none",
                vote_b="none",
                last_session_public_id=session_public_id or None,
            )
            db.session.add(row)
            db.session.flush()
        elif session_public_id:
            row.last_session_public_id = session_public_id
        if not row.title:
            row.title = title
        if not row.poster_path and poster:
            row.poster_path = poster
        cur = row.state or "pending"
        new_state, err = transition_on_swipe(cur, profile, action)
        if err:
            return jsonify({"error": err, "state": cur}), 400
        if profile == "a":
            row.vote_a = "like" if action == "like" else "reject"
        else:
            row.vote_b = "like" if action == "like" else "reject"
        row.state = new_state
        row.updated_at = datetime.utcnow()
        if new_state == "matched" and session_public_id:
            if not SwipeSessionMatch.query.filter_by(
                couple_id=cid,
                session_public_id=session_public_id,
                tmdb_id=tid,
                media_type=mt,
            ).first():
                db.session.add(
                    SwipeSessionMatch(
                        couple_id=cid,
                        session_public_id=session_public_id,
                        tmdb_id=tid,
                        media_type=mt,
                        title=row.title,
                        poster_path=row.poster_path,
                        created_at=datetime.utcnow(),
                    )
                )
        if gamification_v2_enabled() and new_state == "matched" and cur != "matched":
            db.session.add(
                GamificationEvent(
                    couple_id=cid,
                    event_type="swipe.matched",
                    payload_json=json.dumps(
                        {
                            "tmdb_id": tid,
                            "media_type": mt,
                            "title": row.title,
                            "session_public_id": session_public_id,
                        },
                        default=str,
                    ),
                    created_at=datetime.utcnow(),
                )
            )
        db.session.commit()
        _sync_swipe_session_cursor(cid)
        db.session.commit()
        sess_post = SwipeSession.query.filter_by(couple_id=cid, active=True).first()
        spid = (getattr(sess_post, "public_id", None) or "").strip() if sess_post else ""
        if spid:
            presence_service.update_presence(spid, profile)
            presence_service.update_couple_presence(cid, profile)
            cur_a = int(getattr(sess_post, "cursor_index_a", 0) or 0)
            cur_b = int(getattr(sess_post, "cursor_index_b", 0) or 0)
            sse_manager.broadcast(
                spid,
                {
                    "type": "vote",
                    "profile": profile,
                    "item_id": int(row.id),
                    "tmdb_id": int(tid),
                    "media_type": mt,
                    "new_state": new_state,
                    "cursor_a": cur_a,
                    "cursor_b": cur_b,
                },
            )
            sse_manager.broadcast(
                spid,
                {
                    "type": "presence",
                    "online": presence_service.get_presence(spid),
                },
            )
            if new_state == "matched":
                match_evt = {
                    "type": "match",
                    "item_id": int(row.id),
                    "tmdb_id": int(tid),
                    "media_type": mt,
                    "title": row.title or "",
                    "poster_path": row.poster_path,
                }
                sse_manager.broadcast(spid, match_evt)
                sse_manager.broadcast_couple(cid, match_evt)
        return jsonify({"state": new_state})

    @app.get("/api/today")
    def api_today():
        """Sugestão do dia: watchlist + trending, anti-repetição 14 dias."""
        cid = _couple_id()
        today = date.today().isoformat()
        since = (date.today() - timedelta(days=14)).isoformat()
        recent_ids = {
            (p.tmdb_id, p.media_type)
            for p in TodayPick.query.filter(
                TodayPick.couple_id == cid,
                TodayPick.day_key >= since,
            ).all()
        }
        candidates = []
        for wl in WatchLaterItem.query.order_by(WatchLaterItem.added_at.desc()).all():
            key = (wl.tmdb_id, wl.media_type)
            if key not in recent_ids:
                candidates.append(
                    {
                        "tmdb_id": wl.tmdb_id,
                        "media_type": wl.media_type,
                        "title": wl.title,
                        "poster_path": wl.poster_path,
                        "overview": (wl.overview or "")[:240],
                    }
                )
        token = os.environ.get("TMDB_READ_ACCESS_TOKEN")
        if token:
            j = _tmdb_json_cached(
                f"{TMDB_BASE}/movie/now_playing",
                {"language": TMDB_LANG, "region": TMDB_REGION_BR, "page": 1},
                ttl=360,
                timeout=14.0,
                op="today_now_playing",
            )
            if isinstance(j, dict):
                for it in (j.get("results") or [])[:15]:
                    tid = it.get("id")
                    if not tid:
                        continue
                    key = (int(tid), "movie")
                    if key in recent_ids:
                        continue
                    candidates.append(
                        {
                            "tmdb_id": int(tid),
                            "media_type": "movie",
                            "title": it.get("title") or "",
                            "poster_path": it.get("poster_path"),
                            "overview": (it.get("overview") or "")[:240],
                        }
                    )
        if not candidates:
            return jsonify({"pick": None, "message": "Sem sugestões no momento."})
        pick = random.choice(candidates)
        exists = TodayPick.query.filter_by(
            couple_id=cid,
            tmdb_id=pick["tmdb_id"],
            media_type=pick["media_type"],
            day_key=today,
        ).first()
        if not exists:
            db.session.add(
                TodayPick(
                    couple_id=cid,
                    tmdb_id=pick["tmdb_id"],
                    media_type=pick["media_type"],
                    day_key=today,
                )
            )
            try:
                db.session.commit()
            except Exception:
                db.session.rollback()
        return jsonify({"pick": pick, "day": today})

    @app.get("/assistimos-hoje")
    def assistimos_hoje_page():
        ym = (request.args.get("m") or date.today().strftime("%Y-%m"))[:7]
        return render_template("assistimos_hoje.html", month=ym)

    @app.get("/assistimos-hoje/dia/<day>")
    def assistimos_hoje_day_page(day: str):
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", day):
            abort(404)
        ym = day[:7]
        return render_template("assistimos_hoje_day.html", day=day, month=ym)

    @app.get("/api/daily-watch/day/<day>")
    def api_daily_watch_day(day: str):
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", day):
            return jsonify({"error": "day inválido"}), 400
        cid = _couple_id()
        rows = (
            DailyWatchEntry.query.filter_by(couple_id=cid, day=day)
            .order_by(DailyWatchEntry.id)
            .all()
        )
        items = [
            {
                "id": r.id,
                "tmdb_id": r.tmdb_id,
                "media_type": r.media_type,
                "title": r.title,
                "poster_path": r.poster_path,
                "progress_json": r.progress_json,
            }
            for r in rows
        ]
        return jsonify({"day": day, "items": items})

    @app.get("/api/daily-watch")
    def api_daily_watch_list():
        cid = _couple_id()
        month = (request.args.get("m") or date.today().strftime("%Y-%m"))[:7]
        rows = DailyWatchEntry.query.filter(
            DailyWatchEntry.couple_id == cid,
            DailyWatchEntry.day.startswith(month),
        ).order_by(DailyWatchEntry.day, DailyWatchEntry.id).all()
        by_day: dict[str, list[dict]] = {}
        for r in rows:
            by_day.setdefault(r.day, []).append(
                {
                    "id": r.id,
                    "tmdb_id": r.tmdb_id,
                    "media_type": r.media_type,
                    "title": r.title,
                    "poster_path": r.poster_path,
                    "progress_json": r.progress_json,
                }
            )
        return jsonify({"month": month, "by_day": by_day})

    @app.get("/api/tmdb/tv/<int:tmdb_id>/meta")
    def api_tmdb_tv_meta(tmdb_id: int):
        j = _tmdb_json_cached(
            f"{TMDB_BASE}/tv/{tmdb_id}",
            {"language": TMDB_LANG},
            ttl=600,
            timeout=18.0,
            op="tv_meta",
        )
        if not isinstance(j, dict):
            return jsonify({"error": "TMDB indisponível"}), 502
        seasons_out = []
        for s in j.get("seasons") or []:
            sn = s.get("season_number")
            if sn is None or int(sn) < 1:
                continue
            seasons_out.append(
                {
                    "season_number": int(sn),
                    "episode_count": int(s.get("episode_count") or 0),
                    "name": (s.get("name") or "").strip(),
                }
            )
        seasons_out.sort(key=lambda x: x["season_number"])
        return jsonify(
            {
                "tmdb_id": tmdb_id,
                "name": j.get("name") or "",
                "number_of_episodes": j.get("number_of_episodes"),
                "seasons": seasons_out,
            }
        )

    @app.get("/api/tv-episode-marks")
    def api_tv_episode_marks():
        cid = _couple_id()
        tid = request.args.get("tmdb_id", type=int)
        if not tid:
            return jsonify({"items": []})
        rows = TvEpisodeMark.query.filter_by(couple_id=cid, tmdb_id=tid).all()
        return jsonify(
            {
                "items": [
                    {"season": r.season, "episode": r.episode} for r in rows
                ]
            }
        )

    @app.post("/api/daily-watch/add")
    def api_daily_watch_add():
        cid = _couple_id()
        body = request.get_json(silent=True) or {}
        day = (body.get("day") or "").strip()[:10]
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", day):
            return jsonify({"error": "day inválido (YYYY-MM-DD)"}), 400
        try:
            tid = int(body.get("tmdb_id"))
        except (TypeError, ValueError):
            return jsonify({"error": "tmdb_id inválido"}), 400
        mt = (body.get("media_type") or "").strip()
        if mt not in ("movie", "tv"):
            return jsonify({"error": "media_type inválido"}), 400
        title = (body.get("title") or "").strip() or "Sem título"
        poster = (body.get("poster_path") or "").strip() or None
        progress = body.get("progress_json")
        pj = None
        if progress is not None:
            pj = json.dumps(progress, ensure_ascii=False) if isinstance(
                progress, dict
            ) else str(progress)[:512]
        episodes_raw = body.get("episodes")
        ep_payload = None
        if mt == "tv" and isinstance(episodes_raw, list) and episodes_raw:
            cleaned_eps = []
            for cell in episodes_raw:
                if isinstance(cell, dict):
                    s = cell.get("season")
                    e = cell.get("episode")
                elif isinstance(cell, (list, tuple)) and len(cell) >= 2:
                    s, e = cell[0], cell[1]
                else:
                    continue
                try:
                    si = int(s)
                    ei = int(e)
                except (TypeError, ValueError):
                    continue
                if si < 1 or ei < 1:
                    continue
                cleaned_eps.append({"season": si, "episode": ei})
                existing = TvEpisodeMark.query.filter_by(
                    couple_id=cid, tmdb_id=tid, season=si, episode=ei
                ).first()
                if not existing:
                    db.session.add(
                        TvEpisodeMark(
                            couple_id=cid,
                            tmdb_id=tid,
                            season=si,
                            episode=ei,
                        )
                    )
            if cleaned_eps:
                ep_payload = {"episodes": cleaned_eps}
        if ep_payload:
            pj = json.dumps(ep_payload, ensure_ascii=False)
        row = DailyWatchEntry(
            couple_id=cid,
            day=day,
            tmdb_id=tid,
            media_type=mt,
            title=title,
            poster_path=poster,
            progress_json=pj,
        )
        db.session.add(row)
        db.session.commit()
        return jsonify({"id": row.id})

    @app.post("/api/daily-watch/remove/<int:entry_id>")
    def api_daily_watch_remove(entry_id: int):
        cid = _couple_id()
        row = DailyWatchEntry.query.filter_by(id=entry_id, couple_id=cid).first()
        if row:
            db.session.delete(row)
            db.session.commit()
        return jsonify({"ok": True})

    return app


app = create_app()

if __name__ == "__main__":
    # Desenvolvimento: porta/host via ambiente (padrão 127.0.0.1:5055 — evita conflito com outro Flask na 5000)
    _host = os.environ.get("FLASK_RUN_HOST", "127.0.0.1")
    try:
        _port = int(os.environ.get("FLASK_RUN_PORT", "5055"))
    except ValueError:
        _port = 5055
    # threaded=True: evita bloquear o processo com uma conexão SSE longa (dev).
    app.run(host=_host, port=_port, debug=False, threaded=True)
