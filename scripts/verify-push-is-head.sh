#!/bin/sh
# The pre-push gates check the working tree, so this fails a push of any commit other than HEAD,
# such as `git push origin other-branch`. Git passes one `<local ref> <local sha> <remote ref>
# <remote sha>` line per pushed ref on stdin. `cs-publish` passes /dev/null, having already checked
# that HEAD is `origin/main`
set -e

# A run of `pnpm pre-push` from a terminal, which would otherwise wait for lines typed there
if [ -t 0 ]; then
  exit 0
fi

head=$(git rev-parse HEAD)

while read -r local_ref local_sha remote_ref _; do
  # A deletion's all-zeros SHA pushes no commit
  case $local_sha in
    *[!0]*) ;;
    *) continue ;;
  esac
  # An annotated tag passes when it points to HEAD
  commit=$(git rev-parse --verify --quiet "$local_sha^{commit}") || commit=
  if [ "$commit" != "$head" ]; then
    echo "Can't push $local_ref to $remote_ref: it isn't HEAD. Check out the branch you push, so the gates check it"
    exit 1
  fi
done

echo "Every pushed ref is HEAD"
