import { SessionManager } from "@earendil-works/pi-coding-agent";

export const POTETO_IDENTITY = "poteto-agent";

export function potetoBootstrapPrompt(skillPath: string): string {
  return `Initialize the Poteto worker before accepting an assignment. Use the read tool to read ${JSON.stringify(skillPath)} in full. Then call pstack_todo with action set and at least one item. Return only POTETO_WORKER_READY after both tool calls succeed.`;
}

export function assertPotetoBootstrapped(sessionFile: string, skillPath: string): void {
  const messages = SessionManager.open(sessionFile).buildSessionContext().messages;
  let readSkill = false;
  let initializedTodo = false;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "toolCall") continue;
      const argumentsValue = part.arguments as Record<string, unknown>;
      if (part.name === "read" && argumentsValue.path === skillPath) readSkill = true;
      if (part.name === "pstack_todo" && argumentsValue.action === "set" && Array.isArray(argumentsValue.items) && argumentsValue.items.length > 0) {
        initializedTodo = true;
      }
    }
  }
  if (!readSkill || !initializedTodo) {
    const missing = [!readSkill ? "full Poteto skill read" : undefined, !initializedTodo ? "pstack_todo initialization" : undefined].filter(Boolean).join(" and ");
    throw new Error(`Poteto worker bootstrap omitted ${missing}.`);
  }
}

export function findPotetoSkill(skills: string[] | undefined): string {
  const path = skills?.find((skill) => /(?:^|\/)poteto-mode\/SKILL\.md$/.test(skill));
  if (!path) throw new Error("Poteto worker runtime does not include the poteto-mode skill.");
  return path;
}
