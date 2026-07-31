"use client";

import * as React from "react";

/**
 * Registers the service worker that makes the dashboard installable.
 *
 * Only in production: a worker cached across `next dev` rebuilds serves stale
 * chunks and produces confusing hydration failures.
 */
export function ServiceWorker() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        /* Installability is a progressive enhancement, never a hard failure. */
      });
    };

    // Registering after load keeps the worker off the critical path.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register);

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
