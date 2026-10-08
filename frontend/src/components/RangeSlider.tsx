import { useRef, useState } from "react"

import { cn } from "cn"

export interface Tick {
  /** 0 … 1 along the track. */
  at: number
  /** Printed under a major tick. */
  label?: string
  major?: boolean
  /** Hide the label on narrow screens, where every one would not fit. */
  wideOnly?: boolean
}

/**
 * A thick-track slider over a POSITION, 0 … 1 — what the position means (a
 * frequency on a log scale, a duty in percent) is the caller's mapping. Reports
 * every move while dragged and the final position on release, so a caller can
 * stream the one and commit the other.
 *
 * Keyboard: ← / → step by `step`, with Shift ten times as far; each press is a
 * move and a release.
 */
export function RangeSlider({
  position,
  onMove,
  onRelease,
  ticks = [],
  tone = "signal",
  step = 0.005,
  disabled,
  label,
  valueText,
}: {
  position: number
  onMove: (position: number) => void
  onRelease: (position: number) => void
  ticks?: Tick[]
  tone?: "signal" | "duty"
  step?: number
  disabled?: boolean
  label: string
  valueText?: string
}) {
  const track = useRef<HTMLDivElement>(null)
  const [held, setHeld] = useState(false)
  const last = useRef(position)
  const p = Math.max(0, Math.min(1, position))

  function at(clientX: number): number {
    const r = track.current?.getBoundingClientRect()
    if (!r || r.width === 0) return p
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
  }

  const fill = tone === "signal" ? "bg-signal" : "bg-sky-500"
  const glow = tone === "signal" ? "shadow-[0_0_12px_var(--signal)]" : "shadow-[0_0_12px_var(--color-sky-500)]"

  return (
    <div className={cn("select-none", disabled && "opacity-50")}>
      <div
        ref={track}
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(p * 100)}
        aria-valuetext={valueText}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        className={cn(
          "relative flex h-8 touch-none items-center rounded-full outline-none",
          "focus-visible:ring-ring/50 focus-visible:ring-3",
          !disabled && (held ? "cursor-grabbing" : "cursor-pointer"),
        )}
        onPointerDown={(e) => {
          if (disabled) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setHeld(true)
          last.current = at(e.clientX)
          onMove(last.current)
        }}
        onPointerMove={(e) => {
          if (!held) return
          last.current = at(e.clientX)
          onMove(last.current)
        }}
        onPointerUp={() => {
          if (!held) return
          setHeld(false)
          onRelease(last.current)
        }}
        onPointerCancel={() => {
          if (!held) return
          setHeld(false)
          onRelease(last.current)
        }}
        onKeyDown={(e) => {
          if (disabled || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return
          e.preventDefault()
          const d = (e.key === "ArrowLeft" ? -step : step) * (e.shiftKey ? 10 : 1)
          const next = Math.max(0, Math.min(1, p + d))
          onMove(next)
          onRelease(next)
        }}
      >
        <div className="bg-muted absolute inset-x-0 h-2 rounded-full" />
        <div className={cn("absolute left-0 h-2 rounded-full", fill)} style={{ width: `${p * 100}%` }} />
        <div
          className={cn(
            "absolute size-6 -translate-x-1/2 rounded-full border-4 bg-white",
            tone === "signal" ? "border-signal" : "border-sky-500",
            glow,
          )}
          style={{ left: `${p * 100}%` }}
        />
      </div>

      {ticks.length > 0 && (
        <div className="relative mt-1 h-9">
          {ticks.map((t, i) => {
            // The end labels hang inward rather than centred, or they overhang the track.
            const edge = t.at <= 0.001 ? "start" : t.at >= 0.999 ? "end" : "mid"
            return (
              <div key={i} className="absolute top-0" style={{ left: `${t.at * 100}%` }}>
                <div className={cn("bg-muted-foreground/50 absolute left-0 w-px", t.major ? "h-3" : "h-1.5")} />
                {t.label && (
                  <div className={cn(
                    "text-muted-foreground absolute top-4 text-xs whitespace-nowrap tabular-nums",
                    t.wideOnly && "hidden sm:block",
                    edge === "start" ? "left-0" : edge === "end" ? "right-0" : "-translate-x-1/2",
                  )}>
                    {t.label}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
