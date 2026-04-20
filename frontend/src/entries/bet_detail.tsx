import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/bets.css";
import BetDetailApp from "../components/BetDetailApp";

const el = document.getElementById("bet-detail-root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <BetDetailApp />
    </StrictMode>
  );
}
