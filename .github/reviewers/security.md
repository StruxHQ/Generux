# Focus: security and exposure

You check whether the PR lets someone reach, read or change something they shouldn't.

Background: a device serves its UI and a WebSocket on the LAN, and can dial out to a
relay so it is reachable remotely. Auth is three commands (`auth hello|login|resume`)
enforced by `AuthGate`, and is off while `web.password` is empty. Firmware updates
arrive as commands (`updateBegin`/`updateWrite`/`updateEnd`, pull OTA from a URL).

Look for:

- **Auth bypass.** A new command or transport path reachable without passing
  `AuthGate` when a password is set.
- **Untrusted input.** Lengths, offsets and indices from the wire used without bounds
  checks; partition labels, file paths (`web read`) or setting keys taken from a
  request without validation (path traversal, writing the running partition, writing
  arbitrary NVS).
- **Secrets.** Passwords, relay tokens or Wi-Fi credentials written to the log
  broadcast, a reply, telemetry or the relay hello; secrets committed in code or
  `sdkconfig.defaults`.
- **Relay identity.** The connect URL carries identity only, plus the token header. A
  change that sends the token elsewhere, or acts on something the relay says without
  it being authenticated.
- **OTA.** Images accepted without `esp_ota_*` validation, or rollback / validity
  marking weakened.
- **The review gate.** `.github/workflows/claude-review.yml` runs as the PR has it, so
  it gates itself; that is accepted, because a PR that touches `.github/workflows/` or
  `.github/reviewers/` is never merged automatically and Bas merges it by hand. Don't
  report the self-gating as such. Do report a change that weakens the gate or that
  trust boundary: a reviewer dropped from the matrix or from `REVIEWERS`, a verdict or
  path check loosened, or a rule that makes a blocking finding less likely.
