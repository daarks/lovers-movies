import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/perfil.css";
import PerfilApp from "../components/PerfilApp";

const container = document.getElementById("perfil-root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <PerfilApp />
    </StrictMode>
  );
}
