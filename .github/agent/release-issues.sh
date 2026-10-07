#!/usr/bin/env bash
# The issues a tag ships: every open issue marked Ready for release whose agent PR's
# merge commit is an ancestor of the tag. Prints "<issue> <pr>" per line.
#   release-issues.sh <tag>
# Needs a full clone with the tag fetched, and GH_TOKEN.
set -euo pipefail
tag=$1 R=$GITHUB_REPOSITORY
for issue in $(gh issue list --repo "$R" --state open --label stage:ready-for-release --limit 200 --json number --jq '.[].number'); do
  read -r pr sha < <(gh pr list --repo "$R" --state merged --head "agent/issue-$issue" --limit 1 \
    --json number,mergeCommit --jq '.[0] | "\(.number) \(.mergeCommit.oid)"') || continue
  [ -n "${sha:-}" ] && [ "$sha" != null ] || continue
  git cat-file -e "$sha^{commit}" 2>/dev/null && git merge-base --is-ancestor "$sha" "$tag" && echo "$issue $pr"
done
true
