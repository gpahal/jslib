#!/bin/sh
# Every package's `prepublishOnly`, so only the publish step of the Publish workflow, run by hand on
# `main`, publishes. That step sets `JSLIB_RELEASE=1` after checking the tree and building without
# caches. npm would publish `workspace:*` dependencies as they are and drop the `LICENSE` symlink,
# and a publish from anywhere else would skip the checks and could ship a stale build. changesets
# runs `pnpm publish --no-git-checks`, which turns off pnpm's own branch check

case "${npm_config_user_agent:-}" in
  pnpm/*) tool=pnpm ;;
  *) tool=other ;;
esac

if [ "$tool" != pnpm ] \
  || [ "${GITHUB_ACTIONS:-}" != true ] \
  || [ "${GITHUB_EVENT_NAME:-}" != workflow_dispatch ] \
  || [ "${GITHUB_WORKFLOW_REF:-}" != "${GITHUB_REPOSITORY:-}/.github/workflows/publish.yml@refs/heads/main" ] \
  || [ "${JSLIB_RELEASE:-}" != 1 ]; then
  echo "Can't publish outside the Publish workflow. Run it on main from the Actions tab"
  exit 1
fi

echo "Publishing from the Publish workflow on main"
