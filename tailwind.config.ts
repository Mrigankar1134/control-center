import type { Config } from "tailwindcss";

/*
 * Every colour here resolves to a CSS variable defined in globals.css, so the
 * light/dark swap happens in one place and Tailwind never needs a `dark:`
 * variant for colour. `darkMode: "class"` stays only so the odd genuinely
 * theme-specific tweak is still expressible.
 */
const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        field: "var(--field)",
        glass: {
          DEFAULT: "var(--glass)",
          raised: "var(--glass-raised)",
          sunken: "var(--glass-sunken)",
          hover: "var(--glass-hover)",
        },
        edge: {
          DEFAULT: "var(--edge)",
          top: "var(--edge-top)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          soft: "var(--ink-soft)",
          faint: "var(--ink-faint)",
        },
        tint: {
          in: "var(--tint-in)",
          out: "var(--tint-out)",
        },
        ok: "var(--ok)",
        warn: "var(--warn)",
        bad: "var(--bad)",
      },
      fontFamily: {
        // The Apple stack first: on the devices this is used from, that is the
        // real SF Pro, which is most of why the UI reads as native.
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Segoe UI Variable",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SF Mono",
          "SFMono-Regular",
          "Menlo",
          "Cascadia Mono",
          "monospace",
        ],
      },
      fontSize: {
        // Roughly Apple's type ladder. Nothing below 11px.
        caption: ["0.6875rem", { lineHeight: "0.9375rem", letterSpacing: "0.01em" }],
        footnote: ["0.75rem", { lineHeight: "1.0625rem" }],
        subhead: ["0.8125rem", { lineHeight: "1.1875rem" }],
        body: ["0.9375rem", { lineHeight: "1.375rem" }],
        headline: ["1.0625rem", { lineHeight: "1.4375rem", letterSpacing: "-0.01em" }],
        title: ["1.375rem", { lineHeight: "1.75rem", letterSpacing: "-0.02em" }],
        display: ["2rem", { lineHeight: "2.375rem", letterSpacing: "-0.03em" }],
        hero: ["2.75rem", { lineHeight: "3rem", letterSpacing: "-0.035em" }],
      },
      borderRadius: {
        // Apple's continuous-corner look needs generous radii.
        pill: "999px",
        control: "14px",
        card: "22px",
        sheet: "28px",
      },
      transitionTimingFunction: {
        // The spring-ish curve Apple uses for most non-interactive motion.
        apple: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.45", transform: "scale(0.86)" },
        },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        sweep: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(300%)" },
        },
      },
      animation: {
        "pulse-dot": "pulse-dot 2.2s ease-in-out infinite",
        "rise-in": "rise-in 320ms cubic-bezier(0.32, 0.72, 0, 1) both",
        sweep: "sweep 1.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
