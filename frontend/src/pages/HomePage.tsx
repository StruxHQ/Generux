import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { AutoSweep } from "@/components/AutoSweep"
import { FrequencyReadout } from "@/components/FrequencyReadout"
import { JogSlider } from "@/components/JogSlider"
import { ScopeView } from "@/components/ScopeView"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { cn } from "cn"
import { formatHz, formatPeriod, parseHz, useWave } from "@/hooks/use-wave"
import type { SweepPlan } from "@/components/AutoSweep"

const PRESETS = [50, 1_000, 10_000, 100_000, 500_000, 1_000_000, 5_000_000, 10_000_000]

/// The five step buttons, from the frequency's own decade down: 10 kHz … 1 Hz up
/// to 100 kHz, then 100 kHz … 10 Hz in the hundreds of kHz, and so on.
function stepsFor(hz: number): number[] {
  const top = 10 ** Math.max(4, Math.floor(Math.log10(Math.max(1, hz))))
  return [top, top / 10, top / 100, top / 1000, top / 10_000]
}

// Jog speed at full deflection, in octaves per second. The deflection is squared
// first, so the first part of the travel is fine adjustment: a tenth of the way out
// moves about 2% a second, all the way out doubles the frequency three times a
// second — the whole 5 Hz to 13 MHz range in about seven seconds.
const MAX_OCTAVES_PER_S = 3

// Scrolling the readout streams each notch unpersisted and commits once the wheel
// has been still this long: one flash write per adjustment, not one per notch.
const WHEEL_SETTLE_MS = 600
// A notch off the digits moves the frequency by this factor.
const WHEEL_FACTOR = 1.01

type Unit = "Hz" | "kHz" | "MHz"
const UNITS: Unit[] = ["Hz", "kHz", "MHz"]
const SCALE: Record<Unit, number> = { Hz: 1, kHz: 1000, MHz: 1e6 }

/// What is moving the frequency right now, frame by frame.
type Motion = { kind: "jog" } | ({ kind: "auto"; t0: number } & SweepPlan)

/**
 * The home screen, and it is the product: a square-wave generator
 * (main/app/WaveManager on the firmware side).
 *
 * Every control ends in one of two things. A *commit* sets a frequency and
 * persists it. A *motion* — the jog slider or an automatic sweep — integrates a
 * frequency per animation frame and streams it unpersisted, then commits where it
 * stopped.
 */
