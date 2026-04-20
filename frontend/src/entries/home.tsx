import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/home.css";
import HomeApp from "../components/HomeApp";

const el = document.getElementById("home-root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <HomeApp />
    </StrictMode>
  );
}
