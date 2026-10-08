import { useEffect, useRef } from "react"

import { cn } from "cn"

// One wheel notch, in pixels. Chrome and Edge report 100 per notch of a mouse wheel;
// a trackpad sends many small deltas, which add up to notches the same way.
const PX_PER_NOTCH = 100
// deltaMode 1 (Firefox, mouse wheel) counts lines, three to a notch.
const PX_PER_LINE = PX_PER_NOTCH / 3

/**
 * The big frequency readout, and a knob: scroll over a digit to step that digit, the
 * way a bench generator works. Scrolling over the readout but off the digits reports
 * `place` null and leaves the step size to the caller.
 *
 * Shows whole hertz — in kHz with three decimals from 1 kHz, in MHz with six from
 * 1 MHz — so every digit of the frequency is on screen to be scrolled.
 */
export function FrequencyReadout({
  hz,
  ready,
  dim,
  onStep,
}: {
  hz: number
  ready: boolean
  dim: boolean
  /** Called per whole notch: `notches` is positive for up, `place` the digit's value (1, 10, …) or null. */
  onStep: (place: number | null, notches: number) => void
}) {
  const el = useRef<HTMLParagraphElement>(null)
  const onStepRef = useRef(onStep)
  onStepRef.current = onStep
  const readyRef = useRef(ready)
  readyRef.current = ready

  // A native listener, because React attaches wheel handlers as passive and a
  // passive handler cannot stop the page from scrolling instead.
  useEffect(() => {
    const node = el.current
    if (!node) return
    let carry = 0
    const onWheel = (e: WheelEvent) => {
      if (!readyRef.current) return
      e.preventDefault()
      const px = e.deltaMode === 1 ? e.deltaY * PX_PER_LINE
        : e.deltaMode === 2 ? e.deltaY * PX_PER_NOTCH
        : e.deltaY
      carry -= px // wheel up is a negative delta and should raise the frequency
      const notches = Math.trunc(carry / PX_PER_NOTCH)
      if (notches === 0) return
      carry -= notches * PX_PER_NOTCH
      const digit = (e.target as Element | null)?.closest<HTMLElement>("[data-place]")
      onStepRef.current(digit ? Number(digit.dataset.place) : null, notches)
    }
    node.addEventListener("wheel", onWheel, { passive: false })
    return () => node.removeEventListener("wheel", onWheel)
  }, [])

  const whole = String(Math.max(0, Math.round(hz)))
  const [unit, decimals] = hz >= 1e6 ? ["MHz", 6] : hz >= 1000 ? ["kHz", 3] : ["Hz", 0]
  const point = decimals > 0 ? whole.length - decimals : -1 // index the decimal point goes before

  return (
    <p ref={el} className={cn("tabular-nums select-none", dim && "opacity-60")}
      title="Scroll over a digit to change it">
      <span className="text-5xl font-bold tracking-tight sm:text-6xl">
        {!ready ? "…" : [...whole].map((ch, i) => (
          <span key={i}>
            {i === point && "."}
            <span data-place={10 ** (whole.length - 1 - i)}
              className="hover:bg-muted cursor-ns-resize rounded-sm transition-colors">
              {ch}
            </span>
          </span>
        ))}
      </span>
      <span className="text-muted-foreground ml-2 text-2xl sm:text-3xl">{unit}</span>
    </p>
  )
}
