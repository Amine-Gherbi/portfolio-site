// Fixture assertions behind the Citation Desk proof block.
import assert from "node:assert/strict";
import { test } from "node:test";

const CORPUS_IDS = new Set(["p-001", "p-002"]);
const ANSWERS = [
  { question: "Q-011", passageIds: ["p-001", "p-002"] },
  { question: "Q-012", passageIds: ["p-001"] },
  { question: "Q-013", passageIds: [] },
];

test("every shipped answer carries a known passage id", () => {
  for (const answer of ANSWERS.filter((entry) => entry.passageIds.length > 0)) {
    assert.ok(answer.passageIds.every((id) => CORPUS_IDS.has(id)));
  }
});

test("an answer without a passage becomes a refusal", () => {
  const unanswered = ANSWERS.filter((answer) => answer.passageIds.length === 0);
  assert.equal(unanswered.length, 1);
  assert.equal(unanswered[0]?.question, "Q-013");
});
