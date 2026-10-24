#!/bin/sh
# Only the Publish workflow, run by hand on `main`, publishes. Its `publish` job runs in the `npm`
# environment, which only `main` can deploy to and which npm's trusted publishing names, after its
# `verify` job checks that CI passed for the commit. changesets runs `pnpm publish --no-git-checks`,
# which turns off pnpm's own branch check
if [ "${GITHUB_ACTIONS:-}" != true ] || [ "${GITHUB_EVENT_NAME:-}" != workflow_dispatch ] || [ "${GITHUB_REF:-}" != refs/heads/main ]; then
  echo "Can't publish outside the Publish workflow. Run it on main from the Actions tab"
  exit 1
fi

echo "Publishing from the Publish workflow on main"
