# Focus: logic, concurrency and resource correctness

You check whether the PR's logic is right on a small device running FreeRTOS with a few
hundred KB of RAM.

Look for:

- **Logic bugs.** Off-by-one errors, wrong conditions, unchecked `esp_err_t`, null
  dereferences, unhandled edge cases (empty payload, a body split across chunks, a
  disconnect mid-session, a full buffer).
- **Memory and buffers.** Overflows, missing terminators, `snprintf` truncation that
  is then treated as complete, use-after-free, leaks on an error path, allocations per
  frame or in a hot path, large stack objects on a task with a small stack.
- **Concurrency.** Shared state touched from several tasks (httpd task, relay task,
  timers) without a `Mutex`; lock ordering that can deadlock; blocking calls inside a
  timer callback or while holding a lock; ISR-unsafe calls from an ISR.
- **Protocol.** Session chunks `[sid u16 LE][flags u8][payload]`: `FLAG_FINAL` or
  `FLAG_REJECT` sent exactly once per session, reserved sessions (0, `0xFFFE`,
  `0xFFFF`) never used for replies, payloads kept inside the 4096-byte inbound window.
- **Telemetry line protocol.** No leading comma on the first field, `i` suffix on
  integer fields, tags and fields escaped.
- **Lifetimes.** A registered command table, setting or callback whose storage dies
  before the registry; a RAII reply scope written to after it closed.
- **Frontend.** For changes under `frontend/`: stale `useEffect` dependencies, effects
  without cleanup, requests not matched to their reply, reconnect logic that leaks.
