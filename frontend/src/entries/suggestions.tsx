import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/suggestions.css";
import SuggestionsApp from "../components/SuggestionsApp";

const el = document.getElementById("suggestions-root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <SuggestionsApp />
    </StrictMode>
  );
}
