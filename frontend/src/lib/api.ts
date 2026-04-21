import { appUrl } from "./appBase";

/** Cliente fetch mínimo para os endpoints JSON do Flask. */
export type FetchOpts = {
  signal?: AbortSignal;
  params?: Record<string, string | number | boolean | null | undefined>;
  /** Tempo máximo de espera (ms). Evita UI presa em skeleton se a rede travar. */
  timeoutMs?: number;
};

function buildUrl(path: string, params?: FetchOpts["params"]) {
  const abs = appUrl(path);
  if (!params) return abs;
  const u = new URL(abs, window.location.origin);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  return u.pathname + (u.search ? u.search : "");
}

function mergeAbortSignals(outer: AbortSignal, inner: AbortSignal): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "any" in AbortSignal && typeof (AbortSignal as any).any === "function") {
    return (AbortSignal as any).any([outer, inner]);
  }
  const merged = new AbortController();
  const onAbort = () => {
    try {
      merged.abort();
    } catch {
      /* ignore */
    }
  };
  if (outer.aborted || inner.aborted) {
    merged.abort();
    return merged.signal;
  }
  outer.addEventListener("abort", onAbort, { once: true });
  inner.addEventListener("abort", onAbort, { once: true });
  return merged.signal;
}

export async function apiGet<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const url = buildUrl(path, opts.params);
  const timeoutMs = opts.timeoutMs ?? 28_000;
  const timeoutCtrl = new AbortController();
  const tid = window.setTimeout(() => timeoutCtrl.abort(), timeoutMs);
  const signal = opts.signal ? mergeAbortSignals(opts.signal, timeoutCtrl.signal) : timeoutCtrl.signal;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      throw new Error("Tempo esgotado ao falar com o servidor. Verifique a rede ou tente de novo.");
    }
    throw e;
  } finally {
    window.clearTimeout(tid);
  }

  if (!res.ok) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* ignore */
    }
    const message =
      (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${res.status}`) || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}
