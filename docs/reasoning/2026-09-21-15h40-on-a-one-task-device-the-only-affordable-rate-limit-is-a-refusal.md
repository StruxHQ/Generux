---
id: 2026-09-21-15h40
date: 2026-09-21
time: "15:40"
title: On a one-task device the only affordable rate limit is a refusal
---

**Before:** `auth login` had no attempt limit, and the obvious fix was the one every
server does — make a wrong password cost time. Sleep before answering, or back off
progressively, so guessing gets slower as it goes on.

**What changed it** was remembering what a Connection is here. One operation runs at a
time, deliberately (`docs/reasoning/2026-09-21-11h40-…`), and on the local transport
every command runs on the one web-server task. A handler that sleeps does not slow an
attacker down; it holds the device. Five concurrent wrong passwords with a one-second
delay each is a login form that can be turned into a denial of service by anyone who can
reach the socket — a worse bug than the one being fixed, and one the attacker gets for
free with no credential at all.

**The delta:** on a device whose execution model is one operation at a time, *cost to the
attacker* and *cost to the device* are the same number. A delay-based rate limit assumes
they can be separated, which is true of a thread-per-request server and false here. What
is left once you cannot spend time is a refusal: past five failures, attempts are
answered immediately with "no, and not for another minute". The answer is as cheap as any
other reply, and the attacker gets one guess per minute instead of one per round trip.

Two things fall out of that shape:

- **The counter is global, not per connection and not per IP.** At this layer a new
  connection is free — that is what made the delay attack work — so anything keyed to one
  counts nothing.
- **The lock-out applies to the right password too.** It has to: a check that ran when
  the password was correct would be an oracle that answers instantly for the one guess
  that matters. So a legitimate user who mistypes five times waits the minute out, which
  is why the refusal says `retryAfter` rather than "invalid password" — a correct password
  reported as wrong is an hour of someone's life.

The counter lives in RAM and a power cycle clears it. That is the trade rather than an
omission: persisting it would write NVS on every wrong guess, which hands the same
attacker a flash-wear attack, and clearing it needs physical access to a device whose
attacker would by then have better options than the login form.

The timing leak fixed alongside it is the same lesson from the other end. `strcmp`
stopped at the first wrong byte, so how long the check took said how much of the password
was right — the device spending less time was the device saying something. Both sides now
go into zero-padded buffers of the same fixed size and are compared all the way to the
end.

Verified on the bench, devkit at 192.168.50.202: five wrong passwords answered plainly,
the sixth refused with `retryAfter: 60`, the *correct* password refused too while the
lock-out stood, gated commands `RESET` with `unauthorized`, and the correct password
accepted a minute later. Every refusal came back in the same ~60 ms as an ordinary reply,
which is the property that mattered.

Backported from the Lablr fork (`vanBassum/Lablr@4aa6ddf`), which hit it first. Related:
[[2026-09-21-15h35-an-init-ordering-constraint-was-a-misplaced-owner-wearing-a-disguise]]
moved the `Authenticator` this lives in out of `WebServerManager`.
