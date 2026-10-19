#!/bin/sh
# Runs before the gates to fail fast, and after them to catch a build's rewrite of `package.json`
# exports

# Captured first, so a failing `git status` fails the check instead of reading as a clean tree.
# `--untracked-files=all` overrides a `status.showUntrackedFiles=no` setting
status=$(git status --porcelain --untracked-files=all) || {
  echo "Couldn't read the git status"
  exit 1
}

if [ -n "$status" ]; then
  echo "There are uncommitted changes. Commit or stash them first"
  git status --short
  exit 1
fi

echo "No uncommitted changes"
