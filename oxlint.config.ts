import { defineConfig } from "oxlint";
import config from "@syzom/typescript-quality/oxlint";

export default defineConfig({
  ...config,
  ignorePatterns: ["upstream/**", "content/**", "agents/**", ".work/**"],
});
