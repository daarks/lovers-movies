import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/swipe.css";
import SwipeApp from "../components/SwipeApp";

const el = document.getElementById("swipe-root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <SwipeApp />
    </StrictMode>
  );
}
