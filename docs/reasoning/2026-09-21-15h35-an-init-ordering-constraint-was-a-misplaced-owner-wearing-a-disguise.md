---
id: 2026-09-21-15h35
date: 2026-09-21
time: "15:35"
title: An Init ordering constraint was a misplaced owner wearing a disguise
---

**Before:** two facts sat in the codebase and were read as two facts.

One was in `RelayManager.cpp`: it included `WebServerManager.h` so it could borrow
`GetAuthenticator()`. Issue #17 recorded it as the last sideways edge between two
transports, and correctly named the reason it existed — the `Authenticator` lives under
`WebServerManager/` because that is where HTTP/WS login was extracted from, not because
the web server owns the device's credentials.

The other was in `StruxContext::Init()`, a comment above `relayManager_.Init()` saying
"After WebServer: shares its Authenticator". It read as an ordering fact about
initialization, and it was treated as one: the class comment listed it as an example of
the real constraints the order carries.

**What changed it** was moving the `Authenticator` into an `AuthManager` of its own and
finding that the ordering line had nothing left to say. It was never about *when*
anything initialized. Nothing in the relay's `Init()` needs the web server to have run
first; it takes a reference to a member of an object that has existed since
`StruxContext` was constructed. The line was recording *whose* the credential authority
was, in the only place the misplacement showed up.

**The delta:** an ordering constraint that names another manager's *member* is not an
ordering constraint. It is an ownership error reported in the wrong vocabulary. The real
constraints in that Init list are of a different kind — a manager registering a setting
needs `SettingsManager` up, telemetry leaves down a pipe the relay has to have opened —
and each of those names a thing that must have *happened*, not a thing that must be
*owned*.

So the fix for #17 deleted two things with one move. Both transports now ask the
provider for the authority, which is the ordinary way a manager finds a peer, and
`AuthManager` has one requirement of its own: come up after `SettingsManager`, like
everybody else.

What stayed put is worth naming, because it is the same question asked about a different
object. `AuthGate` and `WsConnection` are still under `WebServerManager/` and the relay
still includes them. That is not the same error: those are *connection* state, and the
relay genuinely has a WebSocket-shaped connection. The credential authority is one per
device; a gate is one per link. Only the first was in the wrong house.

One thing did not move with it. The setting key is still `web.password`, although
`AuthManager` now declares it, because the key is the NVS address of a password somebody
already set — renaming it would silently unlock every device that has one, at the next
firmware update. The name is wrong and harmless; the rename is neither.

Related: [[2026-09-21-12h40-a-fan-out-is-what-one-callback-slot-costs]] removed the
*other* sideways edge between these two managers, and #15 and #17 turn out to have been
the same observation about two different borrowings.
