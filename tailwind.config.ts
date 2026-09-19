import type { Config } from "tailwindcss";

const config: Config = {
  // Scan every React and TypeScript module under src so utility classes in
  // dashboard routes, shared components, and future feature modules are not
  // purged from the generated stylesheet.
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
export default config;
