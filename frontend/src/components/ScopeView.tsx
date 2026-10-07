import { cn } from "@/lib/utils"

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
 * What the pin is doing, drawn the way a scope would show it: a 50% duty square
 * wave at `hz`, on an automatic 1-2-5 timebase. Drawn from the reported frequency,
 * not measured — it is a picture of the setting, not a probe.
 *
 * Dark in both themes on purpose: it is a screen.
 */
export function ScopeView({ hz, on, className }: { hz: number; on: boolean; className?: string }) {
  const high = H * 0.25
  const low = H * 0.75
  let d: string
  let div = 0

  if (on && hz > 0) {
    div = timebase(hz)
    const span = div * DIVS_X
    const half = W / (2 * hz * span) // half a period, in pixels
    d = `M 0 ${high}`
    let level = high
    for (let x = half; x < W; x += half) {
      level = level === high ? low : high
      d += ` H ${x} V ${level}`
    }
    d += ` H ${W}`
  } else {
    d = `M 0 ${low} H ${W}`
  }

  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-zinc-950", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img"
        aria-label={on ? `Square wave at ${hz} Hz` : "Output off, held low"}>
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
          strokeWidth={3} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="absolute right-3 bottom-2 font-mono text-xs text-zinc-400">
        {on ? `${formatTime(div)}/div` : "Output off"}
      </span>
    </div>
  )
}
