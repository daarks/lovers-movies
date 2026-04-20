import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/stats.css";
import StatsApp from "../components/StatsApp";

const el = document.getElementById("stats-root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <StatsApp />
    </StrictMode>
  );
}
