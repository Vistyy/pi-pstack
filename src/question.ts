import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { type QuestionnaireResult, showQuestionnaire } from "./question-ui.js";

type QuestionOutcome = QuestionnaireResult | { status: "unavailable"; answers: []; reason: string };

const QuestionsInput = Type.Object(
  {
    questions: Type.Array(
      Type.Object(
        {
          id: Type.String({
            minLength: 1,
            pattern: "\\S",
            description: "Unique question identifier, used in the answer and review screen.",
          }),
          question: Type.String({
            minLength: 1,
            pattern: "\\S",
            description:
              "The complete question and relevant context in Markdown. Tables and fenced text diagrams are supported; keep diagrams narrow enough for a terminal. Put detailed option explanations here.",
          }),
          allow_multiple: Type.Optional(
            Type.Boolean({
              description:
                "Allow selecting multiple listed options and optionally adding an Other free-text answer alongside them.",
            }),
          ),
          options: Type.Array(Type.String({ minLength: 1, pattern: "\\S" }), {
            minItems: 1,
            description:
              "Concise option labels. The UI always adds an Other option for a multiline custom answer; do not add it yourself.",
          }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, description: "Questions shown sequentially, in this order." },
    ),
  },
  { additionalProperties: false },
);

export function installQuestionTool(pi: ExtensionAPI): void {
  pi.registerTool<typeof QuestionsInput, QuestionOutcome>({
    name: "pstack_question",
    label: "PStack questions",
    description:
      "Ask one or more questions in the terminal with Markdown context, single-choice options by default, optional multiple selection, and a free-text Other answer. Users can revise answers before submitting the final review. Cancelled or unavailable requests supply no answers: never infer consent or choices. If unavailable, ask in the conversation and wait.",
    parameters: QuestionsInput,
    executionMode: "sequential",
    async execute(_id, params, signal, _update, ctx) {
      signal?.throwIfAborted();

      if (new Set(params.questions.map((question) => question.id)).size !== params.questions.length)
        throw new Error("Question IDs must be unique.");

      if (
        params.questions.some(
          (question) =>
            question.allow_multiple === true &&
            new Set(question.options).size !== question.options.length,
        )
      )
        throw new Error("Multi-select option labels must be unique.");

      const outcome: QuestionOutcome =
        ctx.mode === "tui"
          ? await showQuestionnaire(ctx.ui, params.questions, signal)
          : {
              status: "unavailable" as const,
              answers: [],
              reason: "Terminal UI is unavailable; ask in the conversation and wait.",
            };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(outcome) }],
        details: outcome,
      };
    },
    renderResult(result, _options, theme, context) {
      if (context.isError) {
        const error = result.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");

        return new Text(theme.fg("error", error), 0, 0);
      }

      const outcome = result.details;

      const text =
        outcome.status === "answered"
          ? outcome.answers
              .map((answer) => {
                if (answer.kind !== "options") return `${answer.id}: ${answer.value}`;

                const other = answer.other === undefined ? "" : `\n  Other: ${answer.other}`;

                return `${answer.id}: ${answer.values.join(", ")}${other}`;
              })
              .join("\n")
          : outcome.status === "cancelled"
            ? "Questionnaire cancelled; no answers submitted."
            : outcome.reason;

      return new Text(theme.fg(outcome.status === "answered" ? "text" : "muted", text), 0, 0);
    },
  });
}
