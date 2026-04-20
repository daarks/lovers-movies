import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/watch_later.css";
import WatchLaterApp from "../components/WatchLaterApp";

const el = document.getElementById("watch-later-root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <WatchLaterApp />
    </StrictMode>
  );
}
