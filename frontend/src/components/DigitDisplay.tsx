import { useEffect, useRef, useState } from "react"
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"

import { cn } from "cn"

export type Unit = "Hz" | "kHz" | "MHz"
export const UNITS: Unit[] = ["Hz", "kHz", "MHz"]
const DECIMALS: Record<Unit, number> = { Hz: 0, kHz: 3, MHz: 6 }

// One wheel notch, in pixels. Chrome and Edge report 100 per notch of a mouse wheel;
// a trackpad sends many small deltas, which add up to notches the same way.
const PX_PER_NOTCH = 100
// deltaMode 1 (Firefox, mouse wheel) counts lines, three to a notch.
const PX_PER_LINE = PX_PER_NOTCH / 3

// Holding an arrow: one step at once, then repeating, faster the longer it is held.
const REPEAT_DELAY_MS = 400
const REPEAT_START_MS = 150
const REPEAT_MIN_MS = 30

/**
 * The frequency as a bench generator shows it: a box per digit, one of them
 * selected. Click a digit to select it; scroll (over any digit, which selects it)
 * or ↑ / ↓ to step it; hold the arrows for faster changes; ← / → move the
 * selection; typing a digit sets it.
 *
 * Every unit shows the same digits — whole hertz, as many as `max` has — and only
 * the decimal point moves, so the layout never jumps and a leading zero is there
 * to be scrolled up. Zeros ahead of the first significant digit are dimmed.
 *
 * Reports changes as a delta in hertz; clamping and carrying are the caller's.
 */
