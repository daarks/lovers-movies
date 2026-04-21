import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  RadialBarChart,
  RadialBar,
} from "recharts";
import { BarChart3, Film, Sparkles, Star, Tv, TrendingUp, CalendarRange, Award } from "lucide-react";
import {
  GradientTitle,
  NumberTicker,
  ScrollReveal,
  SurfacePanel,
  EmptyState,
  Skeleton,
  SegmentedToggle,
} from "../ds";
import { appUrl } from "../lib/appBase";

interface GenreRow { name: string; count: number; percent: number }
interface TopRow { id: number; tmdb_id: number; media_type: string; title: string; poster_path?: string | null; rating: number; genres: string }
interface MonthlyRow { key: string; total: number; movie: number; tv: number }
interface DecadeRow { label: string; count: number }

interface StatsPayload {
  total: number;
  n_movie: number;
  n_tv: number;
  pct_movie: number;
  pct_tv: number;
  genres: GenreRow[];
  avg_rating: number;
  rating_distribution: Record<string, number>;
  monthly: MonthlyRow[];
  heatmap: number[][];
  dow_counts: number[];
  top_rated: TopRow[];
  decades: DecadeRow[];
}

const GENRE_COLORS = [
  "#a78bfa",
  "#f472b6",
  "#60a5fa",
  "#fbbf24",
  "#34d399",
  "#f87171",
  "#22d3ee",
  "#e879f9",
  "#fb923c",
  "#818cf8",
];

const DOW_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function monthLabel(key: string) {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  const str = d.toLocaleDateString("pt-BR", { month: "short" });
  return `${str.replace(".", "")}/${y.slice(2)}`;
}

