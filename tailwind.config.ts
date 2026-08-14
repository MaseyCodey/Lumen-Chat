import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        moss: "rgb(var(--color-moss) / <alpha-value>)",
        jade: "rgb(var(--color-jade) / <alpha-value>)",
        sun: "rgb(var(--color-sun) / <alpha-value>)",
        coral: "rgb(var(--color-coral) / <alpha-value>)",
        cloud: "rgb(var(--color-cloud) / <alpha-value>)"
      },
      boxShadow: {
        soft: "0 20px 70px rgb(var(--color-shadow) / 0.16)"
      }
    }
  },
  plugins: []
};

export default config;
