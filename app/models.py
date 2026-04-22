# Modelos SQLAlchemy para itens assistidos (filmes e séries).
import datetime

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import UniqueConstraint

db = SQLAlchemy()


class WatchedItem(db.Model):
    """Representa um filme ou série marcado como assistido com avaliação local."""

    __tablename__ = "watched_items"
    __table_args__ = (
        UniqueConstraint("tmdb_id", "media_type", name="uq_tmdb_media"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tmdb_id = db.Column(db.Integer, nullable=False)
    media_type = db.Column(db.String(16), nullable=False)  # "movie" ou "tv"
    title = db.Column(db.String(512), nullable=False)
    original_title = db.Column(db.String(512))
    overview = db.Column(db.Text)
    poster_path = db.Column(db.String(512))
    backdrop_path = db.Column(db.String(512))
    release_date = db.Column(db.String(32))
    genres = db.Column(db.String(512))
    vote_average = db.Column(db.Float)
    # Média (filme: nota única; série: média das temporadas avaliadas)
    rating = db.Column(db.Float, nullable=False)
    # Filme: resenha única. Série com temporadas: costuma ficar vazio (textos em season_data).
    review = db.Column(db.Text, nullable=True)
    # JSON: {"1": {"rating": 8.5, "review": "..."}, "2": {...}}
    season_data = db.Column(db.Text, nullable=True)
    added_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    # Fase 2: snapshot TMDB (países, diretores, gêneros ids, runtime…) para conquistas/mapa
    tmdb_snapshot_json = db.Column(db.Text, nullable=True)


class WatchLaterItem(db.Model):
    """Filme ou série marcado para assistir depois (sem nota até entrar no histórico)."""

    __tablename__ = "watch_later_items"
    __table_args__ = (
        UniqueConstraint("tmdb_id", "media_type", name="uq_watchlater_tmdb_media"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tmdb_id = db.Column(db.Integer, nullable=False)
    media_type = db.Column(db.String(16), nullable=False)
    title = db.Column(db.String(512), nullable=False)
    original_title = db.Column(db.String(512))
    overview = db.Column(db.Text)
    poster_path = db.Column(db.String(512))
    backdrop_path = db.Column(db.String(512))
    release_date = db.Column(db.String(32))
    genres = db.Column(db.String(512))
    vote_average = db.Column(db.Float)
    added_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)


# --- Fase 1: casal local, embeddings, swipe, diário, trivia cache ---


class Couple(db.Model):
    __tablename__ = "couples"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    label = db.Column(db.String(128), nullable=False, default="Nós")
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)


class Profile(db.Model):
    """Perfil fixo do casal (ex.: perfil A / perfil B)."""

    __tablename__ = "profiles"
    __table_args__ = (UniqueConstraint("couple_id", "slug", name="uq_profile_couple_slug"),)

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    couple_id = db.Column(db.Integer, db.ForeignKey("couples.id"), nullable=False)
    slug = db.Column(db.String(16), nullable=False)  # 'a' | 'b'
    display_name = db.Column(db.String(64), nullable=False)
    preferred_genre_ids = db.Column(db.String(256))  # CSV de ids TMDB


class MediaList(db.Model):
    """Lista customizada de títulos (input para swipe / sorteio)."""

    __tablename__ = "media_lists"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    couple_id = db.Column(db.Integer, db.ForeignKey("couples.id"), nullable=False)
    name = db.Column(db.String(160), nullable=False)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)


class MediaListItem(db.Model):
    """Item em uma MediaList (metadados espelham watch_later_items)."""

    __tablename__ = "media_list_items"
    __table_args__ = (
        UniqueConstraint("list_id", "tmdb_id", "media_type", name="uq_mli_list_tmdb"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    list_id = db.Column(db.Integer, db.ForeignKey("media_lists.id", ondelete="CASCADE"), nullable=False)
    tmdb_id = db.Column(db.Integer, nullable=False)
    media_type = db.Column(db.String(16), nullable=False)
    title = db.Column(db.String(512), nullable=False)
    original_title = db.Column(db.String(512))
    overview = db.Column(db.Text)
    poster_path = db.Column(db.String(512))
    backdrop_path = db.Column(db.String(512))
    release_date = db.Column(db.String(32))
    genres = db.Column(db.String(512))
    vote_average = db.Column(db.Float)
    sort_order = db.Column(db.Integer, nullable=False, default=0)
    added_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)


class MediaEmbedding(db.Model):
    """Texto indexado + embedding (JSON) para busca semântica."""

    __tablename__ = "media_embeddings"
    __table_args__ = (
        UniqueConstraint("tmdb_id", "media_type", name="uq_embed_tmdb_media"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tmdb_id = db.Column(db.Integer, nullable=False)
    media_type = db.Column(db.String(16), nullable=False)
    title = db.Column(db.String(512), nullable=False)
    overview = db.Column(db.Text)
    genres_csv = db.Column(db.String(512))
    credits_blob = db.Column(db.Text)
    vote_average = db.Column(db.Float)
    indexed_text_hash = db.Column(db.String(64))
    embedding_json = db.Column(db.Text, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)


class SwipeItem(db.Model):
    """
    Estado por título no deck do casal.
    pending | liked_a | liked_b | rejected_a | rejected_b | matched | rejected | no_match
    """

    __tablename__ = "swipe_items"
    __table_args__ = (
        UniqueConstraint("couple_id", "tmdb_id", "media_type", name="uq_swipe_couple_tmdb"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    couple_id = db.Column(db.Integer, db.ForeignKey("couples.id"), nullable=False)
    tmdb_id = db.Column(db.Integer, nullable=False)
    media_type = db.Column(db.String(16), nullable=False)
    title = db.Column(db.String(512), nullable=False)
    poster_path = db.Column(db.String(512))
    state = db.Column(db.String(16), nullable=False, default="pending")
    vote_a = db.Column(db.String(8), nullable=False, default="none")  # none | like | reject
    vote_b = db.Column(db.String(8), nullable=False, default="none")  # none | like | reject
    last_session_public_id = db.Column(db.String(40), nullable=True, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)


class SwipeSession(db.Model):
    """Deck de swipe compartilhado pelo casal (mesma ordem para os dois perfis / dispositivos)."""

    __tablename__ = "swipe_sessions"
    __table_args__ = (UniqueConstraint("couple_id", name="uq_swipe_session_couple"),)

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    couple_id = db.Column(db.Integer, db.ForeignKey("couples.id"), nullable=False)
    active = db.Column(db.Boolean, nullable=False, default=True)
    source = db.Column(db.String(32), nullable=False)  # watchlater | genre | list
    media = db.Column(db.String(8))  # movie | tv (genre)
    genre_ids_csv = db.Column(db.String(256))
    list_id = db.Column(db.Integer, db.ForeignKey("media_lists.id", ondelete="SET NULL"), nullable=True)
    deck_json = db.Column(db.Text, nullable=False, default="[]")
    # Legado: antes era um único cursor compartilhado (causava “saltos” entre dispositivos).
    cursor_index = db.Column(db.Integer, nullable=False, default=0)
    cursor_index_a = db.Column(db.Integer, nullable=False, default=0)
    cursor_index_b = db.Column(db.Integer, nullable=False, default=0)
    # Identificador estável desta “rodada” de sessão (compartilhável / lista no UI).
    public_id = db.Column(db.String(40), nullable=True, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)


class SwipeSessionMatch(db.Model):
    """Histórico de matches por sessão do swipe."""

    __tablename__ = "swipe_session_matches"
    __table_args__ = (
        UniqueConstraint(
            "couple_id",
            "session_public_id",
            "tmdb_id",
            "media_type",
            name="uq_swipe_session_match",
        ),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    couple_id = db.Column(db.Integer, db.ForeignKey("couples.id"), nullable=False)
    session_public_id = db.Column(db.String(40), nullable=False, index=True)
    tmdb_id = db.Column(db.Integer, nullable=False)
    media_type = db.Column(db.String(16), nullable=False)
    title = db.Column(db.String(512), nullable=False)
    poster_path = db.Column(db.String(512))
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)


class TodayPick(db.Model):
    """Anti-repetição: sugestões já mostradas no modo 'hoje'."""

    __tablename__ = "today_picks"
    __table_args__ = (
        UniqueConstraint(
            "couple_id",
            "tmdb_id",
            "media_type",
            "day_key",
            name="uq_today_pick_day",
        ),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    couple_id = db.Column(db.Integer, db.ForeignKey("couples.id"), nullable=False)
    tmdb_id = db.Column(db.Integer, nullable=False)
    media_type = db.Column(db.String(16), nullable=False)
    day_key = db.Column(db.String(10), nullable=False)  # YYYY-MM-DD


class DailyWatchEntry(db.Model):
    """Registro diário (0..N por dia); não exige nota."""

    __tablename__ = "daily_watch_entries"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    couple_id = db.Column(db.Integer, db.ForeignKey("couples.id"), nullable=False)
    day = db.Column(db.String(10), nullable=False)  # YYYY-MM-DD
    tmdb_id = db.Column(db.Integer, nullable=False)
    media_type = db.Column(db.String(16), nullable=False)
    title = db.Column(db.String(512), nullable=False)
    poster_path = db.Column(db.String(512))
    # JSON opcional: {"season":1,"episode":3,"status":"in_progress"} para novela/série
    progress_json = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)


class TvEpisodeMark(db.Model):
    """Episódios já marcados no diário (persistência entre dias)."""

    __tablename__ = "tv_episode_marks"
    __table_args__ = (
        UniqueConstraint(
            "couple_id",
            "tmdb_id",
            "season",
            "episode",
            name="uq_tv_episode_mark",
        ),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    couple_id = db.Column(db.Integer, db.ForeignKey("couples.id"), nullable=False)
    tmdb_id = db.Column(db.Integer, nullable=False)
    season = db.Column(db.Integer, nullable=False)
    episode = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)


class TriviaCache(db.Model):
    """Cache de trivia por chave estável (tmdb + idioma)."""

    __tablename__ = "trivia_cache"
    __table_args__ = (UniqueConstraint("cache_key", name="uq_trivia_key"),)

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    cache_key = db.Column(db.String(128), nullable=False)
    payload_json = db.Column(db.Text, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)


# --- Fase 2: gamificação ---


class WatchProfileRating(db.Model):
    """Nota 1–10 por perfil (casal) para o mesmo WatchedItem."""

    __tablename__ = "watch_profile_ratings"
    __table_args__ = (
        UniqueConstraint("watched_item_id", "profile_id", name="uq_wpr_item_profile"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    watched_item_id = db.Column(
        db.Integer, db.ForeignKey("watched_items.id", ondelete="CASCADE"), nullable=False
    )
    profile_id = db.Column(
        db.Integer, db.ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    rating = db.Column(db.Float, nullable=False)
    review = db.Column(db.Text, nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)


class GamificationEvent(db.Model):
    __tablename__ = "gamification_events"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    couple_id = db.Column(db.Integer, db.ForeignKey("couples.id"), nullable=True)
    event_type = db.Column(db.String(128), nullable=False)
    payload_json = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)


class AchievementProgress(db.Model):
    __tablename__ = "achievement_progress"
    __table_args__ = (
        UniqueConstraint("couple_id", "achievement_id", name="uq_ach_couple_id"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    couple_id = db.Column(db.Integer, db.ForeignKey("couples.id"), nullable=False)
    achievement_id = db.Column(db.String(64), nullable=False)
    progress = db.Column(db.Integer, default=0)
    target = db.Column(db.Integer, nullable=True)
    unlocked_at = db.Column(db.DateTime, nullable=True)
    meta_json = db.Column(db.Text, nullable=True)


class XpLedgerEntry(db.Model):
    __tablename__ = "xp_ledger"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    couple_id = db.Column(db.Integer, db.ForeignKey("couples.id"), nullable=False)
    amount = db.Column(db.Integer, nullable=False)
    reason = db.Column(db.String(128), nullable=False)
    ref = db.Column(db.String(128), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)


class CoupleXpState(db.Model):
    __tablename__ = "couple_xp_state"
    __table_args__ = (UniqueConstraint("couple_id", name="uq_couple_xp"),)

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    couple_id = db.Column(db.Integer, db.ForeignKey("couples.id"), nullable=False)
    total_xp = db.Column(db.Integer, default=0, nullable=False)
    level = db.Column(db.Integer, default=1, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)


class WatchBet(db.Model):
    """Aposta pré-sessão: previsão 1–10; histórico por linhas (status open/resolved)."""

    __tablename__ = "watch_bets"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    couple_id = db.Column(db.Integer, db.ForeignKey("couples.id"), nullable=False)
    profile_id = db.Column(db.Integer, db.ForeignKey("profiles.id"), nullable=False)
    tmdb_id = db.Column(db.Integer, nullable=False)
    media_type = db.Column(db.String(16), nullable=False)
    title = db.Column(db.String(512), nullable=False)
    predicted_rating = db.Column(db.Float, nullable=False)
    status = db.Column(db.String(16), default="open")  # open|resolved
    actual_rating = db.Column(db.Float, nullable=True)
    error_abs = db.Column(db.Float, nullable=True)
    won = db.Column(db.Boolean, nullable=True)
    watched_item_id = db.Column(
        db.Integer, db.ForeignKey("watched_items.id"), nullable=True
    )
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    resolved_at = db.Column(db.DateTime, nullable=True)


class GameSeason(db.Model):
    """Trimestre temático (legado preservado por linhas históricas)."""

    __tablename__ = "game_seasons"
    __table_args__ = (UniqueConstraint("label", name="uq_game_season_label"),)

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    label = db.Column(db.String(16), nullable=False)  # ex. 2026-Q1
    theme_key = db.Column(db.String(64), nullable=False)
    title = db.Column(db.String(128), nullable=False)
    trophy_icon = db.Column(db.String(8), default="🏆")
    starts_at = db.Column(db.DateTime, nullable=False)
    ends_at = db.Column(db.DateTime, nullable=False)
    missions_json = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)


class SeasonProfileScore(db.Model):
    __tablename__ = "season_profile_scores"
    __table_args__ = (
        UniqueConstraint("season_id", "profile_id", name="uq_season_profile"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    season_id = db.Column(db.Integer, db.ForeignKey("game_seasons.id"), nullable=False)
    profile_id = db.Column(db.Integer, db.ForeignKey("profiles.id"), nullable=False)
    points = db.Column(db.Integer, default=0, nullable=False)
    missions_done_json = db.Column(db.Text, nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)
