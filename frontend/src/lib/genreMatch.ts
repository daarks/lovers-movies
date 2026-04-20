/**
 * Helpers compartilhados para casar gêneros locais com a CSV retornada pelo Flask.
 * Mantém o mesmo comportamento do filtro Jinja antigo em app.js.
 */

const GENRE_KEYWORDS: Record<string, string[]> = {
  all: [],
  "": [],
  terror: ["terror", "horror"],
  drama: ["drama"],
  suspense: ["suspense", "thriller"],
  acao: ["acao", "action"],
  aventura: ["aventura", "adventure"],
  animacao: ["animacao", "animation"],
  ficcao: ["ficcao cientifica", "ficção científica", "science fiction", "sci-fi"],
  novela: ["novela", "soap"],
  policial: ["policial", "crime"],
  comedia: ["comedia", "comedy"],
  romance: ["romance"],
};

function foldAccents(str: string) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function genresMatchFilter(rawGenresCsv: string | null | undefined, genreKey: string): boolean {
  const kws = GENRE_KEYWORDS[genreKey];
  if (!kws || !kws.length) return true;
  const hay = foldAccents((rawGenresCsv || "").replace(/,/g, " "));
  return kws.some((k) => hay.indexOf(foldAccents(k)) !== -1);
}

export const GENRE_CHIPS = [
  { value: "", label: "Qualquer", emoji: "🎬" },
  { value: "terror", label: "Terror", emoji: "👻" },
  { value: "drama", label: "Drama", emoji: "🎭" },
  { value: "suspense", label: "Suspense", emoji: "🕵️" },
  { value: "acao", label: "Ação", emoji: "💥" },
  { value: "aventura", label: "Aventura", emoji: "🗺️" },
  { value: "animacao", label: "Animação", emoji: "🎨" },
  { value: "ficcao", label: "Ficção científica", emoji: "🚀" },
  { value: "novela", label: "Novela", emoji: "💌" },
  { value: "policial", label: "Policial", emoji: "🔫" },
  { value: "comedia", label: "Comédia", emoji: "😂" },
  { value: "romance", label: "Romance", emoji: "💘" },
];
