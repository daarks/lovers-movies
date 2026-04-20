import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/conquistas.css";
import ConquistasApp from "../components/ConquistasApp";

const container = document.getElementById("conquistas-root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <ConquistasApp />
    </StrictMode>
  );
}