function posterUrl(path: string | null | undefined, size = "w185") {
  if (!path) return "";
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

function HeatmapCell({ value, max }: { value: number; max: number }) {
  const intensity = max > 0 ? value / max : 0;
  const bg = intensity === 0
    ? "rgba(255,255,255,0.03)"
    : `rgba(167, 139, 250, ${Math.max(0.15, intensity * 0.9)})`;
  return (
    <div className="stats-heat-cell" style={{ background: bg }} title={`${value} sessões`} />
  );
}

export default function StatsApp() {
  const [data, setData] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [mediaView, setMediaView] = useState<"all" | "movie" | "tv">("all");
  const reduce = useReducedMotion();

  useEffect(() => {
    fetch(appUrl("/api/stats/overview"))
      .then((r) => r.json())
      .then((d: StatsPayload) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const genrePieData = useMemo(() => {
    if (!data) return [];
    return data.genres.slice(0, 8).map((g, idx) => ({ name: g.name, value: g.count, fill: GENRE_COLORS[idx % GENRE_COLORS.length] }));
  }, [data]);

  const monthlyChartData = useMemo(() => {
    if (!data) return [];
    return data.monthly.map((m) => ({
      name: monthLabel(m.key),
      Filmes: m.movie,
      Séries: m.tv,
    }));
  }, [data]);

  const ratingChart = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.rating_distribution).map(([k, v]) => ({ nota: k, count: v }));
  }, [data]);

  const decadeChart = useMemo(() => {
    if (!data) return [];
    return data.decades.map((d, idx) => ({ ...d, fill: GENRE_COLORS[idx % GENRE_COLORS.length] }));
  }, [data]);

  const heatMax = useMemo(() => {
    if (!data) return 0;
    let max = 0;
    for (const row of data.heatmap) for (const v of row) if (v > max) max = v;
    return max;
  }, [data]);

  const busiestDow = useMemo(() => {
    if (!data) return { label: "—", count: 0 };
    let idx = 0;
    let max = -1;
    data.dow_counts.forEach((v, i) => {
      if (v > max) { max = v; idx = i; }
    });
    return { label: DOW_LABELS[idx], count: max };
  }, [data]);

  const topCardData = useMemo(() => {
    if (!data) return [];
    if (mediaView === "all") return data.top_rated;
    return data.top_rated.filter((t) => t.media_type === mediaView);
  }, [data, mediaView]);

  if (loading) {
    return (
      <div className="stats-root">
        <section className="stats-hero">
          <Skeleton width="60%" height={40} />
          <Skeleton width="40%" height={20} />
        </section>
        <div className="stats-skel-grid">
          <Skeleton width="100%" height={200} />
          <Skeleton width="100%" height={200} />
          <Skeleton width="100%" height={200} />
        </div>
      </div>
    );
  }

  if (!data || data.total === 0) {
    return (
      <div className="stats-root">
        <section className="stats-hero">
          <span className="stats-eyebrow"><BarChart3 size={14} /> Dashboard</span>
          <h1 className="stats-hero-title">
            <GradientTitle as="span" size="xl">Estatísticas</GradientTitle>
          </h1>
          <p className="stats-hero-sub">Avalie filmes ou séries no histórico para começar a ver gráficos aqui.</p>
        </section>
        <EmptyState
          title="Sem dados ainda"
          description="Adicione títulos ao histórico para abrir o painel completo."
          action={<a className="rx-btn rx-btn--primary" href="/">Ir ao histórico</a>}
        />
      </div>
    );
  }

  const displayedGenres = data.genres.slice(0, 10);

  return (
    <div className="stats-root">
      <ScrollReveal>
        <section className="stats-hero">
          <div className="stats-hero-aura" aria-hidden="true" />
          <span className="stats-eyebrow"><Sparkles size={14} /> Dashboard premium</span>
          <h1 className="stats-hero-title">
            <GradientTitle as="span" size="xl">Estatísticas do casal</GradientTitle>
          </h1>
          <p className="stats-hero-sub">
            Explore gêneros, ritmo de sessões, notas e décadas favoritas — tudo em tempo real.
          </p>
          <div className="stats-hero-metrics">
            <div className="stats-metric">
              <span className="stats-metric-icon"><Film size={18} /></span>
              <div>
                <span className="stats-metric-value"><NumberTicker value={data.total} /></span>
                <span className="stats-metric-label">Títulos no total</span>
              </div>
            </div>
            <a href="/historico?media=movie" className="stats-metric stats-metric--link nav-preserve-scroll">
              <span className="stats-metric-icon stats-metric-icon--movie"><Film size={18} /></span>
              <div>
                <span className="stats-metric-value"><NumberTicker value={data.n_movie} /></span>
                <span className="stats-metric-label">Filmes</span>
              </div>
            </a>
            <div className="stats-metric">
              <span className="stats-metric-icon stats-metric-icon--tv"><Tv size={18} /></span>
              <div>
                <span className="stats-metric-value"><NumberTicker value={data.n_tv} /></span>
                <span className="stats-metric-label">Séries</span>
              </div>
            </div>
            <div className="stats-metric">
              <span className="stats-metric-icon stats-metric-icon--star"><Star size={18} /></span>
              <div>
                <span className="stats-metric-value">
                  <NumberTicker value={data.avg_rating} decimals={2} />
                </span>
                <span className="stats-metric-label">Nota média</span>
              </div>
            </div>
          </div>
        </section>
      </ScrollReveal>

      <div className="stats-bento">
        <ScrollReveal>
          <SurfacePanel className="stats-card stats-card--wide">
            <header className="stats-card-head">
              <div>
                <span className="stats-card-eyebrow">Ritmo mensal</span>
                <h2 className="stats-card-title">Últimos meses</h2>
              </div>
              <span className="stats-card-icon"><TrendingUp size={18} /></span>
            </header>
            <div className="stats-chart" style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyChartData} margin={{ top: 10, right: 10, bottom: 4, left: -20 }}>
                  <defs>
                    <linearGradient id="gradMovies" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a78bfa" />
                      <stop offset="100%" stopColor="#7c3aed" />
                    </linearGradient>
                    <linearGradient id="gradTv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f472b6" />
                      <stop offset="100%" stopColor="#db2777" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "rgba(12,14,22,0.92)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }} />
                  <Bar dataKey="Filmes" stackId="a" fill="url(#gradMovies)" radius={[6, 6, 0, 0]} isAnimationActive={!reduce} />
                  <Bar dataKey="Séries" stackId="a" fill="url(#gradTv)" radius={[6, 6, 0, 0]} isAnimationActive={!reduce} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SurfacePanel>
        </ScrollReveal>

        <ScrollReveal delay={0.05}>
          <SurfacePanel className="stats-card">
            <header className="stats-card-head">
              <div>
                <span className="stats-card-eyebrow">Composição</span>
                <h2 className="stats-card-title">Top gêneros</h2>
              </div>
              <span className="stats-card-icon"><Sparkles size={18} /></span>
            </header>
            <div className="stats-chart" style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={genrePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2} isAnimationActive={!reduce}>
                    {genrePieData.map((g, i) => (
                      <Cell key={i} fill={g.fill} stroke="rgba(0,0,0,0.35)" strokeWidth={1} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "rgba(12,14,22,0.92)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="stats-legend">
              {displayedGenres.slice(0, 6).map((g, i) => (
                <li key={g.name} className="stats-legend-row">
                  <span className="stats-legend-dot" style={{ background: GENRE_COLORS[i % GENRE_COLORS.length] }} />
                  <span className="stats-legend-label">{g.name}</span>
                  <span className="stats-legend-count">{g.percent}%</span>
                </li>
              ))}
            </ul>
          </SurfacePanel>
        </ScrollReveal>

        <ScrollReveal delay={0.08}>
          <SurfacePanel className="stats-card">
            <header className="stats-card-head">
              <div>
                <span className="stats-card-eyebrow">Filme × Série</span>
                <h2 className="stats-card-title">Mix do casal</h2>
              </div>
              <span className="stats-card-icon"><Film size={18} /></span>
            </header>
            <div className="stats-chart" style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  innerRadius="38%"
                  outerRadius="100%"
                  startAngle={90}
                  endAngle={-270}
                  data={[
                    { name: "Filmes", value: data.pct_movie, fill: "#a78bfa" },
                    { name: "Séries", value: data.pct_tv, fill: "#f472b6" },
                  ]}
                >
                  <RadialBar dataKey="value" cornerRadius={8} background={{ fill: "rgba(255,255,255,0.05)" }} isAnimationActive={!reduce} />
                  <Tooltip contentStyle={{ background: "rgba(12,14,22,0.92)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }} />
                </RadialBarChart>
              </ResponsiveContainer>
            </div>
            <div className="stats-mix-legend">
              <span><span className="stats-dot" style={{ background: "#a78bfa" }} /> Filmes · {data.pct_movie}%</span>
              <span><span className="stats-dot" style={{ background: "#f472b6" }} /> Séries · {data.pct_tv}%</span>
            </div>
          </SurfacePanel>
        </ScrollReveal>

        <ScrollReveal delay={0.1}>
          <SurfacePanel className="stats-card stats-card--wide">
            <header className="stats-card-head">
              <div>
                <span className="stats-card-eyebrow">Distribuição</span>
                <h2 className="stats-card-title">Notas do casal</h2>
              </div>
              <span className="stats-card-icon"><Star size={18} /></span>
            </header>
            <div className="stats-chart" style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ratingChart} margin={{ top: 10, right: 10, bottom: 4, left: -20 }}>
                  <defs>
                    <linearGradient id="gradRating" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#fbbf24" />
                      <stop offset="100%" stopColor="#f472b6" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="nota" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "rgba(12,14,22,0.92)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }} />
                  <Bar dataKey="count" fill="url(#gradRating)" radius={[6, 6, 0, 0]} isAnimationActive={!reduce} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SurfacePanel>
        </ScrollReveal>

        <ScrollReveal delay={0.12}>
          <SurfacePanel className="stats-card">
            <header className="stats-card-head">
              <div>
                <span className="stats-card-eyebrow">Quando vemos</span>
                <h2 className="stats-card-title">Heatmap semanal</h2>
              </div>
              <span className="stats-card-icon"><CalendarRange size={18} /></span>
            </header>
            <div className="stats-heat">
              <div className="stats-heat-dows">
                {DOW_LABELS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="stats-heat-grid">
                {Array.from({ length: 24 }).map((_, h) => (
                  <div key={h} className="stats-heat-row">
                    {Array.from({ length: 7 }).map((_, dw) => (
                      <HeatmapCell key={dw} value={data.heatmap[h][dw]} max={heatMax} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <p className="stats-heat-foot">
              Dia mais ativo: <strong>{busiestDow.label}</strong> com <strong>{busiestDow.count}</strong> sessões
            </p>
          </SurfacePanel>
        </ScrollReveal>

        <ScrollReveal delay={0.14}>
          <SurfacePanel className="stats-card stats-card--wide">
            <header className="stats-card-head">
              <div>
                <span className="stats-card-eyebrow">Viagem no tempo</span>
                <h2 className="stats-card-title">Décadas favoritas</h2>
              </div>
              <span className="stats-card-icon"><TrendingUp size={18} /></span>
            </header>
            <div className="stats-chart" style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={decadeChart} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis type="number" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                  <Tooltip contentStyle={{ background: "rgba(12,14,22,0.92)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }} />
                  <Bar dataKey="count" radius={[0, 8, 8, 0]} isAnimationActive={!reduce}>
                    {decadeChart.map((d, i) => (
                      <Cell key={i} fill={d.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SurfacePanel>
        </ScrollReveal>

        <ScrollReveal delay={0.16}>
          <SurfacePanel className="stats-card stats-card--full">
            <header className="stats-card-head">
              <div>
                <span className="stats-card-eyebrow">Os prediletos</span>
                <h2 className="stats-card-title">Mais bem avaliados</h2>
              </div>
              <div className="stats-card-actions">
                <SegmentedToggle<"all" | "movie" | "tv">
                  value={mediaView}
                  onValueChange={(v) => setMediaView(v)}
                  options={[
                    { value: "all", label: "Todos" },
                    { value: "movie", label: "Filmes" },
                    { value: "tv", label: "Séries" },
                  ]}
                  ariaLabel="Filtrar por mídia"
                />
              </div>
            </header>
            <div className="stats-top-grid">
              {topCardData.length === 0 && (
                <p className="stats-muted">Nenhum título nesta categoria ainda.</p>
              )}
              {topCardData.map((t, idx) => (
                <motion.a
                  key={t.id}
                  className="stats-top-card"
                  href={`/details/${t.media_type}/${t.tmdb_id}`}
                  initial={reduce ? false : { opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.32, delay: idx * 0.04, ease: [0.22, 0.61, 0.36, 1] }}
                >
                  {t.poster_path ? (
                    <img src={posterUrl(t.poster_path, "w185")} alt={t.title} loading="lazy" />
                  ) : (
                    <div className="stats-top-ph">🎬</div>
                  )}
                  <span className="stats-top-rank"><Award size={14} /> #{idx + 1}</span>
                  <div className="stats-top-meta">
                    <span className="stats-top-title" title={t.title}>{t.title}</span>
                    <span className="stats-top-rating">
                      <Star size={12} fill="#fbbf24" stroke="#fbbf24" />
                      <NumberTicker value={t.rating} decimals={1} />
                    </span>
                  </div>
                </motion.a>
              ))}
            </div>
          </SurfacePanel>
        </ScrollReveal>
      </div>
    </div>
  );
}