export function DigitDisplay({
  hz,
  max,
  unit,
  onUnit,
  onNudge,
  disabled,
  dim,
}: {
  hz: number
  max: number
  unit: Unit
  onUnit: (u: Unit) => void
  onNudge: (deltaHz: number) => void
  disabled?: boolean
  dim?: boolean
}) {
  const total = String(Math.round(max)).length
  const digits = String(Math.max(0, Math.round(hz))).padStart(total, "0").slice(-total)
  const point = total - DECIMALS[unit] // index the decimal point goes before
  const places = Array.from({ length: total }, (_, i) => 10 ** (total - 1 - i))

  // The selected digit, by the value it stands for. Starts on the unit's ones.
  const [place, setPlace] = useState(() => 10 ** DECIMALS[unit])
  const firstSignificant = Math.min(digits.search(/[1-9]/) === -1 ? total : digits.search(/[1-9]/), point - 1)

  // Latest props for handlers that outlive a render (wheel listener, repeat timer).
  const live = useRef({ onNudge, place, disabled })
  live.current = { onNudge, place, disabled }

  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = box.current
    if (!node) return
    let carry = 0
    const onWheel = (e: WheelEvent) => {
      if (live.current.disabled) return
      // React's wheel handlers are passive and cannot stop the page scrolling.
      e.preventDefault()
      const px = e.deltaMode === 1 ? e.deltaY * PX_PER_LINE
        : e.deltaMode === 2 ? e.deltaY * PX_PER_NOTCH
        : e.deltaY
      carry -= px // wheel up is a negative delta and raises the value
      const notches = Math.trunc(carry / PX_PER_NOTCH)
      if (notches === 0) return
      carry -= notches * PX_PER_NOTCH
      const over = (e.target as Element | null)?.closest<HTMLElement>("[data-place]")
      const target = over ? Number(over.dataset.place) : live.current.place
      if (over) setPlace(target)
      live.current.onNudge(target * notches)
    }
    node.addEventListener("wheel", onWheel, { passive: false })
    return () => node.removeEventListener("wheel", onWheel)
  }, [])

  // ── Hold-to-repeat on the arrows.
  const repeat = useRef<number | null>(null)
  function startRepeat(sign: number) {
    stopRepeat()
    live.current.onNudge(sign * live.current.place)
    let interval = REPEAT_START_MS
    const tick = () => {
      live.current.onNudge(sign * live.current.place)
      interval = Math.max(REPEAT_MIN_MS, interval * 0.85)
      repeat.current = window.setTimeout(tick, interval)
    }
    repeat.current = window.setTimeout(tick, REPEAT_DELAY_MS)
  }
  function stopRepeat() {
    if (repeat.current !== null) clearTimeout(repeat.current)
    repeat.current = null
  }
  useEffect(() => stopRepeat, [])

  function move(dir: -1 | 1) {
    // Left is the more significant digit.
    const next = dir < 0 ? place * 10 : place / 10
    if (next >= 1 && next <= places[0]) setPlace(next)
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
      <div
        ref={box}
        tabIndex={disabled ? -1 : 0}
        role="group"
        aria-label="Frequency digits"
        className={cn(
          "bg-background/60 flex min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border px-2 py-6 outline-none sm:gap-1.5 sm:px-3",
          "focus-visible:ring-ring/50 focus-visible:ring-3",
          disabled && "opacity-50",
        )}
        onKeyDown={(e) => {
          if (disabled) return
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault()
            onNudge((e.key === "ArrowUp" ? 1 : -1) * place)
          } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault()
            move(e.key === "ArrowLeft" ? -1 : 1)
          } else if (/^[0-9]$/.test(e.key)) {
            e.preventDefault()
            const i = places.indexOf(place)
            onNudge((Number(e.key) - Number(digits[i])) * place)
            move(1)
          }
        }}
      >
        {[...digits].map((ch, i) => {
          const p = places[i]
          const selected = p === place && !disabled
          return (
            <div key={i} className="flex items-center gap-1 sm:gap-1.5">
              {i === point && i > 0 && (
                <span className="text-foreground self-end pb-1 text-2xl font-bold sm:text-4xl">.</span>
              )}
              <div className="relative">
                {selected && (
                  <button type="button" aria-label="Increase this digit" tabIndex={-1}
                    className="text-signal absolute -top-6 left-1/2 -translate-x-1/2 p-0.5"
                    onPointerDown={(e) => { e.preventDefault(); startRepeat(1) }}
                    onPointerUp={stopRepeat} onPointerLeave={stopRepeat} onPointerCancel={stopRepeat}>
                    <ChevronUpIcon className="size-5" strokeWidth={3} />
                  </button>
                )}
                <button
                  type="button"
                  tabIndex={-1}
                  data-place={p}
                  disabled={disabled}
                  onClick={() => { setPlace(p); box.current?.focus() }}
                  className={cn(
                    "flex h-14 w-8 items-center justify-center rounded-lg border text-3xl font-bold tabular-nums transition-colors sm:h-20 sm:w-12 sm:text-5xl",
                    selected
                      ? "border-signal text-signal bg-signal/10 shadow-[0_0_14px_-2px_var(--signal)]"
                      : "bg-muted/60 hover:bg-muted border-transparent",
                    !selected && (i < firstSignificant || dim) && "text-muted-foreground/40",
                  )}
                >
                  {ch}
                </button>
                {selected && (
                  <button type="button" aria-label="Decrease this digit" tabIndex={-1}
                    className="text-signal absolute -bottom-6 left-1/2 -translate-x-1/2 p-0.5"
                    onPointerDown={(e) => { e.preventDefault(); startRepeat(-1) }}
                    onPointerUp={stopRepeat} onPointerLeave={stopRepeat} onPointerCancel={stopRepeat}>
                    <ChevronDownIcon className="size-5" strokeWidth={3} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="relative sm:self-center">
        <select
          aria-label="Display unit"
          value={unit}
          disabled={disabled}
          onChange={(e) => {
            const u = e.target.value as Unit
            onUnit(u)
            setPlace(10 ** DECIMALS[u])
          }}
          className="bg-background/60 hover:bg-muted h-11 w-full appearance-none rounded-xl border pr-9 pl-3 text-lg font-bold sm:w-auto outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-20 sm:pl-4 sm:text-2xl"
        >
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <ChevronDownIcon className="text-signal pointer-events-none absolute top-1/2 right-2.5 size-5 -translate-y-1/2" />
      </div>
    </div>
  )
}
