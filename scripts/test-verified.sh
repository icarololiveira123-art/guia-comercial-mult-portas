#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

if [[ "${SITES_TEST_SKIP_BUILD:-}" != "1" ]]; then
  npm run build >/dev/null
fi
exec node --experimental-loader "${SITES_PROJECT_ROOT}/tests/cloudflare-workers-loader.mjs" --test \
  "${SITES_PROJECT_ROOT}/tests/auth-contract.test.mjs" \
  "${SITES_PROJECT_ROOT}/tests/catalog-assets.test.mjs" \
  "${SITES_PROJECT_ROOT}/tests/catalog-learning.test.mjs" \
  "${SITES_PROJECT_ROOT}/tests/coach-quality.test.mjs" \
  "${SITES_PROJECT_ROOT}/tests/dependency-protection.test.mjs" \
  "${SITES_PROJECT_ROOT}/tests/fair-messages.test.mjs" \
  "${SITES_PROJECT_ROOT}/tests/github-local-api.test.mjs" \
  "${SITES_PROJECT_ROOT}/tests/github-local-admin.test.mjs" \
  "${SITES_PROJECT_ROOT}/tests/github-user-isolation.test.mjs" \
  "${SITES_PROJECT_ROOT}/tests/marketing-daily.test.mjs" \
  "${SITES_PROJECT_ROOT}/tests/password-hashing.test.mjs" \
  "${SITES_PROJECT_ROOT}/tests/provider-messages.test.mjs" \
  "${SITES_PROJECT_ROOT}/tests/rendered-html.test.mjs" \
  "${SITES_PROJECT_ROOT}/tests/schema-bootstrap.test.mjs" \
  "${SITES_PROJECT_ROOT}/tests/security-contract.test.mjs" \
  "${SITES_PROJECT_ROOT}/tests/state-contract.test.mjs" \
  "${SITES_PROJECT_ROOT}/tests/xlsx-export.test.mjs"
