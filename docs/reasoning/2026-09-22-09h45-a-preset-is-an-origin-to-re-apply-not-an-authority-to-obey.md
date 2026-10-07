---
id: 2026-09-22-09h45
date: 2026-09-22
time: "09:45"
title: A preset is an origin to re-apply, not an authority to obey
builds-on:
supersedes:
---

**Before:** issue #37 came from a fork. DPS50xx ran `shadcn apply --preset b0` against its
shell and found twelve differing theme tokens, every one of them drift from a shared origin
nobody had re-applied rather than a decision anyone had made. Its note concluded that the
tokens are not per-shell taste and that *being on the preset is what matching means* — and
drew a corollary from it: a deviation is a liability, because the next `apply` silently
undoes it. On that reasoning DPS kept 213 KB of Inter subsets it could never serve, and
recorded pruning them as an option not taken.

**What changed it:** applying the same preset here. It brought three things that do no work
in this repo:

- **Seven unicode-range-gated font subsets, 218 KB, of which a browser rendering this UI's
  English strings requests only latin (48 KB).** DPS spent that in a 917 KB `www` partition.
  Strux has no `www` partition — the frontend is packed into the app image — so the same
  bytes come out of the OTA slot, which is the space the *product* grows into.
- **A `useTheme()` call with nothing to read.** The preset's `sonner.tsx` imports
  `next-themes`, and this shell had no theme provider, so the hook returned undefined and the
  default applied. It worked, and earned nothing.
- **`clsx` and `tailwind-merge` still in `package.json`** after the preset replaced
  `lib/utils.ts` with the `cn` package. Nothing imported them; nothing said so.

Fidelity to the preset means carrying all three, and the argument for carrying them is only
that a future `apply` would put them back.

**Now:** the preset is an **origin you re-apply and then review**, not an authority that
settles what the file should contain. What the apply is *for* is what #37 wanted: upstream
component fixes and one shared token set, so two shells stop disagreeing by accident. What
follows an apply is a pass asking of each thing it brought, *does this do work here* — and a
template answers that question differently from the fork that reported it, because a byte in
the template is a byte in every fork.

So the test for a deviation is not "will the next apply undo it". It is "does the device pay
for this and get nothing back". A deviation that survives that test is written **in the file
it deviates from**, saying why, so the next person applying the preset re-decides it instead
of re-discovering it: that is what the comment above the latin-only `@font-face` in
`index.css` is for, and it is cheaper than the 170 KB it defends.

And the third item turned out not to be a deviation at all. `next-themes` was not dead code —
it was **half a feature whose other half had never been built**. The shell had no theme
provider, so the hook the preset wrote had nothing to read; supplying one made light/dark/
system a real control in the sidebar and made the `.dark` tokens, which had sat in `index.css`
unreachable all along, do something. Removing the import would have locked the UI to light
forever and looked like a cleanup. "This dependency earns nothing" and "nobody has finished
wiring it up" read identically from the import list.
