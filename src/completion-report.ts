const prefix = "PSTACK_CHILD_REPORT_V1\n";

const budget = 16 * 1024;

export type CompletionReport = {
  id: string;
  attempt: number;
  status: "completed" | "failed";
  report: { kind: "full"; text: string } | { kind: "preview"; text: string; omittedBytes: number };
};

export function completionReport(
  identity: Pick<CompletionReport, "id" | "attempt" | "status">,
  text: string,
): string {
  const encode = (report: CompletionReport["report"]) =>
    `${prefix}${JSON.stringify({ ...identity, report })}`;

  const full = encode({ kind: "full", text });

  if (Buffer.byteLength(full, "utf8") <= budget) return full;

  const bytes = Buffer.byteLength(text, "utf8");
  const start = text.slice(0, budget);

  const characters = Array.from(
    /[\uD800-\uDBFF]$/.test(start) && text.length > budget ? start.slice(0, -1) : start,
  );

  let low = 0;
  let high = characters.length;
  let result = encode({ kind: "preview", text: "", omittedBytes: bytes });

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const preview = characters.slice(0, middle).join("");

    const candidate = encode({
      kind: "preview",
      text: preview,
      omittedBytes: bytes - Buffer.byteLength(preview, "utf8"),
    });

    if (Buffer.byteLength(candidate, "utf8") <= budget) {
      result = candidate;
      low = middle + 1;
    } else high = middle - 1;
  }

  if (Buffer.byteLength(result, "utf8") > budget)
    throw new Error("Completion report identity exceeds the 16 KiB budget");

  return result;
}

export const completionReportPrefix = prefix;
