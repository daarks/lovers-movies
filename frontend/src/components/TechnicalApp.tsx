import { useEffect, useState } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import {
  ArrowLeft,
  FolderOpen,
  Star,
  Globe,
  ExternalLink,
  Film,
  Tv,
  Users,
  Megaphone,
  Briefcase,
  PenLine,
  Clapperboard,
  Image as ImageIcon,
} from "lucide-react";
import {
  GradientTitle,
  NumberTicker,
  ScrollReveal,
  Skeleton,
  EmptyState,
  MediaPoster,
} from "../ds";
import { appUrl } from "../lib/appBase";

interface Fact { label: string; value: string }

interface TechnicalPerson {
  id?: number | null;
  name: string;
  profile_path?: string | null;
  job?: string;
  character?: string;
  order?: number | null;
}

interface Similar {
  id: number;
  title: string;
  media_type: "movie" | "tv";
  poster_path?: string | null;
}

interface TechnicalPayload {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  original_title: string;
  tagline: string;
  overview: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date: string;
  genres_list: string[];
  vote_average?: number | null;
  facts: Fact[];
  trailer_key?: string | null;
  homepage?: string;
  imdb_id?: string | null;
  directors: TechnicalPerson[];
  writers: TechnicalPerson[];
  producers: TechnicalPerson[];
  cast: TechnicalPerson[];
  created_by: TechnicalPerson[];
  similar: Similar[];
  is_tv: boolean;
  certification_br?: string | null;
  extra_posters: string[];
  extra_backdrops: string[];
  collection_info?: { id: number; name: string } | null;
}

interface Props {
  mediaType: "movie" | "tv";
  tmdbId: number;
}

function yearOf(iso?: string | null) {
  return iso ? iso.slice(0, 4) : "";
}

