import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function reportPreflightFixture(pi: ExtensionAPI) {
  let denied = false;

  pi.on("input", (event) => {
    if (
      denied ||
      event.source !== "extension" ||
      !event.text.startsWith("PSTACK_CHILD_REPORT_V1\n")
    )
      return { action: "continue" };

    denied = true;

    return { action: "handled" };
  });
}
