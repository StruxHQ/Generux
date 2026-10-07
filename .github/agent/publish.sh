#!/usr/bin/env bash
# Runs after Claude, with the PAT that Claude never saw.
#   publish.sh build   push agent/issue-<N> and open (or update) its PR
#   publish.sh fix     push one fix round onto the open PR
# Claude reports through /tmp/agent/result.md: first line READY or BLOCKED, the
# rest is the PR description (READY) or the reason (BLOCKED). Anything other than
# a READY with new commits that leave .github/ alone returns the issue to Idle.
set -uo pipefail
mode=$1 R=$GITHUB_REPOSITORY
run_url="$GITHUB_SERVER_URL/$R/actions/runs/$GITHUB_RUN_ID"
result=/tmp/agent/result.md
base=$([ "$mode" = build ] && echo origin/dev || echo "$RUN_SHA")

idle() {
  { echo "**Agent stopped ($mode) -- back to Idle.**"; echo; echo "$1"; echo; echo "[Run]($run_url)"; } > /tmp/agent/idle.md
  gh issue comment "$ISSUE" --repo "$R" --body-file /tmp/agent/idle.md
  [ "$mode" = fix ] && gh pr edit "$BRANCH" --repo "$R" --add-label no-automerge
  gh issue edit "$ISSUE" --repo "$R" --remove-label stage:build
  exit 0
}

[ -s "$result" ] || idle "Claude finished without writing a result (out of turns, or crashed)."
verdict=$(head -n1 "$result" | tr -d '[:space:]')
body=$(tail -n +2 "$result")
[ "$verdict" = READY ] || idle "$body"
[ -z "$(git status --porcelain)" ] || idle "Claude left uncommitted changes; nothing was pushed."
[ "$(git rev-list --count "$base"..HEAD)" -gt 0 ] || idle "Claude reported READY but made no commits."

guarded=$(git diff --name-only "$(git merge-base origin/dev HEAD)"..HEAD | grep '^\.github/' || true)
[ -z "$guarded" ] || idle "The change touches .github/, which the agent may not modify:
$guarded
This needs a human-authored PR."

remote="https://x-access-token:${GH_TOKEN}@github.com/$R.git"
if [ "$mode" = build ]; then
  git push --force "$remote" "HEAD:refs/heads/$BRANCH" || idle "Push failed."
  printf '%s\n\nIssue: #%s\n' "$body" "$ISSUE" > /tmp/agent/pr.md
  if gh pr view "$BRANCH" --repo "$R" --json state --jq .state 2>/dev/null | grep -qx OPEN; then
    gh pr edit "$BRANCH" --repo "$R" --body-file /tmp/agent/pr.md
  else
    title=$(gh issue view "$ISSUE" --repo "$R" --json title --jq .title)
    gh pr create --repo "$R" --base dev --head "$BRANCH" --title "$title (#$ISSUE)" --body-file /tmp/agent/pr.md \
      || idle "Opening the PR failed."
  fi
  gh issue comment "$ISSUE" --repo "$R" --body "PR opened: $(gh pr view "$BRANCH" --repo "$R" --json url --jq .url)"
else
  git push "$remote" "HEAD:refs/heads/$BRANCH" || idle "Push failed."
  printf '%s\n\n<!-- agent-fix round=%s -->\n' "$body" "$ROUND" > /tmp/agent/fix.md
  gh pr comment "$PR" --repo "$R" --body-file /tmp/agent/fix.md
fi
