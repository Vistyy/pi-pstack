import assert from "node:assert/strict";
import test from "node:test";
import { taskBudgetFromEnvironment } from "../../extensions/pstack-workers/budget.js";

test("Task fan-out is uncapped unless the caller explicitly sets a budget", () => {
  assert.equal(taskBudgetFromEnvironment({}), undefined);
  assert.equal(taskBudgetFromEnvironment({ PSTACK_CHILD_BUDGET: "4" }), 4);
});

test("an invalid explicit Task budget fails closed", () => {
  assert.throws(() => taskBudgetFromEnvironment({ PSTACK_CHILD_BUDGET: "four" }), /non-negative safe integer/);
  assert.throws(() => taskBudgetFromEnvironment({ PSTACK_CHILD_BUDGET: "-1" }), /non-negative safe integer/);
});
