import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function reportPrefixFixture(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => {
    event.systemPromptOptions.sections = {
      ...event.systemPromptOptions.sections,
      thirdparty: "THIRDPARTY_REPORT_PREFIX_MARKER",
    };
  });
  pi.registerTool({
    name: "thirdparty_report_tool",
    label: "Third-party report tool",
    description: "Verify the third-party tool remains available on continuation",
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text", text: "third-party tool works" }], details: {} };
    },
  });
}
