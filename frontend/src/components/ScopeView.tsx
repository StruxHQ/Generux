import { cn } from "cn"

const DIVS_X = 10
const DIVS_Y = 8
const W = 500
const H = 200

// Timebase steps a scope offers: 1-2-5 per decade.
const STEPS = [1, 2, 5]

/// The smallest 1-2-5 time/div that shows about three periods across the screen.
function timebase(hz: number): number {
  const want = (3 / hz) / DIVS_X
  let decade = 10 ** Math.floor(Math.log10(want))
  for (;;) {
    for (const s of STEPS) if (s * decade >= want) return s * decade
    decade *= 10
  }
}

function formatTime(s: number): string {
  if (s >= 1) return `${+s.toPrecision(3)} s`
  if (s >= 1e-3) return `${+(s * 1e3).toPrecision(3)} ms`
  if (s >= 1e-6) return `${+(s * 1e6).toPrecision(3)} µs`
  return `${+(s * 1e9).toPrecision(3)} ns`
}

/**
 * What the pin is doing, drawn the way a scope would show it: a square wave at
 * `hz` and `duty`, on an automatic 1-2-5 timebase. Drawn from the reported frequency,
 * not measured — it is a picture of the setting, not a probe.
 *
 * Dark in both themes on purpose: it is a screen.
 */
export function ScopeView({ hz, duty = 50, on, className }: {
  hz: number
  /** Percent of each period spent high. */
  duty?: number
  on: boolean
  className?: string
}) {
  const high = H * 0.25
  const low = H * 0.75
  let d: string
  let div = 0

  if (on && hz > 0) {
    div = timebase(hz)
    const span = div * DIVS_X
    const period = W / (hz * span) // one period, in pixels
    const up = period * Math.max(0, Math.min(100, duty)) / 100
    d = `M 0 ${high}`
    for (let x = 0; x < W; x += period) {
      d += ` H ${Math.min(W, x + up)} V ${low} H ${Math.min(W, x + period)} V ${high}`
    }
  } else {
    d = `M 0 ${low} H ${W}`
  }

  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-zinc-950", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img"
        aria-label={on ? `Square wave at ${hz} Hz, ${duty}% duty` : "Output off, held low"}>
        {Array.from({ length: DIVS_X - 1 }, (_, i) => (
          <line key={`x${i}`} x1={((i + 1) * W) / DIVS_X} x2={((i + 1) * W) / DIVS_X} y1={0} y2={H}
            className="stroke-zinc-800" strokeWidth={1} />
        ))}
        {Array.from({ length: DIVS_Y - 1 }, (_, i) => (
          <line key={`y${i}`} y1={((i + 1) * H) / DIVS_Y} y2={((i + 1) * H) / DIVS_Y} x1={0} x2={W}
            className={i === DIVS_Y / 2 - 1 ? "stroke-zinc-700" : "stroke-zinc-800"}
            strokeWidth={1} strokeDasharray={i === DIVS_Y / 2 - 1 ? "4 4" : undefined} />
        ))}
        <path d={d} fill="none" className={on ? "stroke-signal" : "stroke-zinc-600"}
          strokeWidth={3} strokeLinejoin="round" vectorEffect="non-scaling-stroke"
          style={on ? { filter: "drop-shadow(0 0 4px var(--signal))" } : undefined} />
        <text x={6} y={high - 8} className="fill-zinc-500 text-[11px] font-semibold tracking-wider">HIGH</text>
        <text x={6} y={low + 18} className="fill-zinc-500 text-[11px] font-semibold tracking-wider">LOW</text>
      </svg>
      <span className="absolute right-3 bottom-2 font-mono text-xs text-zinc-400">
        {on ? `${formatTime(div)}/div` : "Output off"}
      </span>
    </div>
  )
}
