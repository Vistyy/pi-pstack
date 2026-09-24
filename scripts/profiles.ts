import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Profile = {
  name: string;
  description: string;
  prompt: string;
  poteto: boolean;
  readOnly: boolean;
};

function body(markdown: string) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

export async function generateProfiles(content: string, output: string) {
  const identity = body(await readFile(path.join(content, "agents/poteto-agent.md"), "utf8"));
  const mode = body(await readFile(path.join(content, "skills/poteto-mode/SKILL.md"), "utf8"));
  const commentSicko = body(await readFile(path.join(content, "agents/comment-sicko.md"), "utf8"));

  const profiles: Profile[] = [
    {
      name: "pstack-general-purpose",
      description: "General-purpose PStack assignment.",
      prompt: "",
      poteto: false,
      readOnly: false,
    },
    {
      name: "pstack-reader",
      description: "General-purpose PStack assignment with read-only tools.",
      prompt: "",
      poteto: false,
      readOnly: true,
    },
    {
      name: "pstack-poteto-agent",
      description: "Upstream Poteto-mode assignment.",
      prompt: `${identity}\n\n${mode}`,
      poteto: true,
      readOnly: false,
    },
    {
      name: "pstack-poteto-reader",
      description: "Upstream Poteto-mode assignment with read-only tools.",
      prompt: `${identity}\n\n${mode}`,
      poteto: true,
      readOnly: true,
    },
    {
      name: "pstack-comment-sicko",
      description: "Upstream Comment Sicko comment review and scoped edits.",
      prompt: commentSicko,
      poteto: false,
      readOnly: false,
    },
  ];

  await mkdir(output, { recursive: true });

  for (const profile of profiles) {
    const fields = [
      "---",
      `name: ${profile.name}`,
      `description: ${profile.description}`,
      "model: inherit",
      "systemPromptMode: append",
      "inheritProjectContext: true",
      "inheritGlobalContext: false",
      "inheritSkills: false",
      "defaultContext: fresh",
      "allowNestedSubagents: true",
      "subagentOnlyExtensions: ../extensions/index.ts",
      'acceptance: {"level":"none","reason":"PStack owns workflow verification and review"}',
    ];

    if (profile.readOnly) {
      fields.push("tools: read, grep, find, ls, pstack_todo");
      fields.push("allowedAgents: pstack-reader, pstack-poteto-reader");
    }

    if (profile.poteto) {
      fields.push("skillPath: ../content/pstack/skills");
      fields.push("skills: poteto-mode");
    }

    fields.push("---", "");

    if (profile.prompt !== "") fields.push(profile.prompt, "");

    await writeFile(path.join(output, `${profile.name}.md`), fields.join("\n"));
  }
}
