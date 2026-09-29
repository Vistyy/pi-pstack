import type { EventEmitter } from "node:events";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function quietWakeGate(pi: ExtensionAPI) {
  pi.on("input", (event, ctx) => {
    if (ctx.model?.provider !== "fixture" || event.text !== "" || event.source !== "extension")
      return;

    const name = process.env["PSTACK_WAKE_GATE_EVENT"];

    if (name === undefined) throw new Error("Missing idle wake gate");

    return new Promise<void>((resolve) => {
      (process as EventEmitter).emit(name, resolve);
    });
  });
}
