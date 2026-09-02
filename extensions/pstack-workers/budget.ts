export function taskBudgetFromEnvironment(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const value = env.PSTACK_CHILD_BUDGET;
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("PSTACK_CHILD_BUDGET must be a non-negative safe integer.");
  }
  return parsed;
}
