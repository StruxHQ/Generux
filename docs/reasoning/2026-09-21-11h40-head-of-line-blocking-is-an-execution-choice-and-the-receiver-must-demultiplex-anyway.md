---
id: 2026-09-21-11h40
date: 2026-09-21
time: "11:40"
title: Head-of-line blocking is an execution choice, and the receiver must demultiplex anyway
---

**Before:** the multiplexing question looked like one decision with one cost. If several
channels can be open at once then several things can be in flight at once, so the device
needs somewhere to put a frame that is not for the handler currently running — a demux
task, per-channel queues, a rendezvous. On a board with around a hundred kilobytes of heap
that is expensive, and it would cost the zero-copy upload path as well: `Stream::canLend`
and `lendInput` hand a handler a pointer straight into the transport's own frame buffer,
which is how `partition write` streams a 1.6 MB image to flash holding no buffer of its
own. A queue in the middle ends that.

So the decision was framed as: pay for concurrency, or do not multiplex.

**What broke the framing** was deciding explicitly not to run handlers concurrently — one
execution context per connection, one active operation, head-of-line blocking accepted —
and then asking what that actually removes. It removes the queues, the task and the
scheduler. It does not remove the demultiplexing, because frames still *arrive* whether or
not anything is ready to process them. Arrival is the peer's decision; only processing is
ours.

Reading `Session::ensureInput` made the size of the remaining problem clear, and it was
much smaller than expected. The check is already there:

```cpp
int n = link_.RecvChunk(inBuf_, inCap_, &sid, &flags);
if (n < 0 || sid != id_) { ...; failed_ = true; return false; }
```

A foreign frame is never mistaken for body bytes. What it does instead is fail the
in-progress request *and* discard the foreign frame silently, so the other channel's
initiator waits out a timeout for a reply that was thrown away. Two channels broken by one
frame, one of them invisibly.

**The delta:** multiplexed *state* and multiplexed *execution* are separable, and only the
second is expensive. Accepting head-of-line blocking is a statement about which handler
runs; it says nothing about what the wire may deliver. The receiver must still look at the
channel id of every frame it reads and act on it — and because the alternative is silent
request failure today, or misinterpreted body bytes in a design that skipped the check,
that lookup is not optional at any concurrency level.

Which turns the expensive half of the change into roughly twenty lines at one call site:
where `ensureInput` finds a foreign id, hand the frame to the connection's dispatch and
carry on reading, instead of destroying both. No task, no queue, no rendezvous, and
`lendInput` survives untouched.

It is also the forward-compatible half. A future peer that does run handlers concurrently
will interleave frames; a receiver that demultiplexes handles that, and one that fails the
request does not. So the twenty lines are simultaneously the correctness fix, the
cancellation mechanism — RESET arriving mid-upload is by definition a foreign-looking frame
during an active read — and the reason the wire format does not have to change again
later.

Related: the same absence explains `RelayManager::skipping_`/`skipSid_`, which exists only
because there is no channel table to drop a stale frame by id, and explains why the local
WebSocket path, which never grew that workaround, parses a late body chunk as a command
envelope.
