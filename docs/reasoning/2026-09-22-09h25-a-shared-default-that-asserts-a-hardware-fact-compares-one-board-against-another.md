---
id: 2026-09-22-09h25
date: 2026-09-22
time: "09:25"
title: A shared default that asserts a hardware fact makes the guard compare a board against another board's hardware
builds-on: 2026-08-07-10h58
supersedes:
---

**Before:** the root `sdkconfig.defaults` held "common" configuration and a board overlay was
the *optional* place to differ from it — the framing in note 2026-08-07-10h58, which settled
what a board folder cannot own (the chip) without asking what it must. So flash size, flash
speed and a `partitions.csv` sized to fill 4 MB exactly lived in the shared file, true of both
boards that existed. The drift guard checked every composed defaults file's lines
independently, which was fine while no two files named the same key.

**What changed it:** preparing a 16 MB board. The board sets
`CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y`; the generated config then reads
`# CONFIG_ESPTOOLPY_FLASHSIZE_4MB is not set`; the guard reads the root file's
`CONFIG_ESPTOOLPY_FLASHSIZE_4MB=y` and stops a tree that is configured exactly as asked. The
board is correct, the generated config is correct, and the build is rejected.

The reason is that flash size is a Kconfig **choice**. Picking another arm sets a *different
symbol*, so the board does not shadow the root's line, it **falsifies** it — and no
last-writer-wins rule can connect two different symbols. The obvious repair is a per-key
escape hatch: let a file retract the arm it is leaving, which is what the shipped fix in a
downstream fork does (`# STRUX_DRIFT_EXEMPT: CONFIG_ESPTOOLPY_FLASHSIZE_4MB`). It works.

It is also treating the symptom. The guard was not malfunctioning; it was faithfully reporting
that the root file makes a claim about hardware, and therefore that **checking board A's tree
means checking board B's flash size**. An exemption silences that report without removing the
condition that produced it.

**Now:** the root file holds what the *application* needs of whatever platform it runs on, and
nothing that is a property of a particular board. The test is whether a line would still be
true on a board nobody has built yet. Flash size, mode and speed, and the partition table —
including `CONFIG_PARTITION_TABLE_CUSTOM` itself, since "which table" is part of the layout —
belong to the board, beside its `BoardConfig.h`. This completes 2026-08-07-10h58 from the
other side: that note said the chip is out of a board folder's reach, this one says everything
resolved in the normal configure pass that describes the hardware is squarely inside it.

Two consequences are inseparable from the shift and are the things most likely to be
"cleaned up" by someone who has not read this:

- **The two identical `partitions.csv` files are deliberate.** `esp32_devkit` and
  `esp32c3_supermini` carry byte-identical layouts because both happen to have 4 MB of flash —
  a coincidence of the hardware, not a shared fact. Consolidating them into one root file
  reintroduces exactly the condition above: the moment a third board has other flash, the
  shared file is asserting one board's hardware while another board is being built.
- **There is deliberately no per-key drift exemption.** With the choice arms in the boards, no
  composed file for a 16 MB board mentions 4 MB, so there is nothing to retract and the hatch
  has no user. Verified rather than assumed: every key left in the root file is a bool or an
  int, none is a Kconfig choice arm, so a board can only *override* a root default and never
  falsify one. A future guard failure of the falsification shape is therefore not a missing
  exemption — it is the guard saying an option is in the wrong file, and it is correct.

Rests on: the root file continuing to assert no choice arms. That invariant is what makes the
absence of an exemption safe, and it is not enforced mechanically — a new choice-shaped line in
the root file would bring the whole problem back.

**Follows:** flash size/speed/mode and the partition table moved into each board's
`sdkconfig.defaults`, with its own `partitions.csv` beside it; the board overlay became
**required**, because a board silently inheriting ESP-IDF's flash-size default (2 MB on an
ESP32) would build a wrongly sized image rather than fail; the drift guard now reduces the
composed files to one line per key, last writer wins, so an overlay can override an
application default and not merely add to it — which it could not do before, and which is a
separate fault the same audit surfaced.
