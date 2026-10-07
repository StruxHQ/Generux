---
id: 2026-10-07-10h00
date: 2026-10-07
time: "10:00"
title: A result that says the reply stopped short is not a bad request
builds-on: 2026-09-21-11h40
supersedes:
---

**Before:** `CommandResult` was read as "ways a request can be unusable", and anything that
made it past argument decoding returned `Ok`. `partition read` therefore returned `Ok` after
its header when the body stopped short (client gone, flash read error), so
`RunCommandChannel` sent FINAL and the reply looked complete. Only the frontend's `size`
comparison could tell.

**What changed it:** the channel already ends a non-Ok result with RESET carrying a reason,
which is exactly what a cut-short reply needs. The enum was never about the request alone; it
is the framework's closed set of ways a command ends other than completely.

**Now:** `CommandResult::ReplyIncomplete` means the request was fine and the reply could not
be finished. RESET after a header means the body is partial; FINAL means it is whole. A client
no longer has to compare sizes to know, though the frontend's check stays as a second one.
`web read` may have the same shape and is not yet examined.
