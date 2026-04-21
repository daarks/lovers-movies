/**
 * Prefixo da aplicação Flask (Werkzeug `request.script_root` / APPLICATION_ROOT).
 *
 * - Em produção com subpath (ex.: `/filmes`), o `body` em `base.html` expõe `data-app-base`.
 * - Em dev com API noutro host: `VITE_APP_BASE=http://127.0.0.1:5000` (CORS tem de estar ok no Flask).
 * - Em dev com Vite: use `server.proxy` em `vite.config.ts` e deixe `data-app-base` vazio.
 */
export function getAppBase(): string {
  const meta = import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> };
  const env =
    (typeof meta.env?.VITE_APP_BASE === "string" && meta.env.VITE_APP_BASE) ||
    (typeof meta.env?.VITE_API_BASE === "string" && meta.env.VITE_API_BASE) ||
    "";
  const fromEnv = String(env).trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  if (typeof document !== "undefined") {
    const fromBody =
      document.body?.dataset?.appBase?.trim() ||
      document.getElementById("swipe-root")?.dataset?.apiPrefix?.trim() ||
      "";
    if (fromBody) return fromBody.replace(/\/$/, "");
  }
  return "";
}

/** Monta URL absoluta de caminho (ex. `/api/swipe/session`) com o prefixo da app. */
export function appUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const base = getAppBase();
  if (!base) return p;
  if (base.startsWith("http://") || base.startsWith("https://")) {
    return `${base.replace(/\/$/, "")}${p}`;
  }
  const baseNorm = base.startsWith("/") ? base : `/${base}`;
  return `${baseNorm.replace(/\/$/, "")}${p}`;
}
