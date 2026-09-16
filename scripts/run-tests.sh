#!/usr/bin/env bash
#
# Run the root test suite, then every example app that defines a "test" script.
# Keeps going after a failure and reports which suites failed; exits 1 if any did.

cd "$(dirname "$0")/.."

failed=()
npm run test || failed+=(root)

for app in example-apps/*/; do
  [ -f "$app/package.json" ] || continue
  if jq -e '.scripts.test' "$app/package.json" >/dev/null; then
    echo "=== $app"
    (cd "$app" && npm run test) || failed+=("$app")
  fi
done

[ ${#failed[@]} -eq 0 ] || echo "Failed: ${failed[*]}"
exit $(( ${#failed[@]} > 0 ))
