import { EventEmitter } from "node:events";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function reportBusyFixture(pi: ExtensionAPI) {
  pi.registerTool({
    name: "fixture_hold_report_work",
    label: "Hold report work",
    description: "Hold nested tool work until the report arrives",
    parameters: Type.Object({}),
    async execute() {
      EventEmitter.prototype.emit.call(process, "pstack-nested-report-work-started");

      await new Promise<void>((resolve) => {
        process.once("pstack-nested-report-work-release", resolve);
      });

      return { content: [{ type: "text", text: "held work completed" }], details: {} };
    },
  });
}
