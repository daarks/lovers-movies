import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/comparar.css";
import CompararApp from "../components/CompararApp";

type InitialPick = { id: number; mt: "movie" | "tv" } | null;

function readInitial(el: HTMLElement, key: "a" | "b"): InitialPick {
  const id = Number(el.dataset[`initial${key.toUpperCase()}Id` as keyof DOMStringMap]);
  const mt = (el.dataset[`initial${key.toUpperCase()}Mt` as keyof DOMStringMap] || "movie") as
    | "movie"
    | "tv";
  if (!Number.isFinite(id) || id <= 0) return null;
  return { id, mt: mt === "tv" ? "tv" : "movie" };
}

const container = document.getElementById("comparar-root");
if (container) {
  const initialA = readInitial(container, "a");
  const initialB = readInitial(container, "b");
  createRoot(container).render(
    <StrictMode>
      <CompararApp initialA={initialA} initialB={initialB} />
    </StrictMode>
  );
}
