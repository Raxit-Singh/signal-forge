#!/bin/bash
# SignalForge runner: install, test, typecheck, lint, build. Output -> run-log.txt
cd "$(dirname "$0")" || exit 1
LOG="run-log.txt"
: > "$LOG"
step() {
  echo "" | tee -a "$LOG"
  echo "===== $1 =====" | tee -a "$LOG"
  shift
  "$@" 2>&1 | tee -a "$LOG"
  local code=${PIPESTATUS[0]}
  echo "----- exit $code -----" | tee -a "$LOG"
  return $code
}
{ echo "date: $(date)"; echo "node: $(node -v 2>&1)"; echo "npm: $(npm -v 2>&1)"; uname -m; } | tee -a "$LOG"
if ! command -v node >/dev/null; then
  echo "Node.js is not installed. Install Node 22 LTS from https://nodejs.org and run this again." | tee -a "$LOG"
  read -n 1 -p "Press any key to close"; exit 1
fi
step "npm install" npm install --no-audit --no-fund || { echo "INSTALL FAILED" | tee -a "$LOG"; read -n 1 -p "Press any key to close"; exit 1; }
step "unit tests" npm run test:unit
step "typecheck" npx tsc --noEmit
step "lint" npx eslint .
if [ -f .env.local ]; then
  step "build" npm run build
else
  echo "" | tee -a "$LOG"
  echo "===== build: SKIPPED (no .env.local yet — see ENVIRONMENT_SETUP.md) =====" | tee -a "$LOG"
fi
echo "" | tee -a "$LOG"
echo "DONE. Full log saved to $(pwd)/$LOG — tell Claude it's finished." | tee -a "$LOG"
read -n 1 -p "Press any key to close"
