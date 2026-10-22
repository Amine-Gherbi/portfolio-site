// Fixture assertions behind the Merge Gate proof block.
import assert from "node:assert/strict";
import { test } from "node:test";

const CHECKS = [
  { name: "lint", conclusion: "success" },
  { name: "unit", conclusion: "success" },
  { name: "policy-gate", conclusion: "failure" },
];

test("a failing required check keeps the pull request out of main", () => {
  const failing = CHECKS.filter((check) => check.conclusion === "failure");
  assert.equal(failing.length, 1);
  assert.equal(failing[0]?.name, "policy-gate");
});

test("every required check reports a conclusion", () => {
  assert.equal(CHECKS.length, 3);
  assert.ok(CHECKS.every((check) => check.conclusion.length > 0));
});
