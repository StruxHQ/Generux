---
id: 2026-09-21-11h50
date: 2026-09-21
time: "11:50"
title: A protocol break is not a flag day when the first frame dates the peer
---

**Before:** the cost of changing the wire looked like the thing that would decide whether
the redesign was worth doing. One relay serves devices built from several forks — Lablr,
Comble's host and slave, KC1245 — all flashed independently, some on hardware nobody is
standing next to. Breaking the wire means every one of them stops working on the day the
relay is redeployed, and the usual answers are both bad: a version field negotiated per
connection, which means the firmware carries old protocol implementations forever, or a
flag day across four repositories and an unknown number of boards.

Deciding that firmware supports exactly one protocol version made this worse, not better.
It is the right call for the device — nobody wants a v1 and a v2 code path competing for
flash — but it removes the obvious escape.

**What dissolved it** was noticing that the two protocols already introduce themselves
differently, and always have. The old one's first act after connect is `SendHello`, a chunk
on reserved session `0xFFFE`. The new one's first act is the CONTROL handshake. Neither
peer has to be asked which it speaks, and no timeout is needed to find out, because both
are obliged to speak first and they say different things.

So the relay branches on the first frame it reads. Old devices keep the existing
`DeviceConnection` path verbatim; new ones get the new one.

**The delta:** version compatibility does not have to be negotiated if the protocols are
self-identifying, and a protocol that mandates an opening frame is self-identifying for
free. The strictness we wanted in the firmware — one version, no accumulation — turns out
to cost nothing at the hub, because the hub is the only participant that has to be
tolerant and it is also the only one that is easy to deploy.

That moves the migration from a coordinated event to a schedule each fork sets for itself,
which is the difference between a change that can be started this week and one that has to
be planned.

There is a second, unearned consequence. The relay serves each device's *own* frontend by
pulling it over `web read`, so a device's browser bundle is part of its firmware image. An
old device serves a bundle that speaks the old protocol; a new device serves one that
speaks the new one; `BrowserPipe` takes its mode from the device it is attached to. The
browser half of the migration needs no coordination at all — not because anyone designed
for that, but because putting the UI in the app image already tied the two together.
Decisions made for one reason keep paying out somewhere else.
