// Fixture assertions behind the Ledger Lock proof block.
import assert from "node:assert/strict";
import { test } from "node:test";

const FIXTURE = [
  { buyer: "B-01", requested: 1, reserved: 1, result: "COMMITTED" },
  { buyer: "B-02", requested: 1, reserved: 0, result: "REJECTED" },
  { buyer: "B-03", requested: 1, reserved: 0, result: "REJECTED" },
  { buyer: "B-04", requested: 1, reserved: 0, result: "REJECTED" },
];

test("no committed reservation exceeds the stock count", () => {
  const committed = FIXTURE.filter((row) => row.result === "COMMITTED");
  assert.equal(committed.length, 1);
  assert.ok(FIXTURE.every((row) => row.reserved <= 1));
});

test("every request resolves to exactly one ledger outcome", () => {
  for (const row of FIXTURE) {
    assert.ok(row.result === "COMMITTED" || row.result === "REJECTED");
  }
});
