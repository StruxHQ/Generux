import { useCallback, useEffect, useRef, useState } from "react"
import { backend, type WaveState } from "@/lib/backend"

// The output only changes when somebody sets it, but that somebody may be another
// browser or the relay, so the page still re-reads now and then.
const POLL_MS = 5000

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/// Poll `wave get`, and offer `set`.
export function useWave() {
  const [state, setState] = useState<WaveState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A reply can land after unmount — the transport has no cancellation.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const refresh = useCallback(() => {
    backend
      .getWave()
      .then((s) => {
        if (!alive.current) return
        setState(s)
        setError(null)
      })
      .catch((e) => {
        if (alive.current) setError(errorMessage(e))
      })
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  /// Not optimistic: the device's reply carries the frequency it actually reached,
  /// which is the number worth showing. Resolves to an error message, or null.
  const set = useCallback(
    async (params: { enabled?: boolean; freq?: number }): Promise<string | null> => {
      setBusy(true)
      try {
        const s = await backend.setWave(params)
        if (alive.current) setState(s)
        return s.ok ? null : (s.error ?? "Rejected by the device")
      } catch (e) {
        return errorMessage(e)
      } finally {
        if (alive.current) setBusy(false)
      }
    },
    [],
  )

  // Live sweep steps. At most one in flight and only the newest waiting, so a
  // sweep never queues up behind a slow link: the device always gets the latest
  // value next, and every step in between that it missed is one nobody needed.
  const pending = useRef<number | null>(null)
  const inFlight = useRef(false)
  const pump = useCallback(() => {
    if (inFlight.current || pending.current === null) return
    const freq = pending.current
    pending.current = null
    inFlight.current = true
    backend
      .setWave({ freq, persist: false })
      .then((s) => {
        if (alive.current) setState(s)
      })
      .catch(() => {
        // A dropped step is overtaken by the next one, or by sweepEnd.
      })
      .finally(() => {
        inFlight.current = false
        pump()
      })
  }, [])

  /// Send a sweep step: applied on the device, not written to flash.
  const sweepTo = useCallback(
    (freq: number) => {
      pending.current = freq
      pump()
    },
    [pump],
  )

  /// End a sweep: drop any step still waiting and persist where it landed. The
  /// transport runs requests in order, so this lands after any step in flight.
  const sweepEnd = useCallback(
    (freq: number) => {
      pending.current = null
      return set({ freq })
    },
    [set],
  )

  return { state, busy, error, set, sweepTo, sweepEnd, refresh }
}

/// "100 kHz", "1.5 kHz", "440 Hz".
export function formatHz(hz: number): string {
  const { value, unit } = hzParts(hz)
  return `${value} ${unit}`
}

/// The number and the unit apart, for a readout that sets them in different sizes.
export function hzParts(hz: number): { value: string; unit: "Hz" | "kHz" } {
  if (hz >= 1000) return { value: String(+(hz / 1000).toFixed(3)), unit: "kHz" }
  return { value: String(hz), unit: "Hz" }
}

/// Parse what somebody typed: "1500", "1.5k", "1.5 kHz", "20hz". A bare number is
/// in `bareUnitHz` (1 for Hz, 1000 for kHz). NaN when it is not a frequency.
export function parseHz(text: string, bareUnitHz = 1): number {
  const m = text.trim().toLowerCase().match(/^(\d+(?:[.,]\d*)?|[.,]\d+)\s*(k|khz|hz)?$/)
  if (!m) return NaN
  const n = Number(m[1].replace(",", "."))
  const scale = m[2] === "k" || m[2] === "khz" ? 1000 : m[2] === "hz" ? 1 : bareUnitHz
  return Math.round(n * scale)
}

/// One period, in the unit that keeps it readable.
export function formatPeriod(hz: number): string {
  if (hz <= 0) return "—"
  const us = 1e6 / hz
  if (us >= 1000) return `${+(us / 1000).toFixed(3)} ms`
  return `${+us.toFixed(3)} µs`
}
