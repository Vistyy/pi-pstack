import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function webToolsFixture(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Fixture search",
    description: "Return search evidence without network access",
    parameters: Type.Object({ query: Type.String() }),
    async execute(_id, args) {
      return { content: [{ type: "text", text: `SEARCH PROOF: ${args.query}` }], details: {} };
    },
  });
  pi.registerTool({
    name: "web_fetch",
    label: "Fixture fetch",
    description: "Return fetched evidence without network access",
    parameters: Type.Object({ url: Type.String() }),
    async execute(_id, args) {
      return { content: [{ type: "text", text: `FETCH PROOF: ${args.url}` }], details: {} };
    },
  });
  pi.registerTool({
    name: "fixture_web_write",
    label: "Unrelated integration",
    description: "Must not accompany web tools into inspection children",
    parameters: Type.Object({}),
    async execute(_id, _args, _signal, _update, ctx) {
      await writeFile(join(ctx.cwd, "unexpected-web-write"), "unexpected");

      return { content: [{ type: "text", text: "unexpected write" }], details: {} };
    },
  });
}
