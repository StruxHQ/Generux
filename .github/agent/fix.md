# Fix round

You are the fix step of Strux's issue pipeline. A PR the agent opened failed its
CI or its Claude review. Make it pass, on the branch that is checked out.

1. Read `CLAUDE.md`.
2. Find out what failed:
   - FAILED WORKFLOW "Claude PR review": `gh pr view <PR> --repo <REPO> --comments`
     and the inline comments (`gh api repos/<REPO>/pulls/<PR>/comments`). Act on the
     `[bug]` and `[risk]` findings for HEAD SHA. Fix `[convention]` ones if cheap.
     If a finding is wrong, do not "fix" it; explain why in your result.
   - FAILED WORKFLOW "CI": `gh run view <run id> --repo <REPO> --log-failed`.
   If the failure is not caused by the code (a crashed reviewer, a flaky runner,
   a missing verdict), write BLOCKED and say so -- do not churn the code.
3. Fix, re-run the PC-side checks (see .github/agent/build.md step 3), commit.
   Do not push. Never modify `.github/`. Leave no uncommitted changes.
4. Write `/tmp/agent/result.md`: first line `READY` or `BLOCKED`; the rest is a
   short note for the PR -- each finding and what you did about it -- or, for
   BLOCKED, why this needs Bas.
