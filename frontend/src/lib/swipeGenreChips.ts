/** Chips TMDB (mesma gramática visual que Sugestões / Ver depois), sem “Qualquer” nem keyword-only. */

export interface SwipeGenreChip {
  genreId?: string;
  keywordId?: string;
  label: string;
  theme: string;
  emoji: string;
}

export const SWIPE_GENRE_CHIPS: SwipeGenreChip[] = [
  { genreId: "27", label: "Terror", theme: "terror", emoji: "👻" },
  { genreId: "18", label: "Drama", theme: "drama", emoji: "🎭" },
  { genreId: "53", label: "Suspense", theme: "suspense", emoji: "🕵️" },
  { genreId: "28", label: "Ação", theme: "acao", emoji: "💥" },
  { genreId: "12", label: "Aventura", theme: "aventura", emoji: "🗺️" },
  { genreId: "16", label: "Animação", theme: "animacao", emoji: "🎨" },
  { genreId: "878", label: "Ficção Científica", theme: "ficcao", emoji: "🚀" },
  { genreId: "10766", label: "Novela", theme: "novela", emoji: "💌" },
  { genreId: "80", label: "Policial", theme: "policial", emoji: "🔫" },
  { genreId: "35", label: "Comédia", theme: "comedia", emoji: "😂" },
  { genreId: "10749", label: "Romance", theme: "romance", emoji: "💘" },
];

export function swipeGenreChipKey(chip: SwipeGenreChip): string {
  if (chip.keywordId) return `k:${chip.keywordId}`;
  if (chip.genreId) return `g:${chip.genreId}`;
  return "";
}
