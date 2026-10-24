#!/bin/sh
# The Publish workflow's first job: CI's `check` job must have passed for the commit being
# published, so CI stays the only gate. The `check` job of the CI workflow passes only when every
# task job passed, or when `gate` skipped them after a passing run on the merged PR's head
set -e

if [ -z "${GITHUB_REPOSITORY:-}" ] || [ -z "${GITHUB_SHA:-}" ]; then
  echo "Can't verify CI outside GitHub Actions. Run the Publish workflow"
  exit 1
fi

# A rerun adds a run, so the one started last decides. Prints `<status> <conclusion>`, or nothing
# when there is no run
run=$(gh api "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/check-runs?check_name=check&filter=latest" \
  -q '.check_runs | sort_by(.started_at) | last | select(. != null) | "\(.status) \(.conclusion)"') || {
  echo "Can't publish: couldn't read the CI runs for $GITHUB_SHA"
  exit 1
}
if [ -z "$run" ]; then
  echo "Can't publish: no \`check\` run for $GITHUB_SHA yet"
  exit 1
fi

status=${run%% *}
conclusion=${run#* }
if [ "$status" != completed ]; then
  echo "Can't publish: CI is still running for $GITHUB_SHA ($status). Run Publish again once it passes"
  exit 1
fi

if [ "$conclusion" != success ]; then
  echo "Can't publish: CI didn't pass for $GITHUB_SHA ($conclusion)"
  exit 1
fi

echo "CI passed for $GITHUB_SHA"
