# CLAUDE.md

Guidance for Claude Code (and future contributors) working in this repo.

## What this is

A $0 Google Classroom deadline reminder bot. Google Apps Script (under a school
Workspace account) polls Classroom on a time-driven trigger, diffs pending
assignments against a Google Sheet, and uses Slack's `chat.scheduleMessage` so
reminders fire at the exact second even if Apps Script itself is down at that
moment. Full design rationale lives in `docs/architecture.md` (the hexagonal
layers and the reconcile/planDeliveries walkthrough) and `docs/decisions.md`
(the ADRs behind each non-obvious choice); `docs/troubleshooting.md` covers
known failure modes. The original milestone plan (M0–M9, now complete) is
still the record of what was built and why, if these docs ever need
cross-checking against it.

## Module boundary rule (do not violate)

`src/core/**` must never import from `src/adapters/**`, `src/infra/**`, or
`src/triggers/**`, and must never reference an Apps Script global
(`SpreadsheetApp`, `Classroom`, `UrlFetchApp`, `PropertiesService`, `LockService`,
`Logger`, `ScriptApp`, `Session`, `Utilities`, ...). This is enforced by
`eslint.config.js`, both rules scoped to `src/core/**` only (`no-restricted-globals`
for the Apps Script globals, `no-restricted-syntax` for importing `adapters`) —
`src/triggers/**` and `src/adapters/**` themselves legitimately import adapters
to wire them together, so the rule would be wrong if applied there too. If a
lint error fires inside `src/core`, fix the architecture, don't suppress the
rule. `core` only knows about `src/ports/*` interfaces.

## Commands

- `npm run lint` / `npm run lint:fix`
- `npm run typecheck` — `tsc --noEmit`, strict mode
- `npm test` / `npm run test:watch` / `npm run test:coverage`
- `npm run build` — bundles `src/main.ts` into `dist/Code.js` via esbuild (IIFE,
  no `import`/`export` in the output — Apps Script has no module loader)
- `npm run deploy` — runs `scripts/deploy.sh`: build, copy `appsscript.json` into
  `dist/`, `clasp push`. Requires a local `.clasp.json` (never committed — copy
  `.clasp.json.example` and fill in your own `scriptId`).

## Secrets

Script Properties only (Slack bot token, Slack user id, cached DM channel id,
the Sheet id — `src/infra/config.ts` is the one module that reads them).
Never in code, never in git. `.env.example` documents the property *names* only —
nothing actually reads a `.env` file at runtime, Apps Script has no such concept.
`.clasp.json` and `.env` are gitignored; `.claspignore` restricts what `clasp push`
uploads to exactly `dist/` + `appsscript.json`.

## Commit style

Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). Small, typed
modules — no god files. A milestone's code and its tests land together.

## Working through the plan

The approved milestone plan (M0–M9) governed scope and acceptance criteria for
each stage, and is now complete. The hexagonal split (don't wire real triggers
before `src/core` has full test coverage, etc.) existed specifically so each
layer could be finished and verified independently — any new feature work
should keep following that same discipline (core stays pure and fully unit
tested; a new adapter gets its own fixture-based contract tests; triggers stay
thin wiring) even though there's no more numbered milestone list driving it.
