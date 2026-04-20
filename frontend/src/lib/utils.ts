export function classNames(...args: Array<string | false | null | undefined>) {
  return args.filter(Boolean).join(" ");
}

export function posterUrl(path: string | null | undefined, size = "w185") {
  if (!path) return "";
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

export function mediaTypeLabel(mt: string) {
  return mt === "tv" ? "Série" : "Filme";
}

export function formatDateBR(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
