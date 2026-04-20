import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/person.css";
import PersonApp from "../components/PersonApp";

const el = document.getElementById("person-root");
if (el) {
  const personId = parseInt(el.getAttribute("data-person-id") || "0", 10);
  if (personId > 0) {
    createRoot(el).render(
      <StrictMode>
        <PersonApp personId={personId} />
      </StrictMode>
    );
  }
}
