import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/season.css";
import SeasonApp from "../components/SeasonApp";

const el = document.getElementById("season-root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <SeasonApp />
    </StrictMode>
  );
}
