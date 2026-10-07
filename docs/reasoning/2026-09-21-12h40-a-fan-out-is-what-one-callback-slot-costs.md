---
id: 2026-09-21-12h40
date: 2026-09-21
time: "12:40"
title: A fan-out is what one callback slot costs
---

**Before:** the log path had a shape everyone had accepted. `ConsoleManager` captured
every line, held **one** `BroadcastFunc`, and called it from its own task.
`WebServerManager` registered that callback, and its `Broadcast()` did the fan-out by
hand — first to its own WebSocket clients, then by reaching into
`RelayManager::BroadcastLog`. That reach was the last sideways edge between two peer
managers, and issue #15 had it listed as something the broadcast redesign would fix.

The obvious fix, and the one I proposed while reviewing the redesign, was to turn the
single callback into a subscriber list. Each transport registers, `ConsoleManager` walks
them, the sideways edge disappears. More code, but the right shape.

**What changed it** was asking who the callback was actually for. A callback exists so a
producer can push to a consumer it does not know. But the producer here already holds
every line it has ever produced, in a ring, with a fixed size and a known order. A
consumer does not need to be told; it needs to know **where it got to**.

So the ring got a monotonic sequence number and each Connection got a cursor into it.
`ReadJson(cursor, ...)` hands back the next line that consumer has not seen and advances
it. That is the whole mechanism. There is no registration, no list, no callback, and
nothing for a fan-out to be made of — two transports reading the same ring at their own
pace is not a fan-out, it is two readers.

**The delta:** the fan-out was never a feature of log delivery. It was the shape forced
by a producer that could only push, to exactly one place. Widening that slot to a list
would have kept the inversion and paid for it; removing the push removed the question.

Three things fell out that were not the point:

- **Lossiness is free and correct.** A cursor that falls behind the ring jumps to the
  oldest line still held. A slow consumer loses the middle and keeps its place, with no
  drop policy written anywhere.
- **`since=<seq>` is not a feature to add later.** It is the cursor's initial value.
- **#24 dies as a side effect.** `ConsoleBroadcast` and whichever task took a telemetry
  measurement both used to call into `RelayManager` and block on
  `RelaySocket::sendMutex_` — and every `LOCK()` is under `ContextLock`, whose failsafe
  reboots the device after three five-second timeouts. With producers writing to memory
  and the relay draining from its own read loop, that mutex has one caller. The reboot
  was not fixed; the contention stopped existing.

What it costs is a drain site per Connection rather than one broadcaster, and those are
not symmetric: the relay drains inside the read loop it already sits in, while the local
WebSocket has no task of its own — `esp_http_server` calls into it only when a frame
arrives — so that side needs a pump task to do the walking. The asymmetry is real and
worth stating, because "only the Connection writes to its socket" reads as though both
transports have one.

Related: [[2026-09-21-11h40-head-of-line-blocking-is-an-execution-choice-and-the-receiver-must-demultiplex-anyway]]
is the same instinct in the other direction — there, state without execution; here,
memory without notification.
