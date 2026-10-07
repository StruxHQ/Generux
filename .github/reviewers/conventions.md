# Focus: layering, contracts and conventions

You check whether the PR follows the structure and conventions in `CLAUDE.md`.

Look for:

- **Layering.** Dependencies run board → framework (`main/strux/`) → application
  (`main/app/`), with `main/lib/` beneath all three. Strux never reaches up to
  `AppProvider` or sideways into hardware. Anything the framework needs from the
  application is *registered* (commands, settings, telemetry), never fetched.
  `BoardProvider` holds roles only; a concrete driver accessor belongs on
  `BoardContext`. Something in `lib/` must name no layer.
- **Managers.** Take their layer's provider and reach everything through it, have
  copy/move deleted, initialize in `Init()` behind an `InitState`. A new manager is
  added to the provider, the context (member *and* ordered `Init()`) and the right
  source list in `main/CMakeLists.txt`.
- **Commands.** Static-storage `CommandEntry` tables with a one-line description;
  every argument declared through `ctx.readArgs(...)` with a description (a handler
  that skips it has no `help` and runs its body when described); replies written
  through `ctx.reply` scopes, closed before anything else touches `ctx.out`.
- **Settings.** NVS keys of at most 15 characters. This is only asserted at runtime
  and boot-loops the device, so an over-long key is a `[bug]`.
- **Strings.** String literals are ASCII only (a non-ASCII literal reaches the wire as
  invalid UTF-8): a `[bug]`. `snprintf` with `sizeof` bounds; no `strcpy`/`strcat`.
- **Board and sdkconfig.** No `CONFIG_IDF_TARGET` in a board's `sdkconfig.defaults`;
  component `REQUIRES` in `main/CMakeLists.txt` or `idf_component.yml`, never in a
  `board.cmake`.
- **Template scope.** No MQTT / Home Assistant layer, no UI-module mechanism; the
  frontend is one SPA with hash routing and relative asset paths.
- **Tests.** New pure logic in `main/lib/` (parsing, framing, argument handling) comes
  with a case in `test/`, and pure frontend logic with a test beside it.
- **Docs.** A change to a documented contract or convention updates `CLAUDE.md` in the
  same PR. `docs/reasoning/` notes are immutable: a PR that edits an existing note
  instead of adding a new one is a `[convention]`. `docs/next-up.md` holds only active
  work.
