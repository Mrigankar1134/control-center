import { WifiOff } from "lucide-react";

export const metadata = {
  title: "Offline · Neural Control",
};

/**
 * Served by the service worker when a navigation fails. Deliberately static:
 * no live state can be shown honestly while the device is offline.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="panel max-w-md px-6 py-8 text-center">
        <span
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-content-muted"
          aria-hidden
        >
          <WifiOff className="h-5 w-5" />
        </span>
        <h1 className="mt-4 text-section-title font-semibold text-content-primary">
          You are offline
        </h1>
        <p className="mt-2 text-body leading-relaxed text-content-muted">
          Neural Control needs a connection to read the schedule and dispatch
          history. Scheduled automation keeps running server-side while you are
          away.
        </p>
        <p className="mt-4 text-support text-content-disabled">
          This page will recover automatically once the connection returns.
        </p>
      </div>
    </main>
  );
}
