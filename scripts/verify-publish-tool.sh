#!/bin/sh
# Every package's `prepublishOnly`, so only `pnpm cs-publish`, which sets `JSLIB_RELEASE=1`,
# publishes. npm would publish `workspace:*` dependencies as they are and drop the `LICENSE`
# symlink, and a bare `changeset publish` or `pnpm publish` would skip the checks and could ship a
# stale build

case "${npm_config_user_agent:-}" in
  pnpm/*) tool=pnpm ;;
  *) tool=other ;;
esac

if [ "$tool" != pnpm ] || [ "${JSLIB_RELEASE:-}" != 1 ]; then
  echo "Can't publish outside \`pnpm cs-publish\`, which the Publish workflow runs"
  exit 1
fi

echo "Publishing through pnpm cs-publish"
