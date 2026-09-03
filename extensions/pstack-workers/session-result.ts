import { readFileSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export interface AgentResult {
  text: string;
  failed: boolean;
  error?: string;
}

export function readLatestAssistantResult(sessionFile: string, afterByteOffset?: number): AgentResult {
  const messages: any[] = afterByteOffset === undefined
    ? SessionManager.open(sessionFile).buildSessionContext().messages
    : messagesAfterOffset(sessionFile, afterByteOffset);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = message.content
      .filter((part: { type: string }) => part.type === "text")
      .map((part: { text?: string }) => part.text ?? "")
      .join("\n")
      .trim();
    const failed = message.stopReason === "error" || message.stopReason === "aborted";
    return {
      text: text || (failed ? message.errorMessage ?? "Agent failed without output." : "(no output)"),
      failed,
      error: message.errorMessage,
    };
  }
  return { text: "(no assistant response)", failed: true, error: "The child session has no assistant response." };
}

function messagesAfterOffset(sessionFile: string, offset: number): Array<Record<string, any>> {
  const content = readFileSync(sessionFile).subarray(offset).toString("utf8");
  return content.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const entry = JSON.parse(line) as { type?: string; message?: Record<string, any> };
      return entry.type === "message" && entry.message ? [entry.message] : [];
    } catch {
      return [];
    }
  });
}
