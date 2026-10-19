#!/bin/sh
# npm packs every file in the `src` folders that `files` lists, untracked and gitignored ones too,
# such as a `.env` or a scratch file

# The pathspec is relative to the working directory
cd "$(git rev-parse --show-toplevel)" || {
  echo "Couldn't find the repo root"
  exit 1
}

# Captured first, so a failing `git status` fails the check instead of reading as no ignored files.
# `--untracked-files=all` lists each file rather than a folder of ignored files
status=$(git status --porcelain --ignored --untracked-files=all -- ':(glob)packages/*/src/**') || {
  echo "Couldn't read the git status"
  exit 1
}
# `--ignored` lists ignored paths with `!!` and untracked ones with `??`. npm never packs `.DS_Store`
ignored=$(printf '%s\n' "$status" | grep -E '^(!!|\?\?)' | grep -v '/\.DS_Store$')

if [ -n "$ignored" ]; then
  echo "Untracked or ignored files under packages/*/src would be published. Delete, move or commit them first"
  echo "$ignored"
  exit 1
fi

echo "No untracked or ignored files under packages/*/src"
