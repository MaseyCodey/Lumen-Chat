import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17211d",
        moss: "#1f6f56",
        jade: "#2fb789",
        sun: "#f2b84b",
        coral: "#ee6f57",
        cloud: "#f7f4ee"
      },
      boxShadow: {
        soft: "0 20px 70px rgba(23, 33, 29, 0.16)"
      }
    }
  },
  plugins: []
};

export default config;
