import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base:'./' makes the build use relative asset paths, so it works on
// GitHub Pages at any repo path (https://user.github.io/repo/) without config.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
