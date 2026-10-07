---
id: 2026-09-22-09h50
date: 2026-09-22
time: "09:50"
title: "Smaller" is not the same question as "worth decompressing"
builds-on: 2026-09-17-10h05
supersedes:
---

**Before:** `pack_web_assets.py` decided per file whether to gzip by measuring: compress it,
keep the result if it came out smaller, otherwise store it raw. The docstring named the case
it was written for — "fonts, PNGs and other already-packed assets grow under gzip" — and the
measurement looked like the honest, format-agnostic way to say it. No list of extensions to
keep current, and a new asset type could never be mis-handled.

**What changed it:** the first woff2 in `www`. Inter's latin subset gzips to **7 bytes
smaller** than it started, so the rule fired and the file was stored compressed. The device
then serves 48 KB with `Content-Encoding: gzip` and every browser pays a full decompress pass
to recover bytes it could have had directly — to save seven.

The measurement answers "is the compressed copy smaller", and that was never the question.
The question is "is the saving worth what the other end pays to undo it", and for a format
that already carries its own compression the answer is no at *any* margin, because the win is
noise and the cost is real. A 0.01% win and a 30% win are the same test to a size comparison
and opposite answers to a reader.

**Now:** formats that compress themselves are skipped by extension, and the size comparison
stays for everything else — the list decides *whether the question applies*, the measurement
answers it where it does. The list has the cost the measurement was chosen to avoid — a
pre-compressed format nobody listed falls back to the comparison and can still be stored
gzipped for a trivial win — but that is now the only way to make this mistake, and it is one
line to close each time it happens.

DPS50xx hit the same asset from the other side: its `gzip.mjs` compressed everything it
found, so the same woff2 came out 28 bytes *larger* and was served that way. Having a size
test is what kept this repo off that error and is exactly what hid this one — it turned a
loss into a 7-byte win and reported success. Both implementations were guessing at a property
the file format already states.
