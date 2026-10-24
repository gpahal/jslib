#!/bin/sh
# Every release is a commit on the `main` branch that is already the remote `main` and that CI
# passed, so CI is the only gate. changesets runs `pnpm publish --no-git-checks`, which turns off
# pnpm's own branch check. `git ls-remote` reads the remote without touching local refs. The `check`
# job of the CI workflow passes only when every task job passed, or when `gate` skipped them after a
# passing run on the merged PR's head
set -e

# A detached HEAD or another branch fails even at the same commit
branch=$(git symbolic-ref --short -q HEAD) || branch=
if [ "$branch" != main ]; then
  echo "Can't publish: HEAD isn't the main branch. Check out main"
  exit 1
fi

remote=$(git ls-remote origin refs/heads/main | cut -f1)
if [ -z "$remote" ]; then
  echo "Can't publish: couldn't read main from origin"
  exit 1
fi

sha=$(git rev-parse HEAD)
if [ "$sha" != "$remote" ]; then
  echo "Can't publish: HEAD isn't origin/main. Check out main, pushed and up to date"
  exit 1
fi

if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
  echo "Can't publish: log in with \`gh auth login\` to check CI"
  exit 1
fi

# The repository of `origin`, which HEAD was compared with. Without an argument, `gh` picks its own
# default, such as an `upstream` remote
repo=$(gh repo view "$(git remote get-url origin)" --json nameWithOwner -q .nameWithOwner) || {
  echo "Can't publish: couldn't find the GitHub repository"
  exit 1
}

# A rerun adds a run, so the one started last decides. Prints `<status> <conclusion>`, or nothing
# when there is no run
run=$(gh api "repos/$repo/commits/$sha/check-runs?check_name=check&filter=latest" \
  -q '.check_runs | sort_by(.started_at) | last | select(. != null) | "\(.status) \(.conclusion)"') || {
  echo "Can't publish: couldn't read the CI runs for $sha"
  exit 1
}
if [ -z "$run" ]; then
  echo "Can't publish: no \`check\` run for $sha yet"
  exit 1
fi

status=${run%% *}
conclusion=${run#* }
if [ "$status" != completed ]; then
  echo "Can't publish: CI is still running for $sha ($status)"
  exit 1
fi

if [ "$conclusion" != success ]; then
  echo "Can't publish: CI didn't pass for $sha ($conclusion)"
  exit 1
fi

echo "HEAD is main at origin/main and CI passed"
