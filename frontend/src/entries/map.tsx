import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/map.css";
import MapApp from "../components/MapApp";

const el = document.getElementById("map-root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <MapApp />
    </StrictMode>
  );
}
