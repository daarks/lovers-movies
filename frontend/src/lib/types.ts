/** Tipos compartilhados entre as ilhas React. */

export interface SearchHit {
  id: number;
  title: string;
  media_type: "movie" | "tv";
  poster_path?: string | null;
  release_date?: string | null;
  overview?: string | null;
}

export interface HomeMediaItem {
  id: number;
  title: string;
  media_type: "movie" | "tv";
  poster_path?: string | null;
  release_date?: string | null;
}

export interface HomeRecentItem {
  id: number;
  tmdb_id: number;
  title: string;
  media_type: "movie" | "tv";
  poster_path?: string | null;
  rating?: number | null;
  added_at?: string | null;
}

export interface HomeFeed {
  trending: HomeMediaItem[];
  now_playing: HomeMediaItem[];
  upcoming: HomeMediaItem[];
  recent: HomeRecentItem[];
  hero_message: string;
}

export interface DetailsCast {
  id: number;
  name: string;
  character: string;
  profile_path?: string | null;
  order?: number;
}

export interface DetailsVideo {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official: boolean;
}

export interface DetailsRecommendation {
  id: number;
  media_type: "movie" | "tv";
  title: string;
  poster_path?: string | null;
  release_date?: string | null;
  vote_average?: number | null;
}

export interface DetailsPayload {
  media_type: "movie" | "tv";
  tmdb_id: number;
  title: string;
  original_title: string;
  tagline: string;
  overview: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date: string;
  duration_label: string | null;
  genres: string[];
  vote_average: number | null;
  vote_count: number | null;
  popularity: number | null;
  certification_br: string | null;
  cast: DetailsCast[];
  directors: string[];
  writers: string[];
  videos: DetailsVideo[];
  recommendations: DetailsRecommendation[];
  keywords: Array<{ id: number; name: string }>;
  collection: { id: number; name: string } | null;
  saved: { id: number; rating: number | null } | null;
  watch_later: { id: number } | null;
  theme_slug: string | null;
}

export interface HistoryItem {
  id: number;
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  original_title?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string | null;
  genres?: string | null;
  vote_average?: number | null;
  rating: number | null;
  added_at?: string | null;
}

export interface HistoryResponse {
  items: HistoryItem[];
  total: number;
}

export interface WatchLaterItem {
  id: number;
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  original_title?: string | null;
  overview?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string | null;
  genres?: string | null;
  vote_average?: number | null;
  added_at?: string | null;
}

export interface WatchLaterResponse {
  items: WatchLaterItem[];
  total: number;
}

export interface ComparePick {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title?: string;
  poster_path?: string | null;
  year?: string | number | null;
  release_date?: string | null;
  vote?: number | null;
  runtime_label?: string | null;
  genres_label?: string | null;
  directors_label?: string | null;
  countries_label?: string | null;
  overview?: string | null;
}

export interface CompareCommonMember {
  id: number;
  name: string;
}

export interface CompareResponse {
  left: ComparePick | null;
  right: ComparePick | null;
  common: CompareCommonMember[];
  error?: string;
}

export interface SeasonBonus {
  amount: number;
  theme_key: string | null;
  matched_genres: string[];
}

export interface AchievementItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  rarity: "common" | "rare" | "epic" | "legendary" | "seasonal" | string;
  xp_reward: number;
  progress: number;
  target: number;
  unlocked: boolean;
  group: "geral" | "sazonal" | string;
  rule_type?: string | null;
}

export interface SeasonBonusGenre {
  id: number | string;
  name: string;
}

export interface SeasonalAchievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  rarity: string;
  xp_reward: number;
  rule_type?: string | null;
  progress: number;
  target: number;
  unlocked: boolean;
}

export interface SeasonCuratedItem {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  poster_path?: string | null;
  year?: string | null;
  vote_average?: number | null;
}

export interface SeasonListBlock {
  id?: string;
  keyword_id?: number;
  title: string;
  subtitle?: string;
  items: SeasonCuratedItem[];
}

export interface SeasonCurrentPayload {
  enabled: boolean;
  label?: string;
  theme_key?: string;
  title?: string;
  emoji?: string;
  tagline?: string;
  long_intro?: string;
  xp_multiplier?: number;
  bonus_genres?: SeasonBonusGenre[];
  starts_at?: string | null;
  ends_at?: string | null;
  progress_pct?: number;
  seasonal_achievements?: SeasonalAchievement[];
  curated_lists?: SeasonListBlock[];
  keyword_showcases?: SeasonListBlock[];
}

export interface ProfileState {
  enabled: boolean;
  couple_label: string;
  total_xp: number;
  level: number;
  level_title: string;
  level_into: number;
  level_need: number;
  profiles: Array<{
    slug: "a" | "b" | string;
    display_name: string;
    season_points?: number;
  }>;
  recent_xp: Array<{
    amount: number;
    reason: string;
    reason_pt: string;
    created_at: string;
    ref?: string | null;
  }>;
  recent_unlocks: Array<{
    achievement_id: string;
    title: string;
    icon: string;
    rarity: string;
    unlocked_at: string;
  }>;
  season?: {
    label: string;
    theme_key: string;
    title: string;
    emoji: string;
    starts_at: string;
    ends_at: string;
    progress_pct: number;
  } | null;
}
