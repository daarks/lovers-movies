import { useEffect, useMemo, useRef, useState } from "react";
import { Tabs } from "@base-ui-components/react/tabs";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Calendar,
  Clock,
  Film,
  FileText,
  Folder,
  Play,
  Sparkles,
  Star,
  Tv,
  Users,
} from "lucide-react";
import {
  Chip,
  EmptyState,
  GradientTitle,
  MagneticButton,
  MediaPoster,
  NumberTicker,
  ScrollReveal,
  Skeleton,
  SurfacePanel,
  TiltCard,
  ToastProvider,
  useToast,
  cx,
} from "../ds";
import { appUrl } from "../lib/appBase";
import { apiGet } from "../lib/api";
import type { DetailsPayload, DetailsRecommendation } from "../lib/types";
import { formatDateBR } from "../lib/utils";

interface DetailsAppProps {
  mediaType: "movie" | "tv";
  tmdbId: number;
}

function tabLabel(media: "movie" | "tv"): string {
  return media === "tv" ? "Série" : "Filme";
}

function CastCard({
  person,
}: {
  person: DetailsPayload["cast"][number];
}) {
  return (
    <a href={`/pessoa/${person.id}`} className="dx-cast-card">
      <div className="dx-cast-avatar">
        {person.profile_path ? (
          <img
            src={`https://image.tmdb.org/t/p/w185${person.profile_path}`}
            alt=""
            loading="lazy"
          />
        ) : (
          <span aria-hidden="true">{person.name.slice(0, 1)}</span>
        )}
      </div>
      <div className="dx-cast-body">
        <strong>{person.name}</strong>
        {person.character ? <span>{person.character}</span> : null}
      </div>
    </a>
  );
}

function RecCard({ rec }: { rec: DetailsRecommendation }) {
  return (
    <a href={`/details/${rec.media_type}/${rec.id}`} className="dx-rec-card">
      <TiltCard className="dx-rec-poster" glare={false} maxTilt={6} scale={1.03}>
        <MediaPoster path={rec.poster_path ?? undefined} title={rec.title} size="w342" />
      </TiltCard>
      <span className="dx-rec-title">{rec.title}</span>
      {rec.vote_average != null ? (
        <span className="dx-rec-meta">
          <Star size={12} /> {rec.vote_average.toFixed(1)}
        </span>
      ) : null}
    </a>
  );
}

