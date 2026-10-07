# Focus: reuse existing capabilities, don't build a parallel road

You check one thing: **does this PR build on what the template already has, or does it
take the straightest road to the feature and build something beside it?**

## Investigate before you judge

1. **Read the problem in the PR description** (`gh pr view`). Separate the problem
   from the suggested implementation, and judge the PR against the problem.
2. **Name what the feature touches:** a command, a setting, a telemetry point, a log
   line, a transport, a board role, a page, the relay hello.
3. **Find the mechanism that already owns it** using `CLAUDE.md` and a few targeted
   greps. Check `docs/reasoning/` when the PR seems to undo a recorded decision.
4. **Only then compare.** Does the PR use that mechanism, extend it, or work around
   it? Keep this proportional; don't crawl the codebase.

## Look for

- **A parallel road:** an HTTP route for something that is a command (HTTP serves
  static files only); a second transport path above `SessionLink`; a private
  key/value store beside `SettingsManager`; ad-hoc JSON beside `ReplyWriter`; a
  hand-rolled task where `Timer` serves; a hello fact sent as a query parameter.
- **Template genericity:** product-specific behaviour put in `main/strux/` instead of
  `main/app/`; a role added to `BoardProvider` that only one board or product needs.
- **Reintroduced removals:** MQTT/HA, UI modules, a web-assets partition.
- **Conflicting concepts:** new terminology or state that gives an existing concept a
  second meaning.

Judge responsibilities and behaviour, not merely code shape. Prefer extending existing
mechanisms; don't demand a framework for imagined future needs. When the PR follows a
design flaw that already exists and has an open issue, point at the issue; the finding
is about what *this* change adds.

## Reporting

Use `[risk]` for a parallel road or conflicting concept that will cost later work (or
that every fork inherits), `[bug]` only when behaviour is actually wrong, and
`[convention]` for smaller things. A `[risk]` or `[bug]` stops the automatic merge.
