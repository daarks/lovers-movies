"""Catálogo de temas de temporada: gêneros bônus, keywords TMDB e listas curadas.

Consumido por:
- gamification/seasons.py (ensure_current_season usa title/emoji)
- gamification/engine.py (xp multiplier por gênero bônus)
- rota /api/season/current (render do hub de temporada)
- conquistas sazonais em achievements_catalog.yaml (keywords/lista curada por theme)

Não altere os theme_key existentes — eles são referenciados nas entradas legadas
do GameSeason.
"""
from __future__ import annotations

from typing import Any


# TMDB genre ids usados: 27 Terror, 53 Thriller, 18 Drama, 36 História, 10752 Guerra,
# 28 Ação, 12 Aventura, 878 FicCient, 35 Comédia, 10751 Família, 14 Fantasia, 10749 Romance,
# 9648 Mistério, 80 Crime.
# Keywords TMDB: 9715 = "based on novel or book" não; o keyword "Stephen King" é 9715
# (author). Para "terror clássico" usamos listas curadas.

SEASON_THEMES: dict[str, dict[str, Any]] = {
    "winter_awards": {
        "title": "Temporada de Premiações",
        "emoji": "🎭",
        "tagline": "O brilho do tapete vermelho é pra vocês também.",
        "long_intro": (
            "A temporada das grandes premiações é sobre desacelerar e olhar para "
            "as obras que os críticos e os prêmios elegeram. Dramas densos, biografias "
            "marcantes e filmes indicados ao Oscar que ficam na memória."
        ),
        "xp_multiplier": 1.5,
        "bonus_genres": [
            {"tmdb_id": 18, "name": "Drama"},
            {"tmdb_id": 36, "name": "História"},
            {"tmdb_id": 10752, "name": "Guerra"},
        ],
        "tmdb_keywords": [
            {"id": 210024, "name": "Ganhador do Oscar"},
            {"id": 9849, "name": "Biografia"},
        ],
        "curated_lists": [
            {
                "id": "oscar_best_picture",
                "title": "Vencedores recentes de Melhor Filme",
                "subtitle": "Seleção de Oscars da última década.",
                "items": [
                    {"tmdb_id": 774, "media_type": "movie"},   # Cidade de Deus
                    {"tmdb_id": 429, "media_type": "movie"},   # Três Homens em Conflito
                    {"tmdb_id": 238, "media_type": "movie"},   # O Poderoso Chefão
                    {"tmdb_id": 49047, "media_type": "movie"}, # Gravidade
                    {"tmdb_id": 496243, "media_type": "movie"},# Parasita
                    {"tmdb_id": 545611, "media_type": "movie"},# Tudo em Todo o Lugar
                    {"tmdb_id": 467244, "media_type": "movie"},# O Som do Silêncio
                    {"tmdb_id": 872585, "media_type": "movie"},# Oppenheimer
                ],
            },
        ],
        "seasonal_achievements": [
            "season_awards_drama_5",
            "season_awards_oscar_list_5",
            "season_awards_biography_3",
        ],
    },
    "summer_blockbusters": {
        "title": "Blocos de Verão",
        "emoji": "🌅",
        "tagline": "Pipoca estourada, volume no talo.",
        "long_intro": (
            "É hora de ação, aventura e sci-fi popular. Blockbusters que foram feitos "
            "pro cinemão lotado de verão — daqueles que ninguém quer perder o começo."
        ),
        "xp_multiplier": 1.5,
        "bonus_genres": [
            {"tmdb_id": 28, "name": "Ação"},
            {"tmdb_id": 12, "name": "Aventura"},
            {"tmdb_id": 878, "name": "Ficção científica"},
        ],
        "tmdb_keywords": [
            {"id": 9882, "name": "Super-herói"},
            {"id": 4379, "name": "Viagem no tempo"},
        ],
        "curated_lists": [
            {
                "id": "summer_iconic",
                "title": "Blockbusters icônicos",
                "subtitle": "Daqueles que definiram verões inteiros.",
                "items": [
                    {"tmdb_id": 601, "media_type": "movie"},     # E.T.
                    {"tmdb_id": 329, "media_type": "movie"},     # Jurassic Park
                    {"tmdb_id": 11, "media_type": "movie"},      # Star Wars
                    {"tmdb_id": 24428, "media_type": "movie"},   # Os Vingadores
                    {"tmdb_id": 27205, "media_type": "movie"},   # A Origem
                    {"tmdb_id": 438631, "media_type": "movie"},  # Duna
                    {"tmdb_id": 569094, "media_type": "movie"},  # Aranhaverso 2
                    {"tmdb_id": 603, "media_type": "movie"},     # Matrix
                ],
            },
        ],
        "seasonal_achievements": [
            "season_summer_action_5",
            "season_summer_iconic_5",
            "season_summer_superhero_3",
        ],
    },
    "autumn_thriller": {
        "title": "Temporada do Terror",
        "emoji": "🎃",
        "tagline": "Noites longas pedem sustos bons.",
        "long_intro": (
            "Outono puxa o tapete da luz natural e deixa tudo mais denso. É a estação "
            "perfeita pra encarar clássicos do horror, adaptações do Stephen King e "
            "thrillers psicológicos que grudam na cabeça."
        ),
        "xp_multiplier": 1.5,
        "bonus_genres": [
            {"tmdb_id": 27, "name": "Terror"},
            {"tmdb_id": 53, "name": "Thriller"},
            {"tmdb_id": 9648, "name": "Mistério"},
        ],
        "tmdb_keywords": [
            {"id": 9715, "name": "Stephen King"},
        ],
        "curated_lists": [
            {
                "id": "horror_classics",
                "title": "Clássicos do terror",
                "subtitle": "5 deles já desbloqueiam uma conquista sazonal.",
                "items": [
                    {"tmdb_id": 694, "media_type": "movie"},   # O Iluminado
                    {"tmdb_id": 948, "media_type": "movie"},   # Halloween
                    {"tmdb_id": 539, "media_type": "movie"},   # Psicose
                    {"tmdb_id": 609, "media_type": "movie"},   # A Hora do Pesadelo
                    {"tmdb_id": 744, "media_type": "movie"},   # Top Gun — placeholder se não carregar
                    {"tmdb_id": 493922, "media_type": "movie"},# Hereditário
                    {"tmdb_id": 530385, "media_type": "movie"},# Midsommar
                    {"tmdb_id": 381288, "media_type": "movie"},# Corra!
                    {"tmdb_id": 4232, "media_type": "movie"},  # Scream
                    {"tmdb_id": 346364, "media_type": "movie"},# It
                ],
            },
        ],
        "seasonal_achievements": [
            "season_terror_king_5",
            "season_terror_classics_5",
            "season_terror_streak_3",
        ],
    },
    "winter_magic": {
        "title": "Magia de Fim de Ano",
        "emoji": "✨",
        "tagline": "Cobertor, chocolate quente e história leve.",
        "long_intro": (
            "O fim de ano pede aconchego: fantasia, família, animação e aquela "
            "pitada de nostalgia. Nada de maratonas pesadas — abrace o clima."
        ),
        "xp_multiplier": 1.5,
        "bonus_genres": [
            {"tmdb_id": 10751, "name": "Família"},
            {"tmdb_id": 14, "name": "Fantasia"},
            {"tmdb_id": 16, "name": "Animação"},
        ],
        "tmdb_keywords": [
            {"id": 207317, "name": "Natal"},
        ],
        "curated_lists": [
            {
                "id": "feel_good",
                "title": "Clima de fim de ano",
                "subtitle": "Clássicos aconchegantes para a estação.",
                "items": [
                    {"tmdb_id": 9087, "media_type": "movie"},   # Esqueceram de Mim
                    {"tmdb_id": 8844, "media_type": "movie"},   # Jumanji
                    {"tmdb_id": 10193, "media_type": "movie"},  # Toy Story 3
                    {"tmdb_id": 152532, "media_type": "movie"}, # Divertida Mente
                    {"tmdb_id": 120, "media_type": "movie"},    # Senhor dos Anéis I
                    {"tmdb_id": 671, "media_type": "movie"},    # Harry Potter I
                    {"tmdb_id": 14836, "media_type": "movie"},  # Coraline
                    {"tmdb_id": 109445, "media_type": "movie"}, # Frozen
                ],
            },
        ],
        "seasonal_achievements": [
            "season_magic_family_5",
            "season_magic_feelgood_5",
            "season_magic_christmas_3",
        ],
    },
}


