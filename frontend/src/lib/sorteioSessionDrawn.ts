/**
 * Histórico de sorteios na aba atual (sessionStorage).
 * Fechar a aba ou abrir noutro dispositivo não compartilha esta lista.
 */
const STORAGE_KEY = "movies_app_sorteio_drawn_v1";
const MAX_ENTRIES = 400;

export type SorteioDrawnEntry = { id: number; media_type: "movie" | "tv" };

function keyOf(e: SorteioDrawnEntry): string {
  return `${e.media_type}:${e.id}`;
}

export function loadSorteioDrawn(): SorteioDrawnEntry[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: SorteioDrawnEntry[] = [];
    for (const x of parsed) {
      if (!x || typeof x !== "object") continue;
      const o = x as { id?: unknown; media_type?: unknown };
      const mt = o.media_type === "tv" ? "tv" : o.media_type === "movie" ? "movie" : null;
      if (!mt) continue;
      const id = typeof o.id === "number" && Number.isFinite(o.id) ? o.id : Number(o.id);
      if (!Number.isFinite(id)) continue;
      out.push({ id: Math.trunc(id), media_type: mt });
    }
    return out;
  } catch {
    return [];
  }
}

export function rememberSorteioDrawn(entry: SorteioDrawnEntry): void {
  try {
    const cur = loadSorteioDrawn();
    const k = keyOf(entry);
    if (cur.some((e) => keyOf(e) === k)) return;
    cur.push(entry);
    const trimmed = cur.length > MAX_ENTRIES ? cur.slice(-MAX_ENTRIES) : cur;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearSorteioDrawn(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
