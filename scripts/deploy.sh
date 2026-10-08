#!/usr/bin/env bash
# Bundles src/main.ts (and everything it pulls in) into a single Apps-Script-safe
# dist/Code.js, copies the manifest alongside it, then pushes via clasp.
#
# Apps Script concatenates every file in a project into one global scope — it has
# no import/export resolution — so dist/ must contain exactly one bundled JS file
# plus appsscript.json, never the per-module src/ layout.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
npm run build
cp appsscript.json dist/appsscript.json

npx clasp push
