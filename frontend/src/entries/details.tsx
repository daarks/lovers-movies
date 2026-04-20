import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/details.css";
import DetailsApp from "../components/DetailsApp";

const el = document.getElementById("details-root");
if (el) {
  const mt = (el.dataset.mediaType || "movie") as "movie" | "tv";
  const tid = Number(el.dataset.tmdbId || 0);
  if (Number.isFinite(tid) && tid > 0) {
    createRoot(el).render(
      <StrictMode>
        <DetailsApp mediaType={mt === "tv" ? "tv" : "movie"} tmdbId={tid} />
      </StrictMode>
    );
  }
}
