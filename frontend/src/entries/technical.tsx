import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/technical.css";
import TechnicalApp from "../components/TechnicalApp";

const el = document.getElementById("technical-root");
if (el) {
  const mediaTypeRaw = el.getAttribute("data-media-type") || "movie";
  const mediaType = mediaTypeRaw === "tv" ? "tv" : "movie";
  const tmdbId = parseInt(el.getAttribute("data-tmdb-id") || "0", 10);
  if (tmdbId > 0) {
    createRoot(el).render(
      <StrictMode>
        <TechnicalApp mediaType={mediaType} tmdbId={tmdbId} />
      </StrictMode>
    );
  }
}
