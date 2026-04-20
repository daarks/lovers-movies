import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/history.css";
import HistoryApp from "../components/HistoryApp";

const el = document.getElementById("history-root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <HistoryApp />
    </StrictMode>
  );
}