def get_theme(theme_key: str | None) -> dict[str, Any] | None:
    if not theme_key:
        return None
    return SEASON_THEMES.get(theme_key)


def bonus_genre_ids(theme_key: str | None) -> set[int]:
    theme = get_theme(theme_key)
    if not theme:
        return set()
    return {int(g["tmdb_id"]) for g in theme.get("bonus_genres", [])}


def bonus_genre_names(theme_key: str | None) -> set[str]:
    theme = get_theme(theme_key)
    if not theme:
        return set()
    return {str(g["name"]).strip().lower() for g in theme.get("bonus_genres", [])}


def xp_multiplier(theme_key: str | None) -> float:
    theme = get_theme(theme_key)
    if not theme:
        return 1.0
    try:
        return float(theme.get("xp_multiplier") or 1.0)
    except (TypeError, ValueError):
        return 1.0


def curated_tmdb_ids(theme_key: str | None, list_id: str | None = None) -> list[int]:
    theme = get_theme(theme_key)
    if not theme:
        return []
    out: list[int] = []
    for lst in theme.get("curated_lists", []):
        if list_id and lst.get("id") != list_id:
            continue
        for it in lst.get("items", []):
            try:
                out.append(int(it["tmdb_id"]))
            except (KeyError, TypeError, ValueError):
                continue
    return out


def keyword_ids(theme_key: str | None) -> list[int]:
    theme = get_theme(theme_key)
    if not theme:
        return []
    return [int(k["id"]) for k in theme.get("tmdb_keywords", []) if k.get("id")]
