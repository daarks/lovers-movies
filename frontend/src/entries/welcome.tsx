import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/welcome.css";
import WelcomeApp from "../components/WelcomeApp";

const el = document.getElementById("welcome-root");
if (el) {
  const labelA = el.getAttribute("data-label-a") || "Princesinha";
  const labelB = el.getAttribute("data-label-b") || "Gabe";
  createRoot(el).render(
    <StrictMode>
      <WelcomeApp labelA={labelA} labelB={labelB} />
    </StrictMode>
  );
}
