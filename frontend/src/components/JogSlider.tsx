import { useRef, useState } from "react"

import { cn } from "cn"

// Inside this much of centre counts as centre, so a thumb let go a pixel off does
// not keep creeping.
const DEAD_ZONE = 0.03

/**
 * A spring-loaded slider: it rests in the middle, reports how far it is pushed
 * (-1 … 1) while held, and snaps back to 0 on release. The value is a RATE, not a
 * position — what it controls is up to the caller.
 *
 * Keyboard: hold ← / → for half deflection, with Shift for full.
 */
export function JogSlider({
  onJog,
  disabled,
  label,
  className,
}: {
  /** Called with every change in deflection, and with 0 on release. */
  onJog: (deflection: number) => void
  disabled?: boolean
  label: string
  className?: string
}) {
  const track = useRef<HTMLDivElement>(null)
  const [deflection, setDeflection] = useState(0)
  const [held, setHeld] = useState(false)

  function update(next: number) {
    const d = Math.abs(next) < DEAD_ZONE ? 0 : Math.max(-1, Math.min(1, next))
    setDeflection(d)
    onJog(d)
  }

  function fromPointer(clientX: number) {
    const r = track.current?.getBoundingClientRect()
    if (!r) return
    update((clientX - (r.left + r.width / 2)) / (r.width / 2))
  }

  function release() {
    setHeld(false)
    update(0)
  }

  return (
    <div
      ref={track}
      role="slider"
      aria-label={label}
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={Math.round(deflection * 100)}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "relative h-10 touch-none select-none rounded-full border bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        disabled ? "opacity-50" : "cursor-grab active:cursor-grabbing",
        className,
      )}
      onPointerDown={(e) => {
        if (disabled) return
        e.currentTarget.setPointerCapture(e.pointerId)
        setHeld(true)
        fromPointer(e.clientX)
      }}
      onPointerMove={(e) => {
        if (held) fromPointer(e.clientX)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={(e) => {
        if (disabled || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return
        e.preventDefault()
        const size = e.shiftKey ? 1 : 0.5
        update(e.key === "ArrowLeft" ? -size : size)
      }}
      onKeyUp={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") update(0)
      }}
      onBlur={() => {
        if (deflection !== 0) update(0)
      }}
    >
      {/* Fill from the centre to the thumb, so the direction and the size of the
          push read at a glance. */}
      <div
        className={cn(
          "absolute inset-y-1 rounded-full bg-signal/30",
          !held && "transition-all duration-200 ease-out",
        )}
        style={{
          left: `${50 + Math.min(0, deflection) * 50}%`,
          width: `${Math.abs(deflection) * 50}%`,
        }}
      />
      <div className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-border" />
      <div
        className={cn(
          "absolute top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-signal bg-background shadow",
          !held && "transition-[left] duration-200 ease-out",
        )}
        style={{ left: `calc(${50 + deflection * 50}% + ${-deflection * 16}px)` }}
      />
    </div>
  )
}
