import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Build de múltiplas "ilhas" React por rota do Flask, com chunks compartilhados.
// Cada template Jinja carrega seu entry via helper `vite_entry_tags()`.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const flaskProxy = env.VITE_FLASK_PROXY_TARGET || "http://127.0.0.1:5000";

  return {
  plugins: [react()],
  base: "/static/build/",
  server: {
    proxy: {
      // Dev: `npm run dev` em :5173 — pedidos à API Flask sem 404 no Vite.
      "^/api/": { target: flaskProxy, changeOrigin: true },
      "^/suggestions": { target: flaskProxy, changeOrigin: true },
      "^/watch-later": { target: flaskProxy, changeOrigin: true },
      "^/search": { target: flaskProxy, changeOrigin: true },
      "^/static/data/": { target: flaskProxy, changeOrigin: true },
    },
  },
  build: {
    outDir: resolve(__dirname, "../app/static/build"),
    emptyOutDir: true,
    manifest: "manifest.json",
    cssCodeSplit: true,
    rollupOptions: {
      input: {
        // Chrome global (drawer, bottom nav, toasts) — montado no base.html.
        chrome: resolve(__dirname, "src/entries/chrome.tsx"),

        // Ilhas já migradas na fase anterior.
        comparar: resolve(__dirname, "src/entries/comparar.tsx"),
        perfil: resolve(__dirname, "src/entries/perfil.tsx"),
        conquistas: resolve(__dirname, "src/entries/conquistas.tsx"),

        // Novas ilhas (fase premium).
        home: resolve(__dirname, "src/entries/home.tsx"),
        details: resolve(__dirname, "src/entries/details.tsx"),
        suggestions: resolve(__dirname, "src/entries/suggestions.tsx"),
        history: resolve(__dirname, "src/entries/history.tsx"),
        watchLater: resolve(__dirname, "src/entries/watch_later.tsx"),
        calendar: resolve(__dirname, "src/entries/calendar.tsx"),
        stats: resolve(__dirname, "src/entries/stats.tsx"),
        swipe: resolve(__dirname, "src/entries/swipe.tsx"),
        bets: resolve(__dirname, "src/entries/bets.tsx"),
        betDetail: resolve(__dirname, "src/entries/bet_detail.tsx"),
        map: resolve(__dirname, "src/entries/map.tsx"),
        season: resolve(__dirname, "src/entries/season.tsx"),
        person: resolve(__dirname, "src/entries/person.tsx"),
        collection: resolve(__dirname, "src/entries/collection.tsx"),
        technical: resolve(__dirname, "src/entries/technical.tsx"),
        welcome: resolve(__dirname, "src/entries/welcome.tsx"),
      },
      output: {
        // Agrupamos num único vendor-ui todas as libs React-UI que se entre-importam
        // (base-ui + floating-ui + motion + react-use-measure). Separar base-ui
        // de react estava causando um ciclo ESM (vendor-react <-> vendor-baseui),
        // que deixa exports em TDZ e faz React.useState virar undefined no boot.
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            if (id.includes("/src/ds/")) return "ds-core";
            return undefined;
          }
          // Normaliza separador para facilitar o match independente de SO.
          const norm = id.replace(/\\/g, "/");
          // Core do React (react, react-dom, scheduler). Match com path / para
          // NÃO pegar @floating-ui/react, react-use-measure etc.
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(norm)) {
            return "vendor-react";
          }
          // Ecossistema UI que depende de react e se auto-importa.
          if (
            norm.includes("@base-ui-components") ||
            norm.includes("@floating-ui") ||
            norm.includes("framer-motion") ||
            norm.includes("motion-dom") ||
            norm.includes("motion-utils") ||
            norm.includes("react-use-measure")
          ) {
            return "vendor-ui";
          }
          if (norm.includes("lucide-react")) return "vendor-icons";
          if (norm.includes("recharts") || norm.includes("d3-")) return "vendor-charts";
          return undefined;
        },
      },
    },
    sourcemap: true,
    target: "es2020",
  },
};
});
