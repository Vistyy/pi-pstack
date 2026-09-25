import assert from "node:assert/strict";
import test from "node:test";
import { childFixture } from "./child-fixture.js";

await test("question tool reports unavailable UI without answers and rejects invalid batches", async (t) => {
  const f = await childFixture(t);
  const question = { id: "storage", question: "Which storage?", options: ["Local", "Remote"] };
  const unavailable = await f.call("pstack_question", { questions: [question] });
  assert.equal(unavailable.isError, false);
  const outcome: unknown = JSON.parse(unavailable.text);
  assert.partialDeepStrictEqual(outcome, { status: "unavailable", answers: [] });

  const empty = await f.call("pstack_question", { questions: [] });
  assert.equal(empty.isError, true);
  const duplicate = await f.call("pstack_question", { questions: [question, question] });
  assert.equal(duplicate.isError, true);
  assert.match(duplicate.text, /Question IDs must be unique/);
});
