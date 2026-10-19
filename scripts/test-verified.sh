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
  "${SITES_PROJECT_ROOT}"/tests/*.test.mjs
