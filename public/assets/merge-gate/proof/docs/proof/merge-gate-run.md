# Merge Gate fixture run

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
