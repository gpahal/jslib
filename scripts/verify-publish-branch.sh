#!/bin/sh
# Every release is a commit already on the remote `main`. changesets runs
# `pnpm publish --no-git-checks`, which turns off pnpm's own branch check. `git ls-remote` reads the
# remote without touching local refs
set -e

remote=$(git ls-remote origin refs/heads/main | cut -f1)
if [ -z "$remote" ]; then
  echo "Can't publish: couldn't read main from origin"
  exit 1
fi

if [ "$(git rev-parse HEAD)" != "$remote" ]; then
  echo "Can't publish: HEAD isn't origin/main. Check out main, pushed and up to date"
  exit 1
fi

echo "HEAD matches origin/main"
