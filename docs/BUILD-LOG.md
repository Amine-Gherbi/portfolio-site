# Build log — portfolio-site (P1)

Ten lines, per `_planning/05-CONVENTIONS.md` §3 and master plan §8.10. What the agent produced, and what the
supervisor specified or checked by hand. Repeated in one line on `/colophon` when that route exists.

- Agent (Claude Code 2.1.308, deepseek-v4.1-flash, 69 turns, $2.92) wrote every file in `src/`, `scripts/` and `public/assets/`.
- Supervisor wrote: the positioning sentence, the H1 task card and its DoD, the asset-manifest rules, `CLAUDE.md`, `docs/INVARIANTS.md`, `docs/INTERVIEW.md`, `.gitattributes`, `docs/VERIFY.txt`.
- Supervisor verified independently: `npm run verify` → exit 0; the three manifest failure modes reproduced by hand; one `h1`; three cards; 2880×1800 images; a 1440×900 screenshot kept at `_orchestration/evidence/P1-H1-index-1440x900.png`.
- Fixture content is placeholder: slugs `ledger-lock` / `merge-gate` / `citation-desk` and their dates are invented, and the manifests carry no `proof{}` block. Replaced in P5.
- No human wrote application code; no claim in the README or docs is human-attested without a command attached.
