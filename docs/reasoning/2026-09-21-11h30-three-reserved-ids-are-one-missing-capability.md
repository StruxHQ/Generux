---
id: 2026-09-21-11h30
date: 2026-09-21
time: "11:30"
title: Three reserved ids are one missing capability
---

**Before:** the protocol had three reserved session ids and they were understood as three
separate features, each with its own justification written next to it in
`SessionProtocol.h`. Session 0 is the log broadcast, and the comment explains that clients
allocate from 1 so 0 never collides. `0xFFFF` is telemetry, and the comment argues at
length for a second reserved id rather than more traffic on 0, because the two channels
have different destinations. `0xFFFE` is the hello, and the comment argues for a third
rather than a command, because a hello is not a request and nothing replies to it.

Every one of those arguments is locally correct. That is what kept them from being read
together.

**What made the common cause visible** was writing down, for the redesign, who is allowed
to start a conversation. A client picks an id and sends an envelope. A device picks
nothing: it has no allocator, no way to say "I am opening N", and a chunk arriving at the
relay with an id it has not seen is logged and dropped. The device cannot initiate.

So the three reserved ids are not three features. They are three instances of the same
workaround, and the reason each needed its own id is that a device with no allocator can
only be given constants. Each one also had to hand-roll its own framing, because `Session`
is the thing that writes a header and there was no session to write into: four call sites
(`WebSocketHandler::Broadcast`, `RelayManager::BroadcastLog`, `BroadcastTelemetry`,
`SendHello`) each doing `writeHeader` + `memcpy` + a raw send, with two of them carrying
their own copy of a 256-byte cap.

**The delta:** the special cases were never about logs, telemetry or identity. They were
about initiation. Give the device an id space of its own and all three collapse into
ordinary channels, the four framing sites collapse into one, and the reserved-id table
collapses into nothing — channel 0 stops being special because there is no longer anything
that needs to be addressed without being allocated.

This is why the redesign is a deletion rather than an addition. The symmetric handshake is
not a new mechanism bolted on; it is the thing whose absence produced the mechanisms
already there. It also predicts where the next special case would have appeared: any
fourth thing the device wanted to push would have needed a fourth constant, and
`0xFFFD` was already the obvious next one.
