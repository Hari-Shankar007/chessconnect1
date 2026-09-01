
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// ============================================================
// REGISTER CHESSCONNECT SERVICE WORKER
// ============================================================

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    console.warn(
      "[ChessConnect] Service workers are not supported."
    );
    return;
  }

  try {
    // Use Vite's configured base path.
    // This works with both GitHub Pages and a custom domain.
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;

    const registration =
      await navigator.serviceWorker.register(swUrl);

    console.log(
      "[ChessConnect] Service worker registered:",
      registration.scope
    );
  } catch (error) {
    console.error(
      "[ChessConnect] Service worker registration failed:",
      error
    );
  }
}

// Register after the page loads
if (typeof window !== "undefined") {
  window.addEventListener("load", () => {
    registerServiceWorker();
  });
}


// ============================================================
// START REACT
// ============================================================

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

