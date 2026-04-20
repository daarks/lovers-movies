import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/bets.css";
import BetsApp from "../components/BetsApp";

const el = document.getElementById("bets-root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <BetsApp />
    </StrictMode>
  );
}
