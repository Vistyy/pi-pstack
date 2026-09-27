import {
  AssistantMessageComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { type Component, Text, type TUI } from "@earendil-works/pi-tui";
import type { Transcript } from "./observer-state.js";

type Message = Transcript["messages"][number];

function definitions(cwd: string) {
  return new Map<string, ConstructorParameters<typeof ToolExecutionComponent>[4]>([
    ["read", createReadToolDefinition(cwd)],
    ["bash", createBashToolDefinition(cwd)],
    ["edit", createEditToolDefinition(cwd)],
    ["write", createWriteToolDefinition(cwd)],
    ["grep", createGrepToolDefinition(cwd)],
    ["find", createFindToolDefinition(cwd)],
    ["ls", createLsToolDefinition(cwd)],
  ]);
}

export class ObserverTranscript {
  private messages: readonly Message[] = [];
  private components: Component[] = [];
  private tools = new Map<string, ToolExecutionComponent>();
  private readonly builtins: ReturnType<typeof definitions>;
  private readonly streaming = new AssistantMessageComponent();
  private lines: string[] = [];
  private width = 0;
  private toolVersion = -1;
  private expanded = true;

  constructor(
    private readonly tui: TUI,
    private readonly cwd: string,
  ) {
    this.builtins = definitions(cwd);
  }

  invalidate() {
    this.width = 0;

    for (const component of this.components) component.invalidate();
    this.streaming.invalidate();
  }

  private tool(message: Extract<Message, { role: "assistant" }>, view: Transcript) {
    for (const part of message.content) {
      if (part.type !== "toolCall") continue;

      const tool = new ToolExecutionComponent(
        part.name,
        part.id,
        part.arguments,
        { showImages: false },
        view.definition?.(part.name) ?? this.builtins.get(part.name),
        this.tui,
        this.cwd,
      );

      tool.setExpanded(this.expanded);
      tool.setArgsComplete();
      this.tools.set(part.id, tool);
      this.components.push(tool);
    }
  }

  private append(message: Message, view: Transcript) {
    switch (message.role) {
      case "system":
        break;
      case "user": {
        const text = Array.isArray(message.content)
          ? message.content
              .map((part) => (part.type === "text" ? part.text : "[Image attachment]"))
              .join("\n")
          : message.content;

        this.components.push(new UserMessageComponent(text));
        break;
      }

      case "assistant":
        this.components.push(new AssistantMessageComponent(message));
        this.tool(message, view);
        break;
      case "toolResult": {
        const tool = this.tools.get(message.toolCallId);

        if (tool) tool.updateResult(message);
        else
          this.components.push(
            new Text(
              `${message.toolName}\n${message.content.map((part) => (part.type === "text" ? part.text : "[Image]")).join("\n")}`,
              0,
              0,
            ),
          );
        break;
      }

      case "custom": {
        if (!message.display) break;
        const component = new CustomMessageComponent(message);
        component.setExpanded(this.expanded);
        this.components.push(component);
        break;
      }

      case "compactionSummary": {
        const component = new CompactionSummaryMessageComponent(message);
        component.setExpanded(this.expanded);
        this.components.push(component);
        break;
      }

      case "branchSummary": {
        const component = new BranchSummaryMessageComponent(message);
        component.setExpanded(this.expanded);
        this.components.push(component);
        break;
      }

      case "bashExecution":
        this.components.push(new Text(`$ ${message.command}\n${message.output}`, 0, 0));
        break;
      default: {
        const exhaustive: never = message;

        return exhaustive;
      }
    }
  }

  render(view: Transcript, width: number, expanded: boolean) {
    const changed =
      expanded !== this.expanded ||
      view.messages.length !== this.messages.length ||
      view.messages.some((message, index) => message !== this.messages[index]);

    if (changed) {
      this.expanded = expanded;
      this.messages = view.messages.slice();
      this.components = [];
      this.tools.clear();

      for (const message of view.messages) this.append(message, view);
    }

    if (changed || this.toolVersion !== view.toolVersion || this.width !== width) {
      for (const id of view.runningTools.keys()) this.tools.get(id)?.markExecutionStarted();

      for (const [id, partial] of view.partials)
        this.tools.get(id)?.updateResult({ ...partial, isError: false }, true);
      this.lines = this.components.flatMap((component) => component.render(width));
      this.width = width;
      this.toolVersion = view.toolVersion;
    }

    const lines = [...this.lines];

    if (view.streaming?.role === "assistant") {
      this.streaming.updateContent(view.streaming, true);
      lines.push(...this.streaming.render(width));
    }

    return lines.map((line) =>
      line
        .replaceAll("\x1b]133;A\x07", "")
        .replaceAll("\x1b]133;B\x07", "")
        .replaceAll("\x1b]133;C\x07", ""),
    );
  }
}
