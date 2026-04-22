import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/listas.css";
import ListasApp from "../components/ListasApp";

const el = document.getElementById("listas-root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <ListasApp />
    </StrictMode>
  );
}
