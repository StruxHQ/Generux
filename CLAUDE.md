# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Wavy is a square-wave generator: one pin, 50% duty, 5 Hz–100 kHz, set from the web UI (`WaveManager` in `main/app/`, `LedcSquareWave` in `main/hardware/drivers/`). It is a fork of **Strux**, a template/foundation for ESP32 firmware (ESP-IDF v6.0, C++, FreeRTOS) with a React web UI. The framework under `main/strux/` keeps the Strux names (`StruxContext`, `StruxProvider`, the `X-Strux-Token` relay header) on purpose, so improvements can be backported between this repo and the template — keep it generic, and put Wavy-specific code in `main/app/` and `main/hardware/`. "Strux" in the rest of this file means that framework.

## Build commands

Firmware (requires ESP-IDF v6.0+ environment). **Two IDF installs, and the tools are not where the docs assume:** `C:\esp\v6.0\esp-idf` is the framework, while the toolchain is an ESP-IDF Installation Manager layout under `C:\Espressif\tools`, activated by dot-sourcing `C:\Espressif\tools\Microsoft.v6.0.PowerShell_profile.ps1` — `export.ps1`/`export.sh` both fail, because they look for a python env that install never created there.

```bash
idf.py set-target esp32
idf.py build                          # also builds the frontend if pnpm is installed
idf.py -p <PORT> flash monitor
idf.py -DBOARD=<name> build           # select a board from main/hardware/boards/ (default: esp32_devkit)
```

Boards today: `esp32_devkit` (ESP32-WROOM-32) and `esp32c3_supermini` (ESP32-C3, USB-C, LED on GPIO8 active low). A non-default chip needs *both* halves — `idf.py -DBOARD=esp32c3_supermini set-target esp32c3`, then build — because `set-target` picks the chip and `-DBOARD` picks the pinout, and a board's `sdkconfig.defaults` cannot supply the chip (see the note below). Add `-B build_c3 -D SDKCONFIG=sdkconfig.c3` to keep a second board's tree beside the default one instead of overwriting it.

**A new line in `sdkconfig.defaults` does not reach an existing build — but the build now refuses instead of lying.** Generated `sdkconfig` files are loaded *after* the defaults and win every conflict, and an option left at its default is still recorded there — as `# CONFIG_FOO is not set` — so adding `CONFIG_FOO=y` to the defaults changes nothing in a tree that already has one. That used to fail silently, exactly like the `CONFIG_IDF_TARGET` case below. A guard in the root [CMakeLists.txt](CMakeLists.txt) now checks every assertion in the composed defaults against what was generated and stops the build naming the options that did not take, with the fix in the message: delete the generated file (`sdkconfig` and `sdkconfig.*` are gitignored and reproducible) and re-run `set-target`. So pulling a commit that changes the defaults gives you a build error, not a wrong binary. A deliberate local override of something the defaults assert needs `-DSTRUX_ALLOW_SDKCONFIG_DRIFT=ON`.

Frontend (React 19 + TypeScript + Vite + Tailwind + shadcn/ui, package manager is pnpm):

```bash
cd frontend
pnpm dev          # hot-reload dev server, proxies WebSocket to a running device
pnpm build        # tsc -b && vite build into ../www (packed and linked into the app image)
pnpm typecheck    # tsc -b --force (plain `tsc --noEmit` checks NOTHING:
                  # the root tsconfig has files: [])
```

`pnpm dev` gives HMR for the whole UI — one bundle, one build, every page live — and
proxies the WebSocket to the device named by `frontend/src/config.ts`'s `DEV_HOST`.

There are no automated tests; verification is building, flashing, and driving the device over its own wire:

1. `idf.py build`, `idf.py -p <PORT> flash` — find the port, don't trust a number in a doc.
2. Open a WebSocket to `ws://<device>/ws`, or `ws://<relay>/devices/<deviceId>/ws` through the relay. **No login step** — auth is three ordinary commands (`auth hello|login|resume`) and is off entirely while `web.password` is empty, which is the default.
3. Send a chunk: `[sid u16 LE][flags u8][payload]`, payload starting with the envelope line `{"type":"<category> <command>", …args}\n`, body after it — same chunk or further chunks sharing the sid. `FLAG_FINAL` (0x01) on the last.
4. Read chunks with your sid until one carries `FLAG_FINAL` (or `FLAG_REJECT` 0x02, payload = reason). **Skip session 0** — those are log broadcasts, not your reply. Non-final chunks are reply data, or progress on a long write.
5. Keep each payload inside the transport's inbound window (4096 on both) — a larger frame is refused, not split.

