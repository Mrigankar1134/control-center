import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Background / surface ladder — most of the UI lives here.
        bg: {
          primary: "#090D16",
          elevated: "#0E1421",
        },
        surface: {
          primary: "#121827",
          secondary: "#161E2F",
          hover: "#1A2437",
        },
        // Text ladder
        content: {
          primary: "#F5F7FB",
          secondary: "#A8B1C2",
          muted: "#717B90",
          disabled: "#4D5668",
        },
        // Semantic accents — used sparingly (~10% of surface area).
        alpha: {
          DEFAULT: "#4FACFE",
          bright: "#00F2FE",
          dim: "#2A6E9E",
        },
        beta: {
          DEFAULT: "#B47CFF",
          bright: "#E100FF",
          dim: "#6B3FA0",
        },
        success: "#00F5A0",
        warning: "#FFB300",
        danger: "#FF3366",
        info: "#4FACFE",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: [
          "var(--font-jetbrains)",
          "ui-monospace",
          "SFMono-Regular",
          "monospace",
        ],
      },
      fontSize: {
        // Accessible scale — metadata never drops below 11px.
        meta: ["0.6875rem", { lineHeight: "1rem" }], // 11px
        support: ["0.75rem", { lineHeight: "1.125rem" }], // 12px
        body: ["0.8125rem", { lineHeight: "1.25rem" }], // 13px
        "body-lg": ["0.875rem", { lineHeight: "1.375rem" }], // 14px
        "card-title": ["0.9375rem", { lineHeight: "1.375rem" }], // 15px
        "section-title": ["1.125rem", { lineHeight: "1.625rem" }], // 18px
        "page-title": ["1.5rem", { lineHeight: "2rem" }], // 24px
        metric: ["1.75rem", { lineHeight: "2.125rem" }], // 28px
      },
      borderRadius: {
        control: "10px",
        panel: "14px",
      },
      boxShadow: {
        // Restrained: elevation reads as depth, not as glow.
        elevated: "0 18px 44px -28px rgba(0, 0, 0, 0.85)",
        "accent-alpha": "0 6px 20px -10px rgba(79, 172, 254, 0.55)",
        "accent-beta": "0 6px 20px -10px rgba(180, 124, 255, 0.55)",
        focus: "0 0 0 2px rgba(9, 13, 22, 1), 0 0 0 4px rgba(79, 172, 254, 0.6)",
      },
      transitionDuration: {
        press: "110ms",
        status: "180ms",
        expand: "200ms",
        drawer: "260ms",
      },
      keyframes: {
        "breathe": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "indeterminate": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(300%)" },
        },
      },
      animation: {
        // Only the live system indicator breathes.
        breathe: "breathe 2.4s ease-in-out infinite",
        "fade-in": "fade-in 200ms ease-out both",
        indeterminate: "indeterminate 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