function formatDateBR(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function PersonCard({ p, asLink = true, role }: { p: TechnicalPerson; asLink?: boolean; role?: string }) {
  const content = (
    <>
      {p.profile_path ? (
        <img
          className="tech-person-photo"
          src={`https://image.tmdb.org/t/p/w185${p.profile_path}`}
          alt=""
          loading="lazy"
        />
      ) : (
        <div className="tech-person-placeholder" aria-hidden="true">
          {(p.name || "?").charAt(0)}
        </div>
      )}
      <span className="tech-person-name" title={p.name}>{p.name}</span>
      <span className="tech-person-role">{role ?? p.job ?? p.character ?? ""}</span>
    </>
  );
  if (asLink && p.id) {
    return (
      <a className="tech-person-card tech-person-card--link" href={`/pessoa/${p.id}`}>
        {content}
      </a>
    );
  }
  return <div className="tech-person-card">{content}</div>;
}

function HScroll({ title, icon, people, roleKey }: { title: string; icon: React.ReactNode; people: TechnicalPerson[]; roleKey?: "job" | "character" }) {
  if (!people?.length) return null;
  return (
    <ScrollReveal delay={0.05}>
      <section className="tech-section">
        <h2 className="tech-section-title">
          <span className="tech-section-icon" aria-hidden="true">{icon}</span>
          {title}
        </h2>
        <div className="tech-hscroll">
          <ul className="tech-hscroll-track">
            {people.map((p, i) => (
              <li key={`${p.id || "_"}-${p.name}-${i}`} className="tech-hscroll-item">
                <PersonCard p={p} role={roleKey === "character" ? p.character : p.job} />
              </li>
            ))}
          </ul>
        </div>
      </section>
    </ScrollReveal>
  );
}

export default function TechnicalApp({ mediaType, tmdbId }: Props) {
  const [data, setData] = useState<TechnicalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const bgY = useTransform(scrollY, [0, 400], [0, reduce ? 0 : 120]);
  const scale = useTransform(scrollY, [0, 400], [1, reduce ? 1 : 1.08]);

  useEffect(() => {
    fetch(appUrl(`/api/technical/${mediaType}/${tmdbId}`))
      .then((r) => r.json())
      .then((d) => setData(d?.error ? null : d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [mediaType, tmdbId]);

  if (loading) {
    return (
      <div className="tech-root">
        <div className="tech-hero">
          <Skeleton width={180} height={270} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton width="70%" height={48} />
            <Skeleton width="50%" height={20} />
            <Skeleton width="90%" height={20} />
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="tech-root">
        <EmptyState
          emoji="📽️"
          title="Não foi possível carregar a ficha técnica"
          description="Verifique sua conexão ou tente novamente em alguns instantes."
        />
      </div>
    );
  }

  return (
    <div className="tech-root">
      <div className="tech-topbar">
        <a href={`/details/${data.media_type}/${data.tmdb_id}`} className="tech-back">
          <ArrowLeft size={16} /> Voltar aos detalhes
        </a>
        {data.collection_info ? (
          <a
            href={`/colecao/${data.collection_info.id}`}
            className="tech-collection-link"
            title={`Coleção: ${data.collection_info.name}`}
          >
            <FolderOpen size={14} /> {data.collection_info.name}
          </a>
        ) : null}
      </div>

      <section className="tech-hero">
        {data.backdrop_path ? (
          <motion.div className="tech-hero-bg" aria-hidden="true" style={{ y: bgY, scale }}>
            <img
              src={`https://image.tmdb.org/t/p/w1280${data.backdrop_path}`}
              alt=""
              loading="eager"
              decoding="async"
            />
          </motion.div>
        ) : null}
        <span className="tech-hero-vignette" aria-hidden="true" />
        <span className="tech-hero-mesh" aria-hidden="true" />

        <div className="tech-hero-inner">
          <motion.div
            className="tech-poster"
            initial={reduce ? false : { opacity: 0, y: 18, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <MediaPoster path={data.poster_path} size="w342" title={data.title} rounded="lg" />
          </motion.div>
          <div className="tech-head">
            <span className="tech-eyebrow">
              {data.is_tv ? <Tv size={14} /> : <Film size={14} />} Ficha técnica completa
            </span>
            <h1 className="tech-title">
              <GradientTitle as="span" size="display" variant="primary" shiny>
                {data.title}
              </GradientTitle>
            </h1>
            {data.original_title && data.original_title !== data.title ? (
              <p className="tech-original">{data.original_title}</p>
            ) : null}
            {data.tagline ? <p className="tech-tagline">“{data.tagline}”</p> : null}
            <div className="tech-meta-row">
              {yearOf(data.release_date) ? <span className="tech-meta-pill">{yearOf(data.release_date)}</span> : null}
              <span className="tech-meta-pill tech-meta-pill--accent">{data.is_tv ? "Série" : "Filme"}</span>
              {typeof data.vote_average === "number" && data.vote_average > 0 ? (
                <span className="tech-meta-pill tech-meta-pill--gold">
                  <Star size={12} fill="currentColor" />
                  <NumberTicker value={data.vote_average} decimals={1} />
                  <span className="tech-meta-pill-note">TMDB</span>
                </span>
              ) : null}
              {data.certification_br ? (
                <span className={`tech-meta-pill tech-cert tech-cert--${data.certification_br.toLowerCase()}`}>
                  {data.certification_br}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {data.overview ? (
        <ScrollReveal>
          <section className="tech-section">
            <h2 className="tech-section-title">Sinopse</h2>
            <p className="tech-overview">{data.overview}</p>
          </section>
        </ScrollReveal>
      ) : null}

      {(data.genres_list.length > 0 || data.release_date) ? (
        <ScrollReveal delay={0.05}>
          <div className="tech-chips">
            {data.genres_list.map((g) => (
              <span key={g} className="tech-chip">{g}</span>
            ))}
            {data.release_date ? (
              <span className="tech-chip tech-chip--accent">Lançamento: {formatDateBR(data.release_date)}</span>
            ) : null}
          </div>
        </ScrollReveal>
      ) : null}

      {data.facts.length > 0 ? (
        <ScrollReveal delay={0.1}>
          <section className="tech-section">
            <h2 className="tech-section-title">Informações gerais</h2>
            <dl className="tech-facts">
              {data.facts.map((f) => (
                <div key={f.label} className="tech-fact">
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </ScrollReveal>
      ) : null}

      {data.trailer_key ? (
        <ScrollReveal delay={0.1}>
          <section className="tech-section">
            <h2 className="tech-section-title">Trailer</h2>
            <div className="tech-video-wrap">
              <iframe
                className="tech-video"
                src={`https://www.youtube-nocookie.com/embed/${data.trailer_key}`}
                title="Trailer no YouTube"
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </section>
        </ScrollReveal>
      ) : null}

      {(data.homepage || data.imdb_id) ? (
        <div className="tech-links">
          {data.homepage ? (
            <a href={data.homepage} className="tech-external" target="_blank" rel="noopener noreferrer">
              <Globe size={14} /> Site oficial <ExternalLink size={12} />
            </a>
          ) : null}
          {data.imdb_id ? (
            <a href={`https://www.imdb.com/title/${data.imdb_id}/`} className="tech-external" target="_blank" rel="noopener noreferrer">
              IMDb <ExternalLink size={12} />
            </a>
          ) : null}
        </div>
      ) : null}

      <HScroll title="Direção" icon={<Clapperboard size={16} />} people={data.directors} />
      {data.is_tv && data.created_by.length > 0 ? (
        <HScroll title="Criação" icon={<PenLine size={16} />} people={data.created_by} />
      ) : null}
      <HScroll title="Roteiro" icon={<PenLine size={16} />} people={data.writers} />
      <HScroll title="Elenco" icon={<Users size={16} />} people={data.cast} roleKey="character" />
      <HScroll title="Produção" icon={<Briefcase size={16} />} people={data.producers} />

      {(data.extra_posters.length > 0 || data.extra_backdrops.length > 0) ? (
        <ScrollReveal delay={0.1}>
          <section className="tech-section">
            <h2 className="tech-section-title">
              <span className="tech-section-icon" aria-hidden="true"><ImageIcon size={16} /></span>
              Mais imagens
            </h2>
            {data.extra_posters.length > 0 ? (
              <>
                <h3 className="tech-images-subtitle">Pôsteres</h3>
                <div className="tech-images-strip">
                  {data.extra_posters.map((path) => (
                    <a
                      key={path}
                      href={`https://image.tmdb.org/t/p/w780${path}`}
                      className="tech-images-thumb"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img src={`https://image.tmdb.org/t/p/w185${path}`} alt="" loading="lazy" />
                    </a>
                  ))}
                </div>
              </>
            ) : null}
            {data.extra_backdrops.length > 0 ? (
              <>
                <h3 className="tech-images-subtitle">Imagens de fundo</h3>
                <div className="tech-images-strip tech-images-strip--wide">
                  {data.extra_backdrops.map((path) => (
                    <a
                      key={path}
                      href={`https://image.tmdb.org/t/p/w1280${path}`}
                      className="tech-images-thumb tech-images-thumb--backdrop"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img src={`https://image.tmdb.org/t/p/w300${path}`} alt="" loading="lazy" />
                    </a>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        </ScrollReveal>
      ) : null}

      {data.similar.length > 0 ? (
        <ScrollReveal delay={0.12}>
          <section className="tech-section">
            <h2 className="tech-section-title">
              <span className="tech-section-icon" aria-hidden="true"><Megaphone size={16} /></span>
              Títulos semelhantes
            </h2>
            <div className="tech-similar">
              {data.similar.map((s) => (
                <a
                  key={`${s.media_type}-${s.id}`}
                  className="tech-similar-card"
                  href={`/details/${s.media_type}/${s.id}`}
                >
                  <div className="tech-similar-poster">
                    <MediaPoster path={s.poster_path} size="w185" title={s.title} rounded="md" />
                  </div>
                  <span className="tech-similar-title" title={s.title}>{s.title}</span>
                </a>
              ))}
            </div>
          </section>
        </ScrollReveal>
      ) : null}
    </div>
  );
}
