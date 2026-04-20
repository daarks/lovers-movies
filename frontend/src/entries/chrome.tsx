import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AppShell from "../components/AppShell";
import "../styles/chrome.css";

function mount() {
  let host = document.getElementById("chrome-root");
  if (!host) {
    host = document.createElement("div");
    host.id = "chrome-root";
    host.setAttribute("aria-hidden", "true");
    document.body.appendChild(host);
  }
  document.body.classList.add("has-js-chrome");
  createRoot(host).render(
    <StrictMode>
      <AppShell />
    </StrictMode>
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
