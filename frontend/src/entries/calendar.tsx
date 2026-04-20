import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/calendar.css";
import CalendarApp from "../components/CalendarApp";

const el = document.getElementById("calendar-root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <CalendarApp />
    </StrictMode>
  );
}
