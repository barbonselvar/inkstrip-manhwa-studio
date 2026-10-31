#!/usr/bin/env bash
# Retry gate between Android emulator attempts (see native-apps.yml).
# Only an infrastructure failure (emulator lost / DevTools broke with no functional
# check failing) earns a fresh emulator; any functional failure fails the job here.
set -euo pipefail
attempt="$1"
outcome=$(cat native-smoke/outcome.txt 2>/dev/null || echo infra-failure)
echo "Attempt $attempt outcome: $outcome"
if [ "$outcome" = "app-failure" ]; then
  echo "::error::Android attempt $attempt: a functional check failed. Not retrying."
  exit 1
fi
if [ "$outcome" = "pass" ]; then
  echo "::error::Attempt $attempt reported pass but its step failed; refusing to retry."
  exit 1
fi
echo "::warning::Android attempt $attempt hit an emulator infrastructure failure; retrying on a fresh emulator."
mkdir -p "$RUNNER_TEMP/android-infra-attempts"
mv native-smoke "$RUNNER_TEMP/android-infra-attempts/attempt-$attempt"
