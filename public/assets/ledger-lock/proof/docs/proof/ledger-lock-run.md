# Ledger Lock fixture run

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
