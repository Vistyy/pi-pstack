import config from "@syzom/typescript-quality/oxlint";
import { defineConfig } from "oxlint";

export default defineConfig({
  ...config,
  ignorePatterns: ["upstream/**", "content/**", ".work/**"],
});
