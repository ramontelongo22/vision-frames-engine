#!/usr/bin/env bash
# O-06 live comparison: the same photos, identity and places through Gemini and OpenAI as
# image makers. QA (OpenAI analyzer) and language cleanup (gpt-6-luna) are the same for both.
# PAID: needs GEMINI_API_KEY and OPENAI_API_KEY. Run only with the owner's approval.
#
#   scripts/o06-compare.sh --ref a.jpg [--ref b.jpg] --identity "calm, grounded" [--board 3] [--place "..."]
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
OUT="out/o06-$(date +%Y%m%d-%H%M%S)"
npm run -s build
for g in gemini openai; do
  echo "== $g =="
  node dist/runner.js --live --generator "$g" --out "$OUT/$g" "$@" || echo "$g run exited $?"
done
node scripts/o06-report.mjs "$OUT"
echo "Report: $OUT/compare.html"
