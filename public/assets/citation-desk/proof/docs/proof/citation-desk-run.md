# Citation Desk fixture run

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
