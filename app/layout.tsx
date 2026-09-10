import type { Metadata, Viewport } from "next";

import { ServiceWorker } from "@/components/ServiceWorker";
import { ToastProvider } from "@/components/ui/toast";

import "./globals.css";

/*
 * No webfont is loaded on purpose. The type stack in tailwind.config.ts starts
 * with -apple-system, so on the devices this is opened from the UI renders in
 * SF Pro — which is most of why it reads as native rather than as a web page
 * imitating one. It also removes two network requests from first paint.
 */

export const metadata: Metadata = {
  title: "Attendance Control",
  description: "Scheduled and manual attendance dispatch, with run history.",
  applicationName: "Attendance Control",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Attendance",
    // Translucent lets the colour field run under the status bar in standalone.
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  // An operator tool, not something to index.
  robots: { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // One per scheme so the browser chrome matches the field in both themes.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef1f6" },
    { media: "(prefers-color-scheme: dark)", color: "#06070b" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans text-body antialiased">
        <a
          href="#main"
          className="glass sr-only rounded-control focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:px-4 focus:py-2 focus:text-subhead focus:text-ink"
        >
          Skip to content
        </a>
        <ServiceWorker />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