`help list` enumerates every category and command off the device, and `help list -category X -command Y` returns that command's declared arguments, so a probe script needs no source to know what to send. `help describe` is the same registry in ONE reply — every category, every command, its description and its full argument declarations — for a caller that has to compose a call without asking twice, and `system describe` is the matching answer about the device itself (name, firmware, one-line description, free-form instructions). Those two are what the relay's MCP surface asks a device, and nothing about them is a second copy: the routes come off the chain and the arguments come from the handler, as they always have.

### Where docs go — three places, nothing else

- **[docs/next-up.md](docs/next-up.md) — what is being worked on *right now*.** Read it first. It is rewritten constantly and deliberately kept tiny: an item is **removed** the moment it lands or is dropped, never annotated, never ticked off in place. Only active work belongs here. If something wants to persist, it does not go in this file — it becomes a GitHub issue (if it is work) or a note (if it is understanding).
- **GitHub issues — work for later.** One issue per item, in whichever repository owns it: firmware here, anything server-side in [strux-relay](https://github.com/vanBassum/strux-relay). `docs/backlog/` was this until 2026-09-15 and is gone: a file per topic accumulated open items, settled decisions and hardware-proof logs in one place, so the work was hard to see and the knowledge had nowhere to go when the work finished. An issue holds work only, and what mattered about a closed one lives in a note by then.
- **`docs/reasoning/` — why things are the way they are.** Append-only, immutable once written, one understanding-delta per note, dated. Never edited: a new understanding is a new note, related to the old one via `builds-on` or `supersedes`. This is the durable record — prefer it over prose documentation anywhere.

Design documents, implementation plans and an ideas folder were all removed on 2026-08-05: they asserted the present tense, so they rotted faster than they were read (see `docs/reasoning/2026-08-05-15h29-a-document-asserts-the-present-tense-so-it-rots.md`). A plan goes in an issue; the reasoning behind it goes in a note; how to operate something goes in this file. Deleting a doc is not losing it — git has it.

## Architecture

### Three layers, each with a context and a provider

Dependencies run one way only, bottom to top:

Every layer is the same pair: a **context** owning the layer's instances, and a **provider** saying what the layer above may reach for. A manager takes exactly one reference — its own layer's provider — and finds everything through it.

| Layer | Context (owns) | Provider (exposes) |
|---|---|---|
| `main/hardware/` — the **board** | `BoardContext` — driver instances, bus hosts | `BoardProvider` ([hardware/interfaces/BoardProvider.h](main/hardware/interfaces/BoardProvider.h)) — the roles a board owes |
| `main/strux/` — the **framework** | `StruxContext` — the nine Strux managers | `StruxProvider` ([main/strux/StruxProvider.h](main/strux/StruxProvider.h)) |
| `main/app/` — the **application** | `AppContext` — this product's managers | `AppProvider` ([main/app/AppProvider.h](main/app/AppProvider.h)) |

[main.cpp](main/main.cpp) is four calls: `board.Init()`, `strux.Init()`, `application.Init()`, then the OTA validity mark. **The order *within* a layer lives in that layer's context**, not here — `StruxContext::Init()` carries Strux's ordering and its constraints (Relay after WebServer, whose `Authenticator` it shares; Telemetry after Relay, down whose pipe it leaves), so a fork pulling a new framework manager gets its position along with it.

Two rules keep the graph acyclic, and both matter more than they look:

- **Strux never reaches up, and never sideways into hardware.** `StruxProvider` has no `getBoard()` and no way to see `AppProvider`. Hardware belongs to the application: a framework that called `GetLed()` would put that role on `BoardProvider` and oblige every board in every fork to bind one.
- **Anything the framework needs from the application is *registered*, not fetched.** The app registers commands, settings and telemetry points into Strux from its own `Init()`. A Strux manager wanting `AppProvider&` is a design error, not a missing accessor.

`BoardProvider` declares **roles only** (`Led&` today), and that boundary is what keeps it from becoming the union of every board's peripherals: concrete driver accessors — the escape hatch for when the application needs a driver's full API — stay on `BoardContext` itself, checked at compile time. So the day one board grows a display, no other board owes a `MockDisplay`. `AppProvider::getBoard()` returns `BoardContext&`, not `BoardProvider&`, precisely so that escape hatch stays reachable.

What the provider buys over the older duck-typed `Board` is where the failure lands: a board that forgets a role now fails *in the board*, leaving a pure virtual unimplemented, instead of failing later at a call site in application code. What it costs is that a board must bind every role even if this product never uses it — which was already the discipline (`MockLed` exists for exactly that), so the trade is cheap.

Every manager, in either managed layer:

- takes its layer's provider (`StruxProvider&` or `AppProvider&`) in its constructor and reaches everything through it, never directly,
- has copy/move deleted,
- initializes in `Init()` guarded by an `InitState` (`lib/rtos/InitState.h`), not in the constructor.

Adding a **framework** manager: create the class, add it to `StruxProvider`, `StruxContext` (member *and* the ordered `Init()`), and `STRUX_SOURCES` + `INCLUDE_DIRS_LIST` in [main/CMakeLists.txt](main/CMakeLists.txt). Adding an **application** manager: the same, against `AppProvider`, `AppContext` and `APP_SOURCES` — and nothing in `strux/` is touched. [main/app/LedManager/](main/app/LedManager/) is the worked example: it owns the board LED and uses it to say whether the device is connected to its relay server — lit while `RelayManager::IsConnected()`, dark otherwise, polled every 250 ms on a `Timer`. Along the way it registers a setting, two commands and a telemetry point without a single edit to the framework — the link state needed no new accessor, because `IsConnected()` was already the framework's own answer. Its browser half is the frontend's home page ([frontend/src/pages/HomePage.tsx](frontend/src/pages/HomePage.tsx) over [use-led.ts](frontend/src/hooks/use-led.ts) and `getLed`/`setLed` in `backend.ts`), so deleting the example when the product has real features means deleting one manager, replacing the contents of one page, and changing the first line of `AppSidebar`'s nav.

Note: the two source lists are separated so a fork does not fight the template over one file, but they are still *one* file and still one ESP-IDF component. Making `strux/` a real component is the step that would make syncing a pull rather than a merge; it has not been taken.

### Layer separation within the board

- `main/hardware/` — changes when you swap the board. Depends on nothing above it: `BoardContext` takes no provider (drivers take their pins and buses as constructor arguments, so nothing here needs one to find a peer) and no layer above is visible from it. Split into:
  - `boards/<name>/` — one folder per target board: `BoardConfig.h` (pins/constants), `BoardContext.h`/`BoardContext.cpp` (the board's `BoardContext : BoardProvider` — owns every driver instance and bus host; `BoardContext.cpp` is added via `BOARD_SOURCES` in the `board.cmake` fragment), and an optional `sdkconfig.defaults` overlaying the common root one. Selected with `-DBOARD=<name>`; only the chosen board folder is on the include path, so `#include "BoardConfig.h"` and `#include "BoardContext.h"` resolve to it.
  - `interfaces/` — the role interfaces in application vocabulary (`Led`), 1–3 pure-virtual methods each, never chip or GPIO vocabulary — plus `BoardProvider`, which assembles them into the list every board owes. Drivers implement the roles (`GpioLed : Led`); a board without the hardware binds a mock (`MockLed`). Adding a role to `BoardProvider` obliges every board to bind it, so add one only when application code speaks in that role; when the application needs a driver's full API, expose a concrete accessor from `BoardContext` instead and leave `BoardProvider` alone (escape hatch). Multi-instance roles get a semantic enum (`Sensor::Ambient`, never `Sensor_2`) mapped by the board — introduce it with the first multi-instance role.
  - `drivers/` — board-independent chip/peripheral drivers shared by boards (e.g. `GpioLed.h`), taking pins/buses as constructor parameters (passed by the board from its `BoardConfig` constants).
- `main/strux/` — the framework: the ten managers. Changes when the template improves.
- `main/app/` — changes when you add a feature to *this* product. Hardware driver *instances* live in the board's `BoardContext` class, reached via `AppProvider::getBoard()`.
- `main/lib/` — the substrate all three layers stand on, and **not** part of any of them: RTOS wrappers (`Task`, `Mutex`, `Timer`), `Stream`/`MemoryStream`/`BufferStream`, `JsonWriter`/`JsonReader`, `DateTime`/`TimeSpan`. Rarely changes. The request/reply seam (`CommandContext`, `ArgReader`, `ReplyWriter`) lives in `lib/protocol/`. It sits beside the layers rather than inside `strux/` because the board layer uses `InitState` and the application uses `Timer` — under `strux/` both would be reaching into the framework for them, which is exactly what the layering forbids. The test for whether something belongs here: it names no layer.

Every folder is on the include path, so headers are included by name alone (`#include "Stream.h"`) and moving one between layers does not touch its callers.

Note: ESP-IDF runs an early expansion pass *without* the `BOARD` cache var, and two things a board would like to own are resolved there, so neither can come from the board folder:

- **Component `REQUIRES`** — `board.cmake` fragments cannot change them. IDF built-in deps go in `COMPONENT_REQUIRES` in [main/CMakeLists.txt](main/CMakeLists.txt); managed components go in [main/idf_component.yml](main/idf_component.yml).
- **The chip.** A `CONFIG_IDF_TARGET` line in a board's `sdkconfig.defaults` is read too late and loses silently to whatever the existing `sdkconfig` says — the build then runs with the *wrong toolchain* rather than failing. The chip is selected with `idf.py set-target`, never from a board file.

### Commands (the device's RPC surface)

`CommandManager` is a pure dispatcher — it knows no commands and no other managers. Each command lives in the manager that owns its domain:

- Handlers have the signature `void Handler(Stream& in, Stream& out)`: `in` carries the request payload, the handler writes its complete reply to `out`. Streams are the contract; JSON is a dialect the handler opts into by constructing `JsonReader`/`JsonObject` on line one. Binary payloads (e.g. firmware chunks) use the same contract.
- Owners declare an `inline static CommandEntry commands_[]` table ([CommandEntry.h](main/strux/CommandManager/CommandEntry.h)) with `InvokeCommand<&Owner::Method>` trampolines, and hand it to `CommandManager::Register()` from their `Init()`. Tables must have static storage duration — a registered entry that dies aborts with `FATAL`.
- `help list` is the registry describing itself and the one command `CommandManager` owns: categories and names come off the chain, and a command's *arguments* come from the command itself, by re-dispatching it with a `DescribeArgReader` that prints the declarations instead of filling them and stops the handler at its own `RETURN_IF_ERROR`. So calling `ctx.readArgs(...)` is not optional — a handler that skips it has no `help` and, worse, runs its body when described (logged as an error).
- Two transports reach `Execute()`, and they differ *only* below `SessionLink` ([SessionLink.h](main/lib/protocol/SessionLink.h) — the protocol layer lives in `lib/protocol/`, not under a transport, because the transports depend on it and not the reverse): the local browser WebSocket (`WsSessionLink`, frames read on the httpd task) and the outbound relay pipe (`RelaySessionLink`, frames read on the relay's own task via [RelaySocket](main/strux/RelayManager/RelaySocket.h), a WebSocket driven at the transport layer rather than through `esp_websocket_client` — a callback-delivered frame cannot be the bottom of a streaming handler, and going one layer down is what removed the queue, the per-frame `malloc` and the dropped chunks). Both transports therefore *read* on the task that runs the command. Above that seam everything is shared — `Session` (the stream), `protocol::RunCommandSession` in [CommandEnvelope.h](main/lib/protocol/CommandEnvelope.h) (names the request, dispatches it, closes or refuses the reply), and `AuthGate` — so no handler knows or cares which transport it is serving. There is no HTTP command route; HTTP serves static files only. Wire format is binary session chunks `[session:u16 LE][flags:u8][payload]`, not a JSON envelope.
- Remote access works: `RelayManager` dials out to a server so the device is reachable off-LAN, and the server pulls the device's own frontend with the ordinary `getWebFile` command. The connect URL carries **identity only** — `?id=<device-id>` plus an `X-Strux-Token` header, the one field the token proves — and everything a human reads (name, project, firmware version, git commit, IDF version, build date) goes up as a **hello**: one chunk on reserved session `0xFFFE` immediately after every connect, a flat JSON map of string keys. Adding a fact is a key, not a query parameter; the relay stores what it gets, shows what it understands and ignores the rest. **The `HelloField` table at the top of `RelayManager::SendHello` is the whole contract** — one row per key, where its value comes from, and whether this firmware treats it as required (`name`, `project`, `fw` today; `commit`, `idf`, `built` are optional, `commit` because a source drop with no `.git` is a legitimate way to build this). A required field that comes out empty is logged as the bug it is, and the hello still goes. A *pending* device sends nothing, because it is refused before the upgrade — see `docs/reasoning/2026-09-16-16h20-a-relay-must-not-record-what-it-has-not-yet-decided-to-trust.md`. Server in its own repository ([vanBassum/strux-relay](https://github.com/vanBassum/strux-relay)), which is also where what is left to do is tracked, as issues. Live at `https://strux.vanbassum.com` behind Traefik and Authentik: a device must be approved and present its own token or the upgrade is refused with a 403. Off by default (`relay.enabled`).

Log lines broadcast to all WebSocket clients via `ConsoleManager`. Its log ring is **deliberately** one allocation at `Init`, sized from constants, never freed, and preferring PSRAM where the board has it — it is effectively static already, and turning it into a plain array to satisfy a literal reading of "no dynamic buffers" would cost the PSRAM preference and buy nothing. The frontend side is a singleton `BackendService` ([frontend/src/lib/backend.ts](frontend/src/lib/backend.ts)) that matches replies to requests by id and auto-reconnects.

`UpdateManager`'s entire external surface is its command table: session-based updates addressed by partition label (`updateBegin`/`updateWrite`/`updateEnd`), pull OTA from URL, and partition download. App partitions go through `esp_ota_*` (image validation, running slot refused); data partitions are raw erase+write. The built frontend is **not** a partition: `main/strux/WebAssets/pack_web_assets.py` packs `www/` into one gzipped-per-file blob that `EMBED_FILES` links into the app image, so a firmware image is the whole product and a UI change is an ordinary app OTA. `WebAssets` is a const table over that blob in flash-mapped rodata — no RAM, no filesystem, no mount — and both serving routes (the local HTTP route and `web read`) go through `StaticFileHandler::Resolve` into it. One blob rather than one `EMBED_FILES` entry per asset because vite content-hashes its filenames and `EMBED_FILES` needs its list when CMake configures.

### Settings

Settings are typed leaf objects (`lib`-style, [TypedSettings.h](main/strux/SettingsManager/TypedSettings.h)) declared in the manager that owns them and registered at runtime:

```cpp
inline static UInt32Setting port_{ "myfeature.port", "My Feature Port", 1883 };
// in Init():  settings.Register({ &port_ });
uint32_t p = port_.Get();   // NVS value or the typed default
```

`SettingsManager` is the NVS link; the settings UI is generated dynamically from the registered definitions.

**A key is at most 15 characters** — NVS's limit, asserted in `Register()` at *runtime*, so an over-long key compiles fine and then boot-loops the device on the assert. Nothing catches it earlier. `telemetry.enabled` (17) does not fit; `telem.enabled` does.

### Telemetry

A manager records a measurement and the relay puts it in InfluxDB: the **device formats
Influx line protocol**, writes it to the reserved device-initiated session `0xFFFF`, and the
relay batches lines and POSTs them without reading one. A different reserved id from the
log broadcast's session 0 because the destination differs — a database, not every browser —
rather than a discriminator inside the payload. Off unless `telem.enabled`.

Three ways to get the line protocol wrong, each of which fails quietly:

- **The first field takes no leading comma.** The tag buffer legitimately starts with one
  (it is appended to a tag); the field buffer must not, because it is written straight
  after the space that ends the tags. Getting this wrong produces `invalid field format`
  from Influx and nothing else — every point refused, silently, unless you read the
  relay's log.
- **An integer field needs the `i` suffix**, or Influx stores it as a float and a later
  integer write to the same field is rejected as a type conflict.
- **Testing the relay with hand-written line protocol proves nothing about the device.**
  It faithfully forwarded a malformed line for 17 points before anyone noticed. The
  formatter needs a real parser at the other end.

### The UI is one page, not modules

**The frontend is one ordinary SPA.** `frontend/src/pages/` behind `AppSidebar` and a
hash router, shadcn components over radix-ui, lucide icons. `HomePage` is the product's
own screen — the LED demo in this template — and `Console`, `Settings` and `Firmware`
follow it. A shell reached through the relay serves this page whole, exactly as the
device's own HTTP server does.

That is not where this ended up first. For a few days a device declared its UI with a
`ui modules` command and shipped an ES-module bundle per page, so that one relay shell
could host many heterogeneous products without knowing the name of a single device
command. The design was coherent and it worked end to end on the bench. It was removed
on 2026-09-15 anyway, because of what it cost to *be* two halves:

- about 2,000 lines — `modules/_ui`'s hand-rolled primitives, `ModuleHost`, the module
  registry, the shell contract, the import-map React facades, `check-modules.mjs` and
  two dev middlewares — none of which drew anything a user sees;
- a running repair bill: the shared Tailwind `utilities` layer (a module's `.hidden`
  beat the sidebar's `md:block` and the sidebar vanished), two React copies, four
  concurrent requests against a ten-socket lwIP budget, `export * from "react"`
  emitting nothing usable. Five reasoning notes in two days have the *seam* as their
  subject rather than a feature;
- and a template-shaped cost on top: a fork that wanted its own page had to learn the
  module build before it could draw anything.

So the whole mechanism is gone, on both sides — `UiManager`, `UiModule`, the four
`UiModule` declarations, `frontend/modules/`, `frontend/shell-contract/` and
`frontend/src/shell/`. Not gated, not left compiled in with nothing registered:
**deleted**, the same call as the MQTT/HA removal below, and for the same reason. Git
has it at `f7e0501` if a fork ever genuinely hosts many products in one shell.

What follows from one page, and is worth keeping in mind:

- **A page knows device commands by name, and that is fine now.** `SettingsPage` calls
  `settings list`, `FirmwarePage` calls `partition status`. The module design existed to
  forbid exactly this; with one shell per product there is no second implementation for
  it to drift from.
- **Adding a page:** a file in `frontend/src/pages/`, an entry in `navItems` in
  [AppSidebar.tsx](frontend/src/components/AppSidebar.tsx) (which also defines the
  `Page` type), and a `case` in `App.tsx`'s `PageContent`. Three edits, all in the
  frontend, none in firmware.
- **Routing lives in the HASH** ([use-route.ts](frontend/src/hooks/use-route.ts)) and
  assets are referenced relatively (`base: "./"`), so one build serves both the device
  root and the relay's `/devices/<id>/` subpath with no per-device build. A path-based
  router breaks that.
- **The relay serves this shape too**
  ([vanBassum/strux-relay](https://github.com/vanBassum/strux-relay)). A device that
  does not answer `ui modules` — which is now every Strux device — is one the relay
  serves whole, through its asset proxy. That fallback is the relay's own and predates
  this change.

### Deliberately out of scope

MQTT and Home Assistant integration were removed 2026-07-06 (last present at tag-time commit `4a41d74`): devices that exist to live in Home Assistant are better served by ESPHome; Strux is for product firmware with its own UI and relay-based remote access. Do not reintroduce an MQTT/HA layer in the template — a fork that truly needs it can resurrect the old managers from git history.

## Conventions

- C++17, no exceptions/RTTI-heavy patterns; `snprintf` with `sizeof` bounds, no `strcpy`/`strcat`.
- **String literals are ASCII. Comments are free.** GCC's execution charset follows the BUILD HOST's locale, not the source charset, so a UTF-8 em dash inside a literal left this machine as a single cp1252 byte — invalid UTF-8 in a JSON reply, and invisible in review, in the file and in the build. Comments never leave the compiler, so the repo's prose style is unaffected. See `docs/reasoning/2026-09-18-10h40-a-string-literal-is-not-utf-8-by-the-time-it-reaches-the-wire.md`.
- **A command says what it does, and so does each of its arguments.** `CommandEntry`'s fourth field is a one-line description; `Required`/`Optional` take an optional trailing description. Both are string literals read only by `help`, so an undescribed command costs nothing but leaves a caller — a person or a model at the other end of the relay — guessing. What this product IS, and how it is meant to be driven, lives in [main/app/DeviceDoc.h](main/app/DeviceDoc.h) and is registered into `SystemManager` from `AppContext::Init()`, like everything else the application tells the framework about itself.
- A command's reply is written through `ctx.reply`, never by naming a format: `ReplyWriter` ([main/lib/protocol/ReplyWriter.h](main/lib/protocol/ReplyWriter.h)) is the mirror of `ArgReader`, and `JsonReplyWriter` is the only implementation today. Every scope comes from a factory — the root from `ctx.reply.object()`/`.array()`, children from their parent — so a call site never spells a type (`auto` is enough) and the methods on offer are exactly the enclosing scope's. Scopes are RAII and close on every return path; writing to a closed one is `FATAL`. It is not a builder: bytes go to the transport on every field, so a scope must close before anything else touches `ctx.out` (see `getWebFile`'s header line, and `updateWrite`'s progress records).
- Elsewhere, JSON is generated with `lib/json/JsonWriter.h` and parsed with `JsonReader` (no external JSON lib). `JsonWriter` is now only the log broadcast, which is not a reply.
- Firmware version derives from the latest git tag (`v0.1.0` → `0.1.0`) in the root CMakeLists.
