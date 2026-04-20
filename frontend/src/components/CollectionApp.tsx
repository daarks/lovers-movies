import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { ArrowLeft, FolderOpen, Calendar, Star, Clapperboard } from "lucide-react";
import {
  GradientTitle,
  NumberTicker,
  ScrollReveal,
  SurfacePanel,
  Skeleton,
  EmptyState,
  MediaPoster,
  SegmentedToggle,
} from "../ds";

interface CollectionPart {
  tmdb_id: number;
  title: string;
  overview: string;
  release_date: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number | null;
}

interface CollectionPayload {
  collection_id: number;
  name: string;
  overview: string;
  backdrop_path?: string | null;
  poster_path?: string | null;
  parts: CollectionPart[];
}

interface CollectionAppProps {
  collectionId: number;
}

const SORT_OPTIONS = [
  { value: "recent", label: "Mais recentes" },
  { value: "oldest", label: "Mais antigos" },
  { value: "rating", label: "Melhor avaliados" },
] as const;

function yearOf(iso?: string | null) {
  return iso ? iso.slice(0, 4) : "—";
}

export default function CollectionApp({ collectionId }: CollectionAppProps) {
  const [data, setData] = useState<CollectionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"recent" | "oldest" | "rating">("recent");
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const bgY = useTransform(scrollY, [0, 400], [0, reduce ? 0 : 140]);
  const scale = useTransform(scrollY, [0, 400], [1, reduce ? 1 : 1.1]);

  useEffect(() => {
    fetch(`/api/collection/${collectionId}`)
      .then((r) => r.json())
      .then((d) => setData(d?.error ? null : d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [collectionId]);

  const sortedParts = useMemo(() => {
    if (!data) return [] as CollectionPart[];
    const list = [...data.parts];
    if (sort === "recent") list.sort((a, b) => (b.release_date || "").localeCompare(a.release_date || ""));
    else if (sort === "oldest") list.sort((a, b) => (a.release_date || "").localeCompare(b.release_date || ""));
    else list.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    return list;
  }, [data, sort]);

  const avgRating = useMemo(() => {
    if (!data || data.parts.length === 0) return 0;
    const rated = data.parts.filter((p) => typeof p.vote_average === "number" && p.vote_average! > 0);
    if (rated.length === 0) return 0;
    return rated.reduce((acc, p) => acc + (p.vote_average || 0), 0) / rated.length;
  }, [data]);

  if (loading) {
    return (
      <div className="collection-root">
        <div className="collection-hero">
          <Skeleton width="60%" height={44} />
          <Skeleton width="85%" height={20} />
        </div>
        <div className="collection-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={280} />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="collection-root">
        <EmptyState
          emoji="📁"
          title="Coleção não encontrada"
          description="Não conseguimos carregar as partes desta coleção no TMDB."
        />
      </div>
    );
  }

  return (
    <div className="collection-root">
      <a href="javascript:history.back()" className="collection-back">
        <ArrowLeft size={16} /> Voltar
      </a>

      <section className="collection-hero">
        {data.backdrop_path ? (
          <motion.div
            className="collection-hero-bg"
            aria-hidden="true"
            style={{ y: bgY, scale }}
          >
            <img
              src={`https://image.tmdb.org/t/p/w1280${data.backdrop_path}`}
              alt=""
              loading="eager"
              decoding="async"
            />
          </motion.div>
        ) : null}
        <span className="collection-hero-vignette" aria-hidden="true" />
        <span className="collection-hero-mesh" aria-hidden="true" />

        <div className="collection-hero-inner">
          <span className="collection-eyebrow">
            <FolderOpen size={14} /> Coleção · {data.parts.length} título(s)
          </span>
          <h1 className="collection-title">
            <GradientTitle as="span" size="display" variant="primary" shiny>
              {data.name}
            </GradientTitle>
          </h1>
          {data.overview ? <p className="collection-overview">{data.overview}</p> : null}

          <div className="collection-metrics">
            <div className="collection-metric">
              <span className="collection-metric-icon" aria-hidden="true"><Clapperboard size={16} /></span>
              <span className="collection-metric-value"><NumberTicker value={data.parts.length} /></span>
              <span className="collection-metric-label">filmes</span>
            </div>
            {avgRating > 0 ? (
              <div className="collection-metric">
                <span className="collection-metric-icon" aria-hidden="true"><Star size={16} /></span>
                <span className="collection-metric-value">
                  <NumberTicker value={avgRating} decimals={1} />
                </span>
                <span className="collection-metric-label">nota média TMDB</span>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <ScrollReveal>
        <SurfacePanel className="collection-toolbar">
          <SegmentedToggle
            options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={sort}
            onValueChange={(v) => setSort(v as typeof sort)}
          />
        </SurfacePanel>
      </ScrollReveal>

      <ScrollReveal delay={0.05}>
        <div className="collection-grid">
          {sortedParts.map((p, idx) => (
            <motion.a
              key={p.tmdb_id}
              className="collection-card"
              href={`/details/movie/${p.tmdb_id}`}
              initial={reduce ? false : { opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.45, delay: Math.min(idx * 0.04, 0.5) }}
              whileHover={reduce ? undefined : { y: -5, rotateZ: -0.4 }}
            >
              <div className="collection-card-poster">
                <MediaPoster path={p.poster_path} size="w342" title={p.title} rounded="md" />
                <span className="collection-card-gradient" aria-hidden="true" />
                {typeof p.vote_average === "number" && p.vote_average > 0 ? (
                  <span className="collection-card-score">
                    <Star size={10} fill="currentColor" /> {p.vote_average.toFixed(1)}
                  </span>
                ) : null}
              </div>
              <div className="collection-card-body">
                <span className="collection-card-order">Parte {sortedParts.length - idx}</span>
                <h3 className="collection-card-title" title={p.title}>{p.title}</h3>
                <span className="collection-card-date">
                  <Calendar size={11} /> {yearOf(p.release_date)}
                </span>
              </div>
            </motion.a>
          ))}
        </div>
      </ScrollReveal>
    </div>
  );
}
