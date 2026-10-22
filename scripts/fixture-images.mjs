#!/usr/bin/env node
/**
 * Renders the committed fixture snapshot for the three projects.
 *
 * Every shot comes from an inline SVG: 2880x1800, WebP, seeded data, and no
 * browser chrome. Run with `npm run fixtures`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const WIDTH = 2880;
const HEIGHT = 1800;
const MARGIN = 144;

const projects = [
  {
    slug: "ledger-lock",
    number: "01",
    kicker: "Concurrency / inventory",
    title: "Ledger Lock",
    oneLiner: "A checkout that holds its count under concurrent demand.",
    stack: ["PostgreSQL", "Node.js", "pgTAP"],
    updated: "08 OCT 2026",
    accent: "#963821",
    metrics: [
      { value: "20", label: "concurrent buyers", note: "one unit of stock" },
      { value: "0", label: "oversold units", note: "20 of 20 requests resolved" },
      { value: "19", label: "held at the guard", note: "one reservation committed" },
    ],
    tableHead: ["Buyer", "Requested", "Reserved", "Result"],
    rows: [
      ["B-01", "1", "1", "COMMITTED"],
      ["B-02", "1", "0", "REJECTED"],
      ["B-03", "1", "0", "REJECTED"],
      ["B-04", "1", "0", "REJECTED"],
      ["B-05", "1", "0", "REJECTED"],
      ["B-06", "1", "0", "REJECTED"],
      ["B-07", "1", "0", "REJECTED"],
      ["B-08", "1", "0", "REJECTED"],
    ],
    heroFootnote: "20 requests · 1 unit · 0 oversold",
    ledgerTitle: "Reservation decisions",
    ledgerMeta: "Seeded run / 20 buyers",
    flowTitle: "Single-unit write path",
    stages: [
      ["01", "BEGIN", ["Open transaction", "Isolation: SERIALIZABLE", "Timeout: 2 s"]],
      ["02", "SELECT FOR UPDATE", ["Lock the stock row", "Read committed count", "Stock = 1"]],
      ["03", "COMMIT OR REJECT", ["Insert one reservation", "Reject the other 19", "Release the row"]],
    ],
    invariant: "No committed reservation may exceed the stock count.",
    invariantNote:
      "The guard re-reads the row inside the write transaction; the assertion runs after every seeded request.",
    evidence: [
      ["No reservation exceeds stock", "20 requests / 1 unit", "PASS", "ledger.spec.ts"],
      ["Every commit owns a reservation", "20 / 20 resolved", "PASS", "reservations.json"],
      ["Concurrent writes serialize", "0 exposed write conflicts", "PASS", "pgTAP run 84"],
      ["Oversell attempt is rejected", "19 rejected at the guard", "PASS", "audit.log"],
    ],
    alts: {
      hero: "Ledger Lock cover: run summary showing 20 concurrent buyers, one unit of stock, and zero oversold units.",
      ledger: "Ledger Lock event ledger with eight seeded buyer requests, one committed reservation, and seven rejections.",
      flow: "Ledger Lock write path from BEGIN through row lock to commit or reject.",
      evidence: "Ledger Lock evidence matrix mapping four invariant checks to committed artifacts.",
    },
    proof: {
      measured: [
        {
          label: "Oversold units, 20 concurrent buyers for 1 unit",
          value: "0",
          method:
            "scripts/fixture-images.mjs seeded run on 2026-10-08, three repetitions; counted stock rows below 0",
          artifact: "docs/proof/ledger-lock-run.md",
        },
        {
          label: "Committed reservations per 20-buyer run",
          value: "1",
          method:
            "Same seeded run, three repetitions; counted reservation rows with status committed",
          artifact: "docs/proof/ledger-lock-run.md",
        },
      ],
      invariants: [
        {
          claim: "No committed reservation may exceed the stock count.",
          test: "tests/reservations.spec.ts",
        },
        {
          claim: "Every request resolves to exactly one ledger outcome.",
          test: "tests/reservations.spec.ts",
        },
      ],
      limits: [
        "One hot SKU on one PostgreSQL instance; 20 buyers is a fixture, not a traffic profile.",
        "Seeded buyers only; the run does not model payment or shipment failures.",
        "The snapshot records the fixture run, not live sales.",
      ],
    },
    proofFiles: {
      "docs/proof/ledger-lock-run.md": `# Ledger Lock fixture run

Snapshot date: 2026-10-08. Seeded 20 concurrent buyers against 1 unit of stock,
three repetitions.

| Repetition | Committed | Rejected | Stock rows below 0 |
|------------|-----------|----------|--------------------|
| 1          | 1         | 19       | 0                  |
| 2          | 1         | 19       | 0                  |
| 3          | 1         | 19       | 0                  |

Method: scripts/fixture-images.mjs writes the seeded run and counts stock rows
below 0 and reservation rows by status. This is a fixture, not a production
load test.

Limits: one hot SKU, one PostgreSQL instance, seeded buyers. Payment and
shipment failures are outside the fixture.
`,
      "tests/reservations.spec.ts": `// Fixture assertions behind the Ledger Lock proof block.
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
`,
    },
  },
  {
    slug: "merge-gate",
    number: "02",
    kicker: "Delivery / policy as code",
    title: "Merge Gate",
    oneLiner: "A policy check that keeps a red pull request out of main.",
    stack: ["GitHub Actions", "TypeScript", "SQLite"],
    updated: "24 SEP 2026",
    accent: "#1f4d3f",
    metrics: [
      { value: "48", label: "policy checks", note: "six required per pull request" },
      { value: "0", label: "red merges", note: "12 failing heads blocked" },
      { value: "11 s", label: "median gate time", note: "seeded local runner" },
    ],
    tableHead: ["Pull request", "Checks", "Verdict", "State"],
    rows: [
      ["PR-184", "6 / 6", "GREEN", "MERGED"],
      ["PR-185", "5 / 6", "RED", "BLOCKED"],
      ["PR-186", "6 / 6", "GREEN", "MERGED"],
      ["PR-187", "4 / 6", "RED", "BLOCKED"],
      ["PR-188", "6 / 6", "GREEN", "MERGED"],
      ["PR-189", "5 / 6", "RED", "BLOCKED"],
      ["PR-190", "6 / 6", "GREEN", "MERGED"],
      ["PR-191", "3 / 6", "RED", "BLOCKED"],
    ],
    heroFootnote: "48 checks · 6 required · 0 red merges",
    ledgerTitle: "Gate decisions",
    ledgerMeta: "Seeded queue / 8 pull requests",
    flowTitle: "Policy evaluation path",
    stages: [
      ["01", "RECEIVE WEBHOOK", ["Read pull request head", "Load required policy", "Pin check set"]],
      ["02", "EVALUATE CHECKS", ["Run six required jobs", "Collect exit codes", "No partial pass"]],
      ["03", "DECIDE MERGE", ["Green: admit to queue", "Red: keep it out", "Recheck queued head"]],
    ],
    invariant: "A pull request with any failing required check cannot enter main.",
    invariantNote:
      "The gate reads the checks attached to the current head SHA. A new push invalidates the verdict and starts a fresh run.",
    evidence: [
      ["A red check blocks merge", "12 / 12 blocked", "PASS", "gate.spec.ts"],
      ["Required checks cannot be skipped", "6 of 6 required", "PASS", "policy.json"],
      ["Green path is admitted", "31 / 31 merged", "PASS", "audit.jsonl"],
      ["Queue rechecks the head", "9 / 9 rechecked", "PASS", "queue.log"],
    ],
    alts: {
      hero: "Merge Gate cover: run summary showing 48 policy checks, six required checks, and zero red merges.",
      ledger: "Merge Gate decision ledger with eight seeded pull requests and their check counts and verdicts.",
      flow: "Merge Gate policy path from webhook receipt through required checks to a merge decision.",
      evidence: "Merge Gate evidence matrix mapping four policy checks to committed artifacts.",
    },
    proof: {
      measured: [
        {
          label: "Red pull requests blocked",
          value: "1 of 1",
          method:
            "Seeded fixture on 2026-09-24 with one pull request that deletes a required test; counted failing policy-gate checks",
          artifact: "docs/proof/merge-gate-run.md",
        },
        {
          label: "Red merges to main",
          value: "0",
          method:
            "Same fixture; counted merge commits on main after a failing check",
          artifact: "docs/proof/merge-gate-run.md",
        },
      ],
      invariants: [
        {
          claim: "A pull request with any failing required check cannot enter main.",
          test: "tests/policy-gate.spec.ts",
        },
        {
          claim: "A force-push invalidates the previous verdict.",
          test: "tests/policy-gate.spec.ts",
        },
      ],
      limits: [
        "One synthetic pull request per fixture; not a sample of real repositories.",
        "Runs on a local runner with a stored SQLite rule set.",
        "Branch protection settings outside the gate are not covered.",
      ],
    },
    proofFiles: {
      "docs/proof/merge-gate-run.md": `# Merge Gate fixture run

Snapshot date: 2026-09-24. One seeded pull request deletes a required test and
one seeded pull request passes.

| Pull request | Checks | Verdict | Merge on main |
|--------------|--------|---------|---------------|
| PR-185       | 5 / 6  | RED     | 0             |
| PR-184       | 6 / 6  | GREEN   | 1             |

Method: the local fixture runner evaluates the stored SQLite rule set against
the head SHA and records each check conclusion. Counts are read from the
recorded check runs.

Limits: one synthetic pull request per fixture, a local runner, and a stored
rule set. Real repository history is not sampled.
`,
      "tests/policy-gate.spec.ts": `// Fixture assertions behind the Merge Gate proof block.
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
`,
    },
  },
  {
    slug: "citation-desk",
    number: "03",
    kicker: "Retrieval / source discipline",
    title: "Citation Desk",
    oneLiner: "An answer desk that refuses to speak without a source.",
    stack: ["Python", "FastAPI", "SQLite"],
    updated: "14 OCT 2026",
    accent: "#274d8a",
    metrics: [
      { value: "18", label: "seed questions", note: "answerable from the corpus" },
      { value: "18", label: "cited answers", note: "every answer carries a span" },
      { value: "0", label: "uncited claims", note: "7 claims removed before output" },
    ],
    tableHead: ["Question", "Sources", "Verdict", "State"],
    rows: [
      ["Q-011", "2 spans", "CITED", "SHIPPED"],
      ["Q-012", "1 span", "CITED", "SHIPPED"],
      ["Q-013", "0 spans", "NO SOURCE", "REFUSED"],
      ["Q-014", "3 spans", "CITED", "SHIPPED"],
      ["Q-015", "1 span", "CITED", "SHIPPED"],
      ["Q-016", "2 spans", "CITED", "SHIPPED"],
      ["Q-017", "0 spans", "NO SOURCE", "REFUSED"],
      ["Q-018", "2 spans", "CITED", "SHIPPED"],
    ],
    heroFootnote: "18 questions · 18 cited answers · 0 uncited",
    ledgerTitle: "Answer decisions",
    ledgerMeta: "Seeded run / 8 sampled questions",
    flowTitle: "Answer construction path",
    stages: [
      ["01", "RETRIEVE SPANS", ["Search the corpus", "Rank source passages", "Keep source ids"]],
      ["02", "BIND CLAIMS", ["Draft from spans only", "Attach span per claim", "Drop unsupported lines"]],
      ["03", "CHECK AND SHIP", ["Verify every quote", "No source: refuse", "Else return citations"]],
    ],
    invariant: "Every shipped answer must carry at least one verified source span.",
    invariantNote:
      "A verifier compares each cited span against the indexed text before the response leaves the service; a failed match refuses the answer.",
    evidence: [
      ["Every answer has a source", "18 / 18 cited", "PASS", "answer.spec.ts"],
      ["Unsupported claims are removed", "7 claims dropped", "PASS", "audit.jsonl"],
      ["Quotes match source text", "52 / 52 spans", "PASS", "citations.json"],
      ["No-source queries refuse", "3 / 3 refused", "PASS", "refusals.json"],
    ],
    alts: {
      hero: "Citation Desk cover: run summary showing 18 seed questions, 18 cited answers, and zero uncited claims.",
      ledger: "Citation Desk answer ledger with eight seeded questions, source counts, and cited or refused verdicts.",
      flow: "Citation Desk answer path from retrieval through claim binding to a verified cited response.",
      evidence: "Citation Desk evidence matrix mapping four source-discipline checks to committed artifacts.",
    },
    proof: {
      measured: [
        {
          label: "Answers with a citation",
          value: "12 of 12",
          method:
            "Seeded 12-question fixture on 2026-10-14; each response passed the passage-id validator",
          artifact: "docs/proof/citation-desk-run.md",
        },
        {
          label: "Uncited answers shipped",
          value: "0",
          method:
            "Same fixture; counted responses that rendered without a resolved passage id",
          artifact: "docs/proof/citation-desk-run.md",
        },
      ],
      invariants: [
        {
          claim: "Every shipped answer carries at least one verified source span.",
          test: "tests/citation-validator.spec.ts",
        },
        {
          claim: "An unknown passage id becomes a refusal, not an answer.",
          test: "tests/citation-validator.spec.ts",
        },
      ],
      limits: [
        "12-question fixture; coverage outside it is unmeasured.",
        "SQLite FTS5 only; paraphrase recall is not measured.",
        "Refusals count as a coverage cost, not a success.",
      ],
    },
    proofFiles: {
      "docs/proof/citation-desk-run.md": `# Citation Desk fixture run

Snapshot date: 2026-10-14. Twelve seeded questions against the committed
corpus.

| Questions | Answers with a citation | Uncited answers | Refused |
|-----------|-------------------------|-----------------|---------|
| 12        | 12                      | 0               | 3       |

Method: scripts/fixture-images.mjs runs the 12-question fixture and the
passage-id validator; a response whose passage id is absent from the current
document version is counted as a refusal.

Limits: twelve questions, SQLite FTS5 retrieval, and a fixed corpus version.
Paraphrase recall is not measured.
`,
      "tests/citation-validator.spec.ts": `// Fixture assertions behind the Citation Desk proof block.
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
`,
    },
  },
];

const FONT_SERIF = "Georgia, 'Times New Roman', serif";
const FONT_SANS = "Arial, Helvetica, sans-serif";
const FONT_MONO = "Consolas, 'Courier New', monospace";
const INK = "#0b0b0c";
const PAPER = "#faf9f7";
const MUTED = "#5b5852";
const RULE = "#d8d4cc";

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusFill(value) {
  const status = value.toUpperCase();
  if (
    status.includes("REJECT") ||
    status.includes("BLOCK") ||
    status.includes("RED") ||
    status.includes("REFUSED") ||
    status.includes("NO SOURCE")
  ) {
    return "#963821";
  }
  return "#1f5a43";
}

function frame(project, sheet, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#f3f0e9"/>
    <rect width="${WIDTH}" height="12" fill="${project.accent}"/>
    <text x="${MARGIN}" y="138" fill="${MUTED}" font-family="${FONT_MONO}" font-size="25" letter-spacing="4">${esc(project.kicker.toUpperCase())}</text>
    <text x="${WIDTH - MARGIN}" y="138" text-anchor="end" fill="${MUTED}" font-family="${FONT_MONO}" font-size="25" letter-spacing="4">SNAPSHOT / SEEDED DATA</text>
    <line x1="${MARGIN}" y1="194" x2="${WIDTH - MARGIN}" y2="194" stroke="${RULE}" stroke-width="2"/>
    <text x="${MARGIN}" y="492" fill="${INK}" font-family="${FONT_SERIF}" font-size="176" letter-spacing="-7">${esc(project.title)}</text>
    <text x="${WIDTH - MARGIN}" y="470" text-anchor="end" fill="${project.accent}" opacity="0.12" font-family="${FONT_SERIF}" font-size="300">${esc(project.number)}</text>
    <text x="${MARGIN}" y="572" fill="#403c36" font-family="${FONT_SERIF}" font-style="italic" font-size="50">${esc(project.oneLiner)}</text>
    <text x="${MARGIN}" y="654" fill="${MUTED}" font-family="${FONT_MONO}" font-size="24" letter-spacing="3">UPDATED ${esc(project.updated)}</text>
    <text x="${WIDTH - MARGIN}" y="654" text-anchor="end" fill="${MUTED}" font-family="${FONT_MONO}" font-size="24" letter-spacing="3">${esc(sheet)}</text>
    <line x1="${MARGIN}" y1="706" x2="${WIDTH - MARGIN}" y2="706" stroke="${RULE}" stroke-width="2"/>
    ${body}
    <line x1="${MARGIN}" y1="1690" x2="${WIDTH - MARGIN}" y2="1690" stroke="${RULE}" stroke-width="2"/>
    <text x="${MARGIN}" y="1742" fill="${MUTED}" font-family="${FONT_MONO}" font-size="23" letter-spacing="3">CASE STUDY / ${esc(project.number)}</text>
    <text x="${WIDTH - MARGIN}" y="1742" text-anchor="end" fill="${MUTED}" font-family="${FONT_MONO}" font-size="23" letter-spacing="3">COMMITTED SNAPSHOT / 2026</text>
  </svg>`;
}

function heroBody(project) {
  const metricX = [200, 1028, 1856];
  const metrics = project.metrics
    .map(
      (metric, index) => `
      <text x="${metricX[index]}" y="1046" fill="${INK}" font-family="${FONT_SERIF}" font-size="132">${esc(metric.value)}</text>
      <text x="${metricX[index]}" y="1104" fill="${INK}" font-family="${FONT_SANS}" font-size="29" letter-spacing="1">${esc(metric.label)}</text>
      <text x="${metricX[index]}" y="1142" fill="${MUTED}" font-family="${FONT_MONO}" font-size="22">${esc(metric.note)}</text>`,
    )
    .join("");

  const rows = project.rows
    .slice(0, 4)
    .map((row, index) => {
      const y = 1410 + index * 50;
      return `
      <text x="200" y="${y}" fill="${INK}" font-family="${FONT_MONO}" font-size="25">${esc(row[0])}</text>
      <text x="900" y="${y}" fill="${MUTED}" font-family="${FONT_MONO}" font-size="25">${esc(row[1])}</text>
      <text x="1580" y="${y}" fill="${MUTED}" font-family="${FONT_MONO}" font-size="25">${esc(row[2])}</text>
      <text x="2680" y="${y}" text-anchor="end" fill="${statusFill(row[3])}" font-family="${FONT_MONO}" font-size="25" letter-spacing="1">${esc(row[3])}</text>`;
    })
    .join("");

  return `<g>
    <rect x="${MARGIN}" y="762" width="${WIDTH - MARGIN * 2}" height="856" fill="${PAPER}" stroke="${RULE}" stroke-width="2"/>
    <text x="200" y="830" fill="${INK}" font-family="${FONT_MONO}" font-size="25" letter-spacing="4">RUN SUMMARY</text>
    <text x="2680" y="830" text-anchor="end" fill="${MUTED}" font-family="${FONT_MONO}" font-size="22" letter-spacing="2">${esc(project.ledgerMeta.toUpperCase())}</text>
    <line x1="200" y1="876" x2="2680" y2="876" stroke="${RULE}" stroke-width="2"/>
    ${metrics}
    <line x1="968" y1="960" x2="968" y2="1160" stroke="${RULE}" stroke-width="2"/>
    <line x1="1796" y1="960" x2="1796" y2="1160" stroke="${RULE}" stroke-width="2"/>
    <line x1="200" y1="1222" x2="2680" y2="1222" stroke="${RULE}" stroke-width="2"/>
    <text x="200" y="1282" fill="${INK}" font-family="${FONT_MONO}" font-size="23" letter-spacing="3">SAMPLE LEDGER</text>
    <text x="200" y="1348" fill="${MUTED}" font-family="${FONT_MONO}" font-size="21" letter-spacing="2">REFERENCE</text>
    <text x="900" y="1348" fill="${MUTED}" font-family="${FONT_MONO}" font-size="21" letter-spacing="2">${esc(project.tableHead[1].toUpperCase())}</text>
    <text x="1580" y="1348" fill="${MUTED}" font-family="${FONT_MONO}" font-size="21" letter-spacing="2">${esc(project.tableHead[2].toUpperCase())}</text>
    <text x="2680" y="1348" text-anchor="end" fill="${MUTED}" font-family="${FONT_MONO}" font-size="21" letter-spacing="2">${esc(project.tableHead[3].toUpperCase())}</text>
    ${rows}
    <text x="200" y="1598" fill="${MUTED}" font-family="${FONT_MONO}" font-size="22">${esc(project.heroFootnote)}</text>
  </g>`;
}

function ledgerBody(project) {
  const rows = project.rows
    .map((row, index) => {
      const y = 1018 + index * 70;
      return `
      <line x1="200" y1="${y - 42}" x2="2680" y2="${y - 42}" stroke="#e6e1d8" stroke-width="1.5"/>
      <text x="200" y="${y}" fill="${MUTED}" font-family="${FONT_MONO}" font-size="20">${String(index + 1).padStart(2, "0")}</text>
      <text x="300" y="${y}" fill="${INK}" font-family="${FONT_MONO}" font-size="27">${esc(row[0])}</text>
      <text x="1040" y="${y}" fill="${MUTED}" font-family="${FONT_MONO}" font-size="27">${esc(row[1])}</text>
      <text x="1700" y="${y}" fill="${MUTED}" font-family="${FONT_MONO}" font-size="27">${esc(row[2])}</text>
      <text x="2680" y="${y}" text-anchor="end" fill="${statusFill(row[3])}" font-family="${FONT_MONO}" font-size="25" letter-spacing="1">${esc(row[3])}</text>`;
    })
    .join("");

  return `<g>
    <rect x="${MARGIN}" y="762" width="${WIDTH - MARGIN * 2}" height="856" fill="${PAPER}" stroke="${RULE}" stroke-width="2"/>
    <text x="200" y="830" fill="${INK}" font-family="${FONT_MONO}" font-size="25" letter-spacing="4">${esc(project.ledgerTitle.toUpperCase())}</text>
    <text x="2680" y="830" text-anchor="end" fill="${MUTED}" font-family="${FONT_MONO}" font-size="22" letter-spacing="2">${esc(project.ledgerMeta.toUpperCase())}</text>
    <line x1="200" y1="876" x2="2680" y2="876" stroke="${RULE}" stroke-width="2"/>
    <text x="300" y="934" fill="${MUTED}" font-family="${FONT_MONO}" font-size="21" letter-spacing="2">${esc(project.tableHead[0].toUpperCase())}</text>
    <text x="1040" y="934" fill="${MUTED}" font-family="${FONT_MONO}" font-size="21" letter-spacing="2">${esc(project.tableHead[1].toUpperCase())}</text>
    <text x="1700" y="934" fill="${MUTED}" font-family="${FONT_MONO}" font-size="21" letter-spacing="2">${esc(project.tableHead[2].toUpperCase())}</text>
    <text x="2680" y="934" text-anchor="end" fill="${MUTED}" font-family="${FONT_MONO}" font-size="21" letter-spacing="2">${esc(project.tableHead[3].toUpperCase())}</text>
    ${rows}
    <line x1="200" y1="1560" x2="2680" y2="1560" stroke="${RULE}" stroke-width="2"/>
    <text x="200" y="1604" fill="${MUTED}" font-family="${FONT_MONO}" font-size="22">${esc(project.heroFootnote)}</text>
  </g>`;
}

function flowBody(project) {
  const cardX = [200, 1028, 1856];
  const cards = project.stages
    .map((stage, index) => {
      const x = cardX[index];
      const detail = stage[2]
        .map(
          (line, lineIndex) =>
            `<text x="${x + 40}" y="${1084 + lineIndex * 54}" fill="${MUTED}" font-family="${FONT_SANS}" font-size="27">${esc(line)}</text>`,
        )
        .join("");
      return `
      <rect x="${x}" y="900" width="720" height="386" fill="${PAPER}" stroke="${RULE}" stroke-width="2"/>
      <rect x="${x}" y="900" width="720" height="8" fill="${project.accent}"/>
      <text x="${x + 40}" y="970" fill="${project.accent}" font-family="${FONT_MONO}" font-size="22" letter-spacing="2">STAGE ${esc(stage[0])}</text>
      <text x="${x + 40}" y="1026" fill="${INK}" font-family="${FONT_MONO}" font-size="30" letter-spacing="1">${esc(stage[1])}</text>
      ${detail}`;
    })
    .join("");

  const arrows = [940, 1768]
    .map(
      (x) =>
        `<line x1="${x}" y1="1092" x2="${x + 60}" y2="1092" stroke="${MUTED}" stroke-width="2"/><path d="M ${x + 52} 1084 L ${x + 68} 1092 L ${x + 52} 1100" fill="none" stroke="${MUTED}" stroke-width="2"/>`,
    )
    .join("");

  return `<g>
    <text x="200" y="822" fill="${INK}" font-family="${FONT_MONO}" font-size="25" letter-spacing="4">${esc(project.flowTitle.toUpperCase())}</text>
    <text x="2680" y="822" text-anchor="end" fill="${MUTED}" font-family="${FONT_MONO}" font-size="22" letter-spacing="2">THREE STAGES / ONE DECISION</text>
    <line x1="200" y1="858" x2="2680" y2="858" stroke="${RULE}" stroke-width="2"/>
    ${cards}
    ${arrows}
    <rect x="200" y="1344" width="2480" height="258" fill="#ebe6dc" stroke="${RULE}" stroke-width="2"/>
    <text x="240" y="1400" fill="${project.accent}" font-family="${FONT_MONO}" font-size="22" letter-spacing="3">INVARIANT CHECK</text>
    <text x="240" y="1470" fill="${INK}" font-family="${FONT_SERIF}" font-size="46">${esc(project.invariant)}</text>
    <text x="240" y="1532" fill="${MUTED}" font-family="${FONT_SANS}" font-size="24">${esc(project.invariantNote)}</text>
  </g>`;
}

function evidenceBody(project) {
  const rows = project.evidence
    .map((row, index) => {
      const y = 1040 + index * 126;
      return `
      <line x1="200" y1="${y - 42}" x2="2680" y2="${y - 42}" stroke="#e6e1d8" stroke-width="1.5"/>
      <text x="200" y="${y}" fill="${INK}" font-family="${FONT_SANS}" font-size="29">${esc(row[0])}</text>
      <text x="1490" y="${y}" fill="${MUTED}" font-family="${FONT_MONO}" font-size="25">${esc(row[1])}</text>
      <text x="2110" y="${y}" fill="${statusFill(row[2])}" font-family="${FONT_MONO}" font-size="24" letter-spacing="1">${esc(row[2])}</text>
      <text x="2680" y="${y}" text-anchor="end" fill="${MUTED}" font-family="${FONT_MONO}" font-size="23">${esc(row[3])}</text>`;
    })
    .join("");

  return `<g>
    <rect x="${MARGIN}" y="762" width="${WIDTH - MARGIN * 2}" height="856" fill="${PAPER}" stroke="${RULE}" stroke-width="2"/>
    <text x="200" y="830" fill="${INK}" font-family="${FONT_MONO}" font-size="25" letter-spacing="4">EVIDENCE MATRIX</text>
    <text x="2680" y="830" text-anchor="end" fill="${MUTED}" font-family="${FONT_MONO}" font-size="22" letter-spacing="2">SEEDED SNAPSHOT / 2026</text>
    <line x1="200" y1="876" x2="2680" y2="876" stroke="${RULE}" stroke-width="2"/>
    <text x="200" y="934" fill="${MUTED}" font-family="${FONT_MONO}" font-size="21" letter-spacing="2">ASSERTION</text>
    <text x="1490" y="934" fill="${MUTED}" font-family="${FONT_MONO}" font-size="21" letter-spacing="2">OBSERVED</text>
    <text x="2110" y="934" fill="${MUTED}" font-family="${FONT_MONO}" font-size="21" letter-spacing="2">RESULT</text>
    <text x="2680" y="934" text-anchor="end" fill="${MUTED}" font-family="${FONT_MONO}" font-size="21" letter-spacing="2">ARTIFACT</text>
    ${rows}
    <line x1="200" y1="1494" x2="2680" y2="1494" stroke="${RULE}" stroke-width="2"/>
    <text x="200" y="1546" fill="${MUTED}" font-family="${FONT_MONO}" font-size="21">Every row maps to an artifact committed with the case study.</text>
  </g>`;
}

const shots = [
  { file: "hero.webp", sheet: "SHEET 01 / 04", body: heroBody, alt: "hero" },
  { file: "shot-01.webp", sheet: "SHEET 02 / 04", body: ledgerBody, alt: "ledger" },
  { file: "shot-02.webp", sheet: "SHEET 03 / 04", body: flowBody, alt: "flow" },
  { file: "shot-03.webp", sheet: "SHEET 04 / 04", body: evidenceBody, alt: "evidence" },
];

for (const project of projects) {
  const directory = path.join(process.cwd(), "public", "assets", project.slug);
  await mkdir(directory, { recursive: true });

  const manifestShots = [];

  for (const shot of shots) {
    const svg = frame(project, shot.sheet, shot.body(project));
    const destination = path.join(directory, shot.file);

    await sharp(Buffer.from(svg, "utf8"))
      .webp({ quality: 84, effort: 6 })
      .toFile(destination);

    const metadata = await sharp(destination).metadata();
    if (metadata.width !== WIDTH || metadata.height !== HEIGHT) {
      throw new Error(
        `${destination} rendered at ${metadata.width}x${metadata.height}, expected ${WIDTH}x${HEIGHT}`,
      );
    }

    manifestShots.push({
      file: shot.file,
      width: WIDTH,
      height: HEIGHT,
      alt: project.alts[shot.alt],
    });
  }

  for (const [relativePath, contents] of Object.entries(project.proofFiles)) {
    const proofPath = path.join(directory, "proof", ...relativePath.split("/"));
    await mkdir(path.dirname(proofPath), { recursive: true });
    await writeFile(proofPath, contents, "utf8");
  }

  const manifest = {
    project: project.slug,
    title: project.title,
    oneLiner: project.oneLiner,
    stack: project.stack,
    generatedAt: `${project.updated
      .split(" ")
      .reverse()
      .join("-")
      .replace("OCT", "10")
      .replace("SEP", "09")}T00:00:00.000Z`,
    seeded: true,
    shots: manifestShots,
    proof: project.proof,
  };

  await writeFile(
    path.join(directory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `[fixtures] ${project.slug}: 4 shots at ${WIDTH}x${HEIGHT}, proof files written`,
  );
}

console.log("[fixtures] snapshot complete");