export default function HomePage() {
  const { state, busy, error, set, sweepTo, sweepEnd } = useWave()

  const min = state?.min ?? 5
  const max = state?.max ?? 13_333_333
  const clamp = (hz: number) => Math.max(min, Math.min(max, Math.round(hz)))

  // ── Typed frequency. Kept apart from what the device reports, so a poll does
  // not overwrite a number half-way through being entered. Seeded once.
  const [text, setText] = useState("")
  const [unit, setUnit] = useState<Unit>("kHz")
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    if (seeded || !state) return
    showTyped(state.freq)
    setSeeded(true)
  }, [state, seeded])

  function showTyped(freq: number) {
    const u: Unit = freq >= 1e6 ? "MHz" : freq >= 1000 ? "kHz" : "Hz"
    setUnit(u)
    setText(String(+(freq / SCALE[u]).toFixed(6)))
  }

  const typed = parseHz(text, SCALE[unit])
  const typedValid = Number.isFinite(typed) && typed >= min && typed <= max

  // ── Commit. `landed` is the frequency last sent until the device's reply to it
  // arrives, so a second click before the first reply builds on the first click
  // and not on a stale state.
  const landed = useRef<number | null>(null)
  const base = () => landed.current ?? state?.freq ?? 1000

  function commit(freq: number) {
    landed.current = freq
    showTyped(freq)
    void sweepEnd(freq).then((err) => {
      if (landed.current === freq) landed.current = null
      if (err) toast.error("Could not set the frequency", { description: err })
    })
  }

  async function setOutput(enabled: boolean) {
    const err = await set({ enabled })
    if (err) toast.error("Could not switch the output", { description: err })
  }

  // ── Motion: one animation loop, fed by whichever control is moving.
  const [liveHz, setLiveHz] = useState<number | null>(null)
  const [autoActive, setAutoActive] = useState(false)
  const motion = useRef<Motion | null>(null)
  const jog = useRef(0)
  const hz = useRef(0)
  const frame = useRef<number | null>(null)

  /// Start or hand over a motion. A handover (auto sweep -> jog) carries on from
  /// where the frequency is; a fresh start begins at `from`, or at the current one.
  function startMotion(m: Motion, from?: number) {
    endWheel()
    if (from !== undefined) hz.current = from
    else if (!motion.current) hz.current = base()
    motion.current = m
    setAutoActive(m.kind === "auto")
    if (frame.current !== null) return

    let last = performance.now()
    const step = (now: number) => {
      const m = motion.current
      if (!m) {
        frame.current = null
        return
      }
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      let done = false

      if (m.kind === "jog") {
        const rate = Math.sign(jog.current) * jog.current ** 2 * MAX_OCTAVES_PER_S
        hz.current *= 2 ** (rate * dt)
      } else {
        let p = (now - m.t0) / (m.seconds * 1000)
        if (m.loop) p %= 1
        else if (p >= 1) {
          p = 1
          done = true
        }
        hz.current = m.from * (m.to / m.from) ** p
      }

      hz.current = Math.max(min, Math.min(max, hz.current))
      const r = Math.round(hz.current)
      setLiveHz(r)
      showTyped(r)
      sweepTo(r)

      if (done) stopMotion()
      else frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }

  function stopMotion() {
    if (!motion.current) return
    motion.current = null
    setAutoActive(false)
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    setLiveHz(null)
    commit(clamp(hz.current))
  }

  // ── Wheel: discrete steps, streamed like a motion and committed once it settles.
  // `wheelHz` is where the scrolling has got to, ahead of any reply.
  const wheelHz = useRef<number | null>(null)
  const wheelTimer = useRef<number | null>(null)

  function onWheelStep(place: number | null, notches: number) {
    if (!ready) return
    stopMotion()
    const from = wheelHz.current ?? base()
    let next = place !== null ? from + place * notches : Math.round(from * WHEEL_FACTOR ** notches)
    if (next === from) next += Math.sign(notches) // 1% of a low frequency rounds to nothing
    next = clamp(next)

    wheelHz.current = next
    setLiveHz(next)
    showTyped(next)
    sweepTo(next)
    if (wheelTimer.current !== null) clearTimeout(wheelTimer.current)
    wheelTimer.current = window.setTimeout(endWheel, WHEEL_SETTLE_MS)
  }

  /// Commit a scroll still settling. Every other control calls this first, so it
  /// builds on where the wheel left the frequency.
  function endWheel() {
    if (wheelTimer.current !== null) clearTimeout(wheelTimer.current)
    wheelTimer.current = null
    const f = wheelHz.current
    if (f === null) return
    wheelHz.current = null
    setLiveHz(null)
    commit(f)
  }

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      if (wheelTimer.current !== null) clearTimeout(wheelTimer.current)
    },
    [],
  )

  function onJog(d: number) {
    jog.current = d
    if (d !== 0 && motion.current?.kind !== "jog") startMotion({ kind: "jog" })
    else if (d === 0 && motion.current?.kind === "jog") stopMotion()
  }

  /// Any discrete control first ends a motion, so it builds on where that stopped.
  function jump(to: (current: number) => number) {
    endWheel()
    stopMotion()
    commit(clamp(to(base())))
  }

  // ── What to show.
  const ready = state !== null
  const running = state?.enabled === true
  const shownHz = liveHz ?? (state ? (running ? state.actual : state.freq) : 0)
  const current = liveHz ?? base()
  const steps = stepsFor(current)

  let caption = ""
  if (liveHz !== null) caption = `Adjusting · period ${formatPeriod(liveHz)}`
  else if (state && running)
    caption = `Period ${formatPeriod(state.actual)}` +
      (state.actual !== state.freq ? ` · set to ${formatHz(state.freq)}` : "")
  else if (state) caption = "Output off · starts at this frequency"

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 32 24" className="h-7 w-9 shrink-0" aria-hidden>
            <path d="M2 20 H9 V4 H23 V20 H30" fill="none" strokeWidth={3.5}
              strokeLinejoin="round" strokeLinecap="round"
              className={running ? "stroke-signal" : "stroke-foreground"} />
          </svg>
          <div>
            <h1 className="text-2xl leading-tight font-bold">Function Generator</h1>
            <p className="text-muted-foreground text-sm">
              Square wave · 50% duty · {formatHz(min)} – {formatHz(max)}
            </p>
          </div>
        </div>
        <label className="bg-card flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 shadow-xs">
          <span className="text-sm font-medium">Output</span>
          <Switch checked={running} onCheckedChange={setOutput} disabled={!ready || busy}
            className="data-checked:bg-signal" />
        </label>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {/* ── Left: set the frequency. */}
        <Card>
          <CardContent className="space-y-5">
            <div className="text-center">
              <p className="text-muted-foreground text-sm">Frequency</p>
              <FrequencyReadout hz={shownHz} ready={ready} dim={!running && ready}
                onStep={onWheelStep} />
              <p className="text-muted-foreground mt-1 h-5 text-sm">{caption}</p>
              <p className="text-muted-foreground text-xs">Scroll over a digit to change it</p>
            </div>

            <div className="grid grid-cols-5 gap-1.5">
              {steps.map((s) => (
                <StepButton key={`+${s}`} label={`+${formatHz(s)}`}
                  disabled={!ready || current >= max} onClick={() => jump((f) => f + s)} />
              ))}
              {steps.map((s) => (
                <StepButton key={`-${s}`} label={`−${formatHz(s)}`}
                  disabled={!ready || current <= min} onClick={() => jump((f) => f - s)} />
              ))}
            </div>

            <div className="space-y-1.5">
              <JogSlider label="Sweep the frequency down or up" onJog={onJog} disabled={!ready} />
              <div className="text-muted-foreground flex justify-between text-xs">
                <span>◀ lower</span>
                <span>hold to sweep · further is faster</span>
                <span>higher ▶</span>
              </div>
            </div>

            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (typedValid) jump(() => typed)
              }}
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="wave-freq" className="text-muted-foreground text-xs">
                  Exact frequency (1.5k or 2M works too)
                </Label>
                <Input id="wave-freq" inputMode="decimal" value={text}
                  onChange={(e) => setText(e.target.value)}
                  aria-invalid={text !== "" && !typedValid} disabled={!ready} />
              </div>
              <div className="flex">
                {UNITS.map((u, i) => (
                  <Button key={u} type="button" variant={unit === u ? "default" : "outline"}
                    onClick={() => setUnit(u)}
                    className={cn(i > 0 && "rounded-l-none", i < UNITS.length - 1 && "rounded-r-none")}>
                    {u}
                  </Button>
                ))}
              </div>
              <Button type="submit" disabled={!typedValid || busy}>Set</Button>
            </form>
          </CardContent>
        </Card>

        {/* ── Right: see it, jump to it, sweep it. */}
        <Card>
          <CardContent className="space-y-5">
            <ScopeView hz={shownHz} on={running} />

            <div className="space-y-2">
              <p className="text-sm font-medium">Presets</p>
              <div className="grid grid-cols-4 gap-1.5">
                {PRESETS.map((p) => {
                  const active = liveHz === null && state?.freq === p
                  return (
                    <Button key={p} variant="outline" disabled={!ready}
                      onClick={() => jump(() => p)}
                      className={cn("tabular-nums", active &&
                        "border-signal bg-signal text-signal-foreground hover:bg-signal/90 hover:text-signal-foreground")}>
                      {formatHz(p)}
                    </Button>
                  )
                })}
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <p className="text-sm font-medium">Sweep</p>
              <AutoSweep min={min} max={max} active={autoActive} disabled={!ready}
                onStart={(plan) => startMotion({ kind: "auto", t0: performance.now(), ...plan }, plan.from)}
                onStop={stopMotion} />
            </div>

            {error && (
              <p className="text-destructive text-sm">
                Lost contact: {error}. Showing the last known state.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StepButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled}
      className="h-9 px-1 text-xs tabular-nums">
      {label}
    </Button>
  )
}
