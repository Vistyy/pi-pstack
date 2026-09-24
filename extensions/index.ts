import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRuntime } from "../src/runtime.js";

export default function (pi: ExtensionAPI): void {
  createRuntime(pi, false);
}
