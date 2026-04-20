import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/collection.css";
import CollectionApp from "../components/CollectionApp";

const el = document.getElementById("collection-root");
if (el) {
  const collectionId = parseInt(el.getAttribute("data-collection-id") || "0", 10);
  if (collectionId > 0) {
    createRoot(el).render(
      <StrictMode>
        <CollectionApp collectionId={collectionId} />
      </StrictMode>
    );
  }
}
