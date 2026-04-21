import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { ArrowLeft, Film, Tv, BadgeCheck, Calendar, MapPin, Flame } from "lucide-react";
import {
  GradientTitle,
  NumberTicker,
  ScrollReveal,
  Skeleton,
  EmptyState,
  Chip,
  MediaPoster,
} from "../ds";
import { appUrl } from "../lib/appBase";

interface PersonCredit {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  release_date: string;
  poster_path?: string | null;
  vote_average?: number | null;
  role: string;
}

interface PersonPayload {
  person_id: number;
  name: string;
  profile_path?: string | null;
  biography: string;
  known_for_department: string;
  birthday?: string | null;
  deathday?: string | null;
  place_of_birth?: string;
  popularity?: number | null;
  movie_rows: PersonCredit[];
  tv_rows: PersonCredit[];
  total_credits: number;
}

interface PersonAppProps {
  personId: number;
}

const FILTERS = [
  { id: "all", label: "Todos", icon: <Flame size={12} /> },
  { id: "movie", label: "Cinema", icon: <Film size={12} /> },
  { id: "tv", label: "Televisão", icon: <Tv size={12} /> },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

function formatDateBR(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function yearOf(iso?: string | null) {
  return iso ? iso.slice(0, 4) : "";
}

export default function PersonApp({ personId }: PersonAppProps) {
  const [data, setData] = useState<PersonPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterId>("all");
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const bgY = useTransform(scrollY, [0, 400], [0, reduce ? 0 : 120]);
  const bgOpacity = useTransform(scrollY, [0, 400], [0.4, 0.05]);

  useEffect(() => {
    fetch(appUrl(`/api/person/${personId}`))
      .then((r) => r.json())
      .then((d) => setData(d?.error ? null : d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [personId]);

  const allCredits = useMemo(() => {
    if (!data) return [] as PersonCredit[];
    if (filter === "movie") return data.movie_rows;
    if (filter === "tv") return data.tv_rows;
    return [...data.movie_rows, ...data.tv_rows].sort((a, b) =>
      (b.release_date || "").localeCompare(a.release_date || ""),
    );
  }, [data, filter]);

  if (loading) {
    return (
      <div className="person-root">
        <div className="person-hero">
          <Skeleton width={200} height={200} rounded="full" />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton width="60%" height={48} />
            <Skeleton width="40%" height={20} />
            <Skeleton width="80%" height={16} />
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="person-root">
        <EmptyState
          emoji="👤"
          title="Não foi possível carregar esta pessoa"
          description="Verifique sua conexão ou tente novamente em alguns instantes."
        />
      </div>
    );
  }

  return (
    <div className="person-root">
      <a href="javascript:history.back()" className="person-back">
        <ArrowLeft size={16} /> Voltar
      </a>

      <section className="person-hero" data-rx-theme="violet">
        <motion.div
          className="person-hero-bg"
          aria-hidden="true"
          style={{ y: bgY, opacity: bgOpacity }}
        >
          {data.profile_path ? (
            <img
              src={`https://image.tmdb.org/t/p/w780${data.profile_path}`}
              alt=""
              loading="eager"
              decoding="async"
            />
          ) : null}
        </motion.div>
        <span className="person-hero-vignette" aria-hidden="true" />
        <span className="person-hero-mesh" aria-hidden="true" />

        <div className="person-hero-inner">
          <motion.div
            className="person-photo-wrap"
            initial={reduce ? false : { scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: [0.22, 0.61, 0.36, 1] }}
          >
            {data.profile_path ? (
              <img
                className="person-photo"
                src={`https://image.tmdb.org/t/p/w342${data.profile_path}`}
                alt={data.name}
                loading="eager"
              />
            ) : (
              <div className="person-photo-ph" aria-hidden="true">👤</div>
            )}
            <span className="person-photo-ring" aria-hidden="true" />
          </motion.div>

          <div className="person-hero-body">
            <span className="person-eyebrow">
              <BadgeCheck size={14} /> Perfil cinematográfico
            </span>
            <h1 className="person-name">
              <GradientTitle as="span" size="display" variant="primary" shiny>
                {data.name}
              </GradientTitle>
            </h1>
            {data.known_for_department ? (
              <p className="person-known">{data.known_for_department}</p>
            ) : null}
            <div className="person-meta-row">
              {data.birthday ? (
                <span><Calendar size={12} /> {formatDateBR(data.birthday)}{data.deathday ? ` — ${formatDateBR(data.deathday)}` : ""}</span>
              ) : null}
              {data.place_of_birth ? (
                <span><MapPin size={12} /> {data.place_of_birth}</span>
              ) : null}
            </div>
            <div className="person-metrics">
              <div className="person-metric">
                <span className="person-metric-value">
                  <NumberTicker value={data.total_credits} />
                </span>
                <span className="person-metric-label">créditos totais</span>
              </div>
              <div className="person-metric">
                <span className="person-metric-value">
                  <NumberTicker value={data.movie_rows.length} />
                </span>
                <span className="person-metric-label">filmes</span>
              </div>
              <div className="person-metric">
                <span className="person-metric-value">
                  <NumberTicker value={data.tv_rows.length} />
                </span>
                <span className="person-metric-label">séries</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {data.biography ? (
        <ScrollReveal>
          <section className="person-section">
            <h2 className="person-section-title">Biografia</h2>
            <p className="person-bio">{data.biography}</p>
          </section>
        </ScrollReveal>
      ) : null}

      <ScrollReveal delay={0.05}>
        <div className="person-filters">
          {FILTERS.map((f) => (
            <Chip
              key={f.id}
              active={filter === f.id}
              onClick={() => setFilter(f.id)}
              variant="accent"
              icon={f.icon}
            >
              {f.label}
              {f.id === "movie" && (
                <span className="person-filter-count">{data.movie_rows.length}</span>
              )}
              {f.id === "tv" && (
                <span className="person-filter-count">{data.tv_rows.length}</span>
              )}
            </Chip>
          ))}
        </div>
      </ScrollReveal>

      {allCredits.length === 0 ? (
        <EmptyState
          emoji="🎬"
          title="Sem créditos neste filtro"
          description="Tente outro recorte ou volte ao 'Todos'."
        />
      ) : (
        <ScrollReveal delay={0.1}>
          <div className="person-film-grid">
            {allCredits.map((row, idx) => (
              <motion.a
                key={`${row.media_type}-${row.tmdb_id}`}
                className="person-film-card"
                href={`/details/${row.media_type}/${row.tmdb_id}`}
                initial={reduce ? false : { opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{ duration: 0.4, delay: Math.min(idx * 0.02, 0.4) }}
                whileHover={reduce ? undefined : { y: -4 }}
              >
                <div className="person-film-poster">
                  <MediaPoster path={row.poster_path} size="w185" title={row.title} rounded="md" />
                  <span className="person-film-type" aria-hidden="true">
                    {row.media_type === "movie" ? <Film size={11} /> : <Tv size={11} />}
                  </span>
                </div>
                <div className="person-film-body">
                  <span className="person-film-title" title={row.title}>{row.title}</span>
                  <span className="person-film-role">{row.role}</span>
                  {yearOf(row.release_date) ? (
                    <span className="person-film-date">{yearOf(row.release_date)}</span>
                  ) : null}
                </div>
              </motion.a>
            ))}
          </div>
        </ScrollReveal>
      )}
    </div>
  );
}