function DetailsInner({ mediaType, tmdbId }: DetailsAppProps) {
  const [data, setData] = useState<DetailsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("synopsis");
  const [wlPending, setWlPending] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { toast } = useToast();
  const { scrollY } = useScroll();
  const bgY = useTransform(scrollY, [0, 400], [0, reduced ? 0 : 80]);
  const bgScale = useTransform(scrollY, [0, 400], [1, reduced ? 1 : 1.08]);
  const heroOpacity = useTransform(scrollY, [0, 260], [1, 0.6]);

  useEffect(() => {
    const ctrl = new AbortController();
    apiGet<DetailsPayload>(`/api/details/${mediaType}/${tmdbId}`, { signal: ctrl.signal })
      .then(setData)
      .catch((e) => setError(e?.message ?? "Erro ao carregar."));
    return () => ctrl.abort();
  }, [mediaType, tmdbId]);

  const year = useMemo(() => {
    if (!data?.release_date) return null;
    const y = data.release_date.slice(0, 4);
    return y || null;
  }, [data?.release_date]);

  function scrollToReview() {
    const el = document.getElementById("avaliacao");
    if (el) el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }

  async function toggleWatchLater() {
    if (!data || wlPending) return;
    setWlPending(true);
    try {
      if (data.watch_later) {
        const form = new FormData();
        form.append("return_to", "details");
        const res = await fetch(appUrl(`/watch-later/remove/${data.watch_later.id}`), {
          method: "POST",
          body: form,
          headers: { "X-Requested-With": "fetch" },
        });
        if (!res.ok && res.status !== 302) throw new Error("Falha ao retirar da fila.");
        setData({ ...data, watch_later: null });
        toast({ title: "Retirado da fila", kind: "success" });
      } else {
        const form = new FormData();
        form.append("tmdb_id", String(data.tmdb_id));
        form.append("media_type", data.media_type);
        form.append("title", data.title);
        form.append("original_title", data.original_title);
        form.append("overview", data.overview);
        form.append("poster_path", data.poster_path ?? "");
        form.append("backdrop_path", data.backdrop_path ?? "");
        form.append("release_date", data.release_date);
        form.append("genres", data.genres.join(", "));
        form.append("vote_average", data.vote_average != null ? String(data.vote_average) : "");
        const res = await fetch(appUrl("/watch-later/add"), {
          method: "POST",
          body: form,
          headers: { "X-Requested-With": "fetch" },
          redirect: "manual",
        });
        if (!res.ok && res.status !== 0 && res.status !== 302 && res.type !== "opaqueredirect") {
          throw new Error("Falha ao salvar.");
        }
        // recarrega o payload para pegar o id gerado (endpoint redireciona)
        const refreshed = await apiGet<DetailsPayload>(`/api/details/${mediaType}/${tmdbId}`);
        setData(refreshed);
        toast({ title: "Salvo em Assistir depois", kind: "success" });
      }
    } catch (err) {
      toast({
        title: "Ops",
        description: (err as Error).message,
        kind: "error",
      });
    } finally {
      setWlPending(false);
    }
  }

  if (error) {
    return (
      <div className="rx-root dx-root">
        <EmptyState
          emoji="🎞️"
          title="Não conseguimos carregar este título"
          description={error}
          action={
            <MagneticButton href="/" variant="ghost">
              Voltar para a home
            </MagneticButton>
          }
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rx-root dx-root dx-loading">
        <Skeleton height={360} rounded="lg" />
        <div className="dx-loading-inner">
          <Skeleton height={30} width="60%" />
          <Skeleton height={14} width="40%" />
          <Skeleton height={12} width="70%" />
          <Skeleton height={12} width="55%" />
        </div>
      </div>
    );
  }

  const vote = data.vote_average ?? 0;
  const hasTrailers = data.videos.length > 0;
  const wlLabel = data.watch_later ? "Retirar da fila" : "Assistir depois";
  const WlIcon = data.watch_later ? BookmarkCheck : Bookmark;

  return (
    <div className="rx-root dx-root" data-rx-theme={data.theme_slug || undefined}>
      <motion.section
        ref={heroRef}
        className="dx-hero"
        style={{ opacity: heroOpacity }}
      >
        {data.backdrop_path ? (
          <motion.div className="dx-hero-backdrop" style={{ y: bgY, scale: bgScale }} aria-hidden="true">
            <img
              src={`https://image.tmdb.org/t/p/w1280${data.backdrop_path}`}
              alt=""
              loading="eager"
              decoding="async"
            />
          </motion.div>
        ) : null}
        <span className="dx-hero-grad" aria-hidden="true" />
        <span className="dx-hero-mesh" aria-hidden="true" />

        <button
          type="button"
          className="dx-hero-back"
          onClick={() => window.history.back()}
          aria-label="Voltar"
        >
          <ArrowLeft size={18} aria-hidden="true" /> Voltar
        </button>

        <div className="dx-hero-inner">
          <TiltCard className="dx-hero-poster" glare={true} maxTilt={9} scale={1.02}>
            <MediaPoster path={data.poster_path ?? undefined} title={data.title} size="w500" rounded="lg" />
          </TiltCard>
          <div className="dx-hero-head">
            <p className="rx-eyebrow">
              {tabLabel(data.media_type)}
              {year ? <> · {year}</> : null}
              {data.certification_br ? <> · {data.certification_br}</> : null}
            </p>
            <GradientTitle as="h1" size="xl" className="dx-hero-title">
              {data.title}
            </GradientTitle>
            {data.original_title && data.original_title !== data.title ? (
              <p className="dx-hero-original">{data.original_title}</p>
            ) : null}
            {data.tagline ? <p className="dx-hero-tagline">“{data.tagline}”</p> : null}
            <div className="dx-hero-meta">
              {data.vote_average != null ? (
                <span className="dx-hero-score" title="Nota TMDB">
                  <Star size={14} aria-hidden="true" />
                  <NumberTicker value={vote} decimals={1} duration={1.2} />
                  <span className="dx-hero-score-denom">/10</span>
                </span>
              ) : null}
              {data.duration_label ? (
                <span className="dx-hero-meta-pill">
                  <Clock size={14} aria-hidden="true" /> {data.duration_label}
                </span>
              ) : null}
              {data.release_date ? (
                <span className="dx-hero-meta-pill">
                  <Calendar size={14} aria-hidden="true" /> {formatDateBR(data.release_date)}
                </span>
              ) : null}
            </div>

            <div className="dx-hero-actions">
              <MagneticButton
                as="button"
                type="button"
                variant={data.watch_later ? "glass" : "primary"}
                shine
                onClick={toggleWatchLater}
                disabled={wlPending}
              >
                <WlIcon size={16} aria-hidden="true" /> {wlLabel}
              </MagneticButton>
              <MagneticButton as="button" type="button" variant="glass" shine={false} onClick={scrollToReview}>
                <Sparkles size={16} aria-hidden="true" /> {data.saved ? "Editar avaliação" : "Avaliar"}
              </MagneticButton>
              <MagneticButton
                href={`/details/${data.media_type}/${data.tmdb_id}/ficha-tecnica`}
                variant="ghost"
                shine={false}
              >
                <FileText size={16} aria-hidden="true" /> Ficha técnica
              </MagneticButton>
              {data.collection ? (
                <MagneticButton
                  href={`/colecao/${data.collection.id}`}
                  variant="ghost"
                  shine={false}
                >
                  <Folder size={16} aria-hidden="true" /> {data.collection.name}
                </MagneticButton>
              ) : null}
            </div>

            <div className="dx-hero-chips">
              {data.genres.map((g) => (
                <Chip key={g} variant="accent" active>
                  {g}
                </Chip>
              ))}
              {data.directors.length > 0 ? (
                <Chip variant="soft" disabled aria-disabled="true" tabIndex={-1}>
                  <Users size={12} aria-hidden="true" />
                  {data.directors.slice(0, 2).join(", ")}
                </Chip>
              ) : null}
            </div>
          </div>
        </div>
      </motion.section>

      <div className="dx-body">
        <Tabs.Root value={tab} onValueChange={(v) => setTab(String(v))}>
          <Tabs.List className="dx-tabs-list" aria-label="Conteúdo">
            <Tabs.Tab value="synopsis" className="dx-tab">Sinopse</Tabs.Tab>
            <Tabs.Tab value="cast" className="dx-tab">Elenco</Tabs.Tab>
            <Tabs.Tab value="similar" className="dx-tab">Similares</Tabs.Tab>
            <Tabs.Tab value="trailers" className="dx-tab" disabled={!hasTrailers}>Trailers</Tabs.Tab>
            <Tabs.Tab value="sheet" className="dx-tab">Ficha</Tabs.Tab>
            <Tabs.Indicator className="dx-tab-indicator" />
          </Tabs.List>

          <Tabs.Panel value="synopsis" className="dx-panel">
            <SurfacePanel variant="plate" className="dx-panel-panel" aura>
              {data.overview ? (
                <p className="dx-overview">{data.overview}</p>
              ) : (
                <p className="dx-overview dx-overview--empty">Sem sinopse disponível.</p>
              )}
              {data.keywords.length > 0 ? (
                <div className="dx-keywords">
                  {data.keywords.map((k) => (
                    <Chip key={k.id} variant="soft" disabled tabIndex={-1}>
                      {k.name}
                    </Chip>
                  ))}
                </div>
              ) : null}
              {(data.directors.length > 0 || data.writers.length > 0) ? (
                <dl className="dx-credits-mini">
                  {data.directors.length > 0 ? (
                    <>
                      <dt>Direção</dt>
                      <dd>{data.directors.join(", ")}</dd>
                    </>
                  ) : null}
                  {data.writers.length > 0 ? (
                    <>
                      <dt>Roteiro</dt>
                      <dd>{data.writers.slice(0, 6).join(", ")}</dd>
                    </>
                  ) : null}
                </dl>
              ) : null}
            </SurfacePanel>
          </Tabs.Panel>

          <Tabs.Panel value="cast" className="dx-panel">
            {data.cast.length === 0 ? (
              <EmptyState emoji="🎭" title="Sem elenco cadastrado" />
            ) : (
              <div className="dx-cast-grid">
                {data.cast.map((p, i) => (
                  <ScrollReveal key={p.id} delay={Math.min(i * 0.03, 0.2)}>
                    <CastCard person={p} />
                  </ScrollReveal>
                ))}
              </div>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="similar" className="dx-panel">
            {data.recommendations.length === 0 ? (
              <EmptyState emoji="🔍" title="Sem recomendações ainda" />
            ) : (
              <div className="rx-scroll-x dx-rec-scroll">
                {data.recommendations.map((rec, i) => (
                  <ScrollReveal key={`${rec.media_type}-${rec.id}`} delay={Math.min(i * 0.03, 0.2)}>
                    <RecCard rec={rec} />
                  </ScrollReveal>
                ))}
              </div>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="trailers" className="dx-panel">
            {data.videos.length === 0 ? (
              <EmptyState emoji="🎬" title="Sem trailers" />
            ) : (
              <div className="dx-videos-grid">
                {data.videos.map((v) => (
                  <a
                    key={v.id}
                    className="dx-video-card"
                    href={`https://www.youtube.com/watch?v=${v.key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div className="dx-video-thumb">
                      <img
                        src={`https://img.youtube.com/vi/${v.key}/hqdefault.jpg`}
                        alt=""
                        loading="lazy"
                      />
                      <span className="dx-video-play" aria-hidden="true"><Play size={22} /></span>
                    </div>
                    <span className="dx-video-title">{v.name}</span>
                    <span className="dx-video-meta">
                      {v.type} {v.official ? "· oficial" : ""}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="sheet" className="dx-panel">
            <SurfacePanel variant="plate" className="dx-panel-panel" aura>
              <h3 className="dx-panel-heading">Ficha rápida</h3>
              <dl className="dx-sheet-dl">
                <dt>Tipo</dt>
                <dd>
                  {data.media_type === "movie" ? (
                    <><Film size={12} /> Filme</>
                  ) : (
                    <><Tv size={12} /> Série</>
                  )}
                </dd>
                <dt>Lançamento</dt>
                <dd>{data.release_date ? formatDateBR(data.release_date) : "—"}</dd>
                {data.duration_label ? (
                  <>
                    <dt>Duração</dt>
                    <dd>{data.duration_label}</dd>
                  </>
                ) : null}
                {data.certification_br ? (
                  <>
                    <dt>Classificação BR</dt>
                    <dd>{data.certification_br}</dd>
                  </>
                ) : null}
                {data.popularity != null ? (
                  <>
                    <dt>Popularidade</dt>
                    <dd><NumberTicker value={data.popularity} decimals={1} duration={1.2} /></dd>
                  </>
                ) : null}
                {data.vote_count != null ? (
                  <>
                    <dt>Votos TMDB</dt>
                    <dd><NumberTicker value={data.vote_count} duration={1.2} /></dd>
                  </>
                ) : null}
              </dl>
              <p>
                <a
                  href={`/details/${data.media_type}/${data.tmdb_id}/ficha-tecnica`}
                  className={cx("rx-btn rx-btn--glass rx-btn--sm")}
                >
                  Ver ficha técnica completa
                </a>
              </p>
            </SurfacePanel>
          </Tabs.Panel>
        </Tabs.Root>
      </div>
    </div>
  );
}

export default function DetailsApp(props: DetailsAppProps) {
  return (
    <ToastProvider>
      <DetailsInner {...props} />
    </ToastProvider>
  );
}
