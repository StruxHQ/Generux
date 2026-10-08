import { useEffect, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { PowerIcon } from "lucide-react"

import { AutoSweep } from "@/components/AutoSweep"
import { DigitDisplay, type Unit } from "@/components/DigitDisplay"
import { JogSlider } from "@/components/JogSlider"
import { RangeSlider, type Tick } from "@/components/RangeSlider"
import { ScopeView } from "@/components/ScopeView"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { cn } from "cn"
import { formatHz, formatPeriod, parseHz, useWave } from "@/hooks/use-wave"
import type { SweepPlan } from "@/components/AutoSweep"

const PRESETS = [50, 100, 1_000, 5_000, 10_000, 50_000, 100_000, 1_000_000]

// Jog speed at full deflection, in octaves per second. The deflection is squared
// first, so the first part of the travel is fine adjustment: a tenth of the way out
// moves about 2% a second, all the way out doubles the frequency three times a
// second — the whole 5 Hz to 1 MHz range in about six seconds.
const MAX_OCTAVES_PER_S = 3

// A digit step or a wheel notch streams unpersisted and commits once nothing has
// moved for this long: one flash write per adjustment, not one per notch.
const ADJUST_SETTLE_MS = 600
// While a slider is held it never settles on its own; letting go commits.
const HELD_MS = 60_000

const MIN_DUTY = 1
const MAX_DUTY = 99

/// What is moving the frequency right now, frame by frame.
type Motion = { kind: "jog" } | ({ kind: "auto"; t0: number } & SweepPlan)

// ── The frequency slider's log scale.
const toPos = (hz: number, min: number, max: number) =>
  Math.log(Math.max(min, hz) / min) / Math.log(max / min)
const fromPos = (p: number, min: number, max: number) => min * (max / min) ** p

/// To three significant figures: a slider position is not worth more, and a
/// round number is easier to read back.
function roundSig(hz: number): number {
  const e = 10 ** Math.max(0, Math.floor(Math.log10(hz)) - 2)
  return Math.round(hz / e) * e
}

/// A labelled tick on every decade and at both ends, a short one on 2…9 of each.
/// On a narrow screen only every other decade keeps its label.
function logTicks(min: number, max: number): Tick[] {
  const ticks: Tick[] = [{ at: 0, major: true, label: formatHz(min) }]
  for (let k = Math.floor(Math.log10(min)); 10 ** k <= max; k++) {
    for (let m = 1; m <= 9; m++) {
      const hz = m * 10 ** k
      if (hz <= min || hz > max) continue
      ticks.push(m === 1
        ? { at: toPos(hz, min, max), major: true, label: formatHz(hz), wideOnly: k % 2 === 1 }
        : { at: toPos(hz, min, max) })
    }
  }
  return ticks
}

function unitFor(hz: number): Unit {
  return hz >= 1e6 ? "MHz" : hz >= 1000 ? "kHz" : "Hz"
}

/**
 * The home screen, and it is the product: a square-wave generator
 * (main/app/WaveManager on the firmware side).
 *
 * Every frequency control ends in one of two things. A *commit* sets a frequency
 * and persists it. A *live* change — a digit being stepped, the slider being
 * dragged, the jog slider or an automatic sweep — streams unpersisted, then
 * commits where it stopped. The duty works the same way.
 */
export default function HomePage() {
  const { state, busy, error, set, sweepTo, sweepEnd, dutyTo, dutyEnd } = useWave()

  const min = state?.min ?? 5
  const max = state?.max ?? 1_000_000
  const clamp = (hz: number) => Math.max(min, Math.min(max, Math.round(hz)))

  // ── Display unit: seeded from the first state, the user's choice after that.
  const [unit, setUnit] = useState<Unit>("kHz")
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    if (seeded || !state) return
    setUnit(unitFor(state.freq))
    setSeeded(true)
  }, [state, seeded])

  // ── Commit. `landed` is the frequency last sent until the device's reply to it
  // arrives, so a second change before the first reply builds on the first and
  // not on a stale state.
  const landed = useRef<number | null>(null)
  const base = () => landed.current ?? state?.freq ?? 1000

  function commit(freq: number) {
    landed.current = freq
    void sweepEnd(freq).then((err) => {
      if (landed.current === freq) landed.current = null
      if (err) toast.error("Could not set the frequency", { description: err })
    })
  }

  async function setOutput(enabled: boolean) {
    const err = await set({ enabled })
    if (err) toast.error("Could not switch the output", { description: err })
  }

  const [liveHz, setLiveHz] = useState<number | null>(null)

  // ── Live adjustment: digits, wheel, the log slider. Streamed, committed on settle.
  const adjHz = useRef<number | null>(null)
  const adjTimer = useRef<number | null>(null)

  function adjustTo(hz: number, settleMs = ADJUST_SETTLE_MS) {
    stopMotion()
    const next = clamp(hz)
    adjHz.current = next
    setLiveHz(next)
    sweepTo(next)
    if (adjTimer.current !== null) clearTimeout(adjTimer.current)
    adjTimer.current = window.setTimeout(endAdjust, settleMs)
  }

  const nudge = (delta: number) => adjustTo((adjHz.current ?? base()) + delta)

  /// Commit an adjustment still settling. Every other control calls this first,
  /// so it builds on where the adjustment left the frequency.
  function endAdjust() {
    if (adjTimer.current !== null) clearTimeout(adjTimer.current)
    adjTimer.current = null
    const f = adjHz.current
    if (f === null) return
    adjHz.current = null
    setLiveHz(null)
    commit(f)
  }

  // ── Motion: one animation loop, fed by whichever control is moving.
  const [autoActive, setAutoActive] = useState(false)
  const motion = useRef<Motion | null>(null)
  const jog = useRef(0)
  const hz = useRef(0)
  const frame = useRef<number | null>(null)

  /// Start or hand over a motion. A handover (auto sweep -> jog) carries on from
  /// where the frequency is; a fresh start begins at `from`, or at the current one.
  function startMotion(m: Motion, from?: number) {
    endAdjust()
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

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      if (adjTimer.current !== null) clearTimeout(adjTimer.current)
    },
    [],
  )

  function onJog(d: number) {
    jog.current = d
    if (d !== 0 && motion.current?.kind !== "jog") startMotion({ kind: "jog" })
    else if (d === 0 && motion.current?.kind === "jog") stopMotion()
  }

  /// Any discrete control first ends what is moving, so it builds on where that stopped.
  function jump(to: (current: number) => number) {
    endAdjust()
    stopMotion()
    commit(clamp(to(base())))
  }

  // ── Duty: streamed while the slider moves, committed on release or entry.
  const [liveDuty, setLiveDuty] = useState<number | null>(null)
  const dutyLanded = useRef<number | null>(null)
  const clampDuty = (d: number) => Math.max(MIN_DUTY, Math.min(MAX_DUTY, Math.round(d)))

  function dutyMove(d: number) {
    const v = clampDuty(d)
    setLiveDuty(v)
    dutyTo(v)
  }

  function dutyCommit(d: number) {
    const v = clampDuty(d)
    setLiveDuty(v)
    dutyLanded.current = v
    void dutyEnd(v).then((err) => {
      if (dutyLanded.current === v) {
        dutyLanded.current = null
        setLiveDuty(null)
      }
      if (err) toast.error("Could not set the duty cycle", { description: err })
    })
  }

  const [dutyEdit, setDutyEdit] = useState<string | null>(null)
  const [exact, setExact] = useState("")
  const exactHz = parseHz(exact)
  const exactValid = Number.isFinite(exactHz) && exactHz >= min && exactHz <= max

  // ── What to show.
  const ready = state !== null
  const running = state?.enabled === true
  const setHz = liveHz ?? landed.current ?? state?.freq ?? 0
  const shownHz = liveHz ?? (state ? (running ? state.actual : state.freq) : 0)
  const duty = liveDuty ?? state?.duty ?? 50
  const dutyActual = state?.dutyActual ?? 0
  const shownDuty = liveDuty ?? (running && dutyActual > 0 ? dutyActual : duty)

  let note = ""
  if (liveHz !== null) note = "Adjusting"
  else if (state && running && state.actual !== state.freq) note = `Set to ${formatHz(state.freq)}`
  else if (state && !running) note = "Output off · starts at this frequency"

  return (
    <div className="w-full space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 32 24" className="h-8 w-11 shrink-0" aria-hidden>
            <path d="M2 20 H9 V4 H23 V20 H30" fill="none" strokeWidth={3.5}
              strokeLinejoin="round" strokeLinecap="round"
              className={running ? "stroke-signal" : "stroke-muted-foreground"}
              style={running ? { filter: "drop-shadow(0 0 3px var(--signal))" } : undefined} />
          </svg>
          <h1 className="text-xl font-bold tracking-[0.08em] uppercase sm:text-3xl">
            Square Wave Generator
          </h1>
        </div>
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() => void setOutput(!running)}
          className={cn(
            "flex items-center gap-3 rounded-full border-2 px-5 py-2 text-sm font-bold tracking-wider uppercase transition-colors disabled:opacity-50",
            running
              ? "border-signal/60 bg-signal/10 text-signal shadow-[0_0_20px_-6px_var(--signal)]"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          <span className={cn("size-2.5 rounded-full",
            running ? "bg-signal shadow-[0_0_8px_var(--signal)]" : "bg-muted-foreground/40")} />
          Output {running ? "on" : "off"}
          <PowerIcon className="size-5" />
        </button>
      </header>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Panel title="Frequency" aside={`${formatHz(min)} – ${formatHz(max)}`}
          className="flex flex-col">
          {/* Centred in whatever height the scope beside it gives the row. */}
          <div className="flex flex-1 flex-col justify-center py-3">
            <DigitDisplay hz={setHz} max={max} unit={unit} onUnit={setUnit}
              onNudge={nudge} disabled={!ready} dim={!running && ready} />
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            Click a digit to select · Scroll or use ↑↓ to adjust · Hold for faster changes
          </p>
        </Panel>

        <Panel title="Waveform (square)">
          <ScopeView hz={shownHz} duty={shownDuty} on={running} />
          <div className="mt-3 flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">
              Period: <span className="text-foreground font-medium tabular-nums">{formatPeriod(shownHz)}</span>
            </span>
            <span className="text-muted-foreground">
              Freq: <span className="text-foreground font-medium tabular-nums">{ready ? formatHz(shownHz) : "…"}</span>
            </span>
          </div>
          <p className="text-muted-foreground mt-1 h-5 text-xs">{note}</p>
        </Panel>
      </div>

      <Panel>
        <RangeSlider
          label="Frequency, logarithmic"
          valueText={formatHz(setHz)}
          position={toPos(setHz || min, min, max)}
          disabled={!ready}
          step={0.002}
          ticks={logTicks(min, max)}
          onMove={(p) => adjustTo(roundSig(fromPos(p, min, max)), HELD_MS)}
          onRelease={(p) => {
            adjustTo(roundSig(fromPos(p, min, max)))
            endAdjust()
          }}
        />
      </Panel>

      <Panel
        title="Duty cycle"
        aside={
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold tabular-nums sm:text-3xl">{duty}%</span>
            <Input
              aria-label="Duty cycle in percent"
              inputMode="numeric"
              className="h-9 w-16 text-center tabular-nums"
              disabled={!ready}
              value={dutyEdit ?? String(duty)}
              onChange={(e) => setDutyEdit(e.target.value)}
              onBlur={() => {
                const v = Number(dutyEdit)
                if (dutyEdit !== null && Number.isFinite(v) && dutyEdit.trim() !== "") dutyCommit(v)
                setDutyEdit(null)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur()
                if (e.key === "Escape") { setDutyEdit(null); e.currentTarget.blur() }
              }}
            />
          </div>
        }
      >
        <RangeSlider
          label="Duty cycle"
          tone="duty"
          valueText={`${duty}%`}
          position={(duty - MIN_DUTY) / (MAX_DUTY - MIN_DUTY)}
          step={1 / (MAX_DUTY - MIN_DUTY)}
          disabled={!ready}
          onMove={(p) => dutyMove(MIN_DUTY + p * (MAX_DUTY - MIN_DUTY))}
          onRelease={(p) => dutyCommit(MIN_DUTY + p * (MAX_DUTY - MIN_DUTY))}
        />
        <div className="text-muted-foreground mt-1 flex justify-between text-sm">
          <span>{MIN_DUTY}%</span>
          <span className="text-xs">
            {running && dutyActual > 0 && Math.abs(dutyActual - duty) >= 0.05
              ? `Reached ${dutyActual.toFixed(1)}% at this frequency` : ""}
          </span>
          <span>{MAX_DUTY}%</span>
        </div>
      </Panel>

      <button
        type="button"
        disabled={!ready || busy}
        onClick={() => void setOutput(!running)}
        className={cn(
          "flex w-full items-center justify-center gap-3 rounded-2xl border-2 py-4 text-lg font-bold tracking-[0.12em] uppercase transition-colors disabled:opacity-50",
          running
            ? "border-signal bg-signal text-signal-foreground shadow-[0_0_28px_-8px_var(--signal)] hover:bg-signal/90"
            : "border-border bg-card hover:bg-muted text-muted-foreground",
        )}
      >
        <PowerIcon className="size-6" strokeWidth={2.5} />
        Output {running ? "enabled" : "disabled"}
      </button>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Presets">
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
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (exactValid) {
                jump(() => exactHz)
                setExact("")
              }
            }}
          >
            <Input aria-label="Exact frequency" placeholder="Exact frequency: 440, 1.5k, 0.5M"
              inputMode="decimal" value={exact} onChange={(e) => setExact(e.target.value)}
              aria-invalid={exact !== "" && !exactValid} disabled={!ready} />
            <Button type="submit" disabled={!exactValid || busy}>Set</Button>
          </form>
        </Panel>

        <Panel title="Sweep">
          <div className="space-y-1.5">
            <JogSlider label="Sweep the frequency down or up" onJog={onJog} disabled={!ready} />
            <div className="text-muted-foreground flex justify-between text-xs">
              <span>◀ lower</span>
              <span>hold to sweep · further is faster</span>
              <span>higher ▶</span>
            </div>
          </div>
          <Separator className="my-4" />
          <AutoSweep min={min} max={max} active={autoActive} disabled={!ready}
            onStart={(plan) => startMotion({ kind: "auto", t0: performance.now(), ...plan }, plan.from)}
            onStop={stopMotion} />
        </Panel>
      </div>

      {error && (
        <p className="text-destructive text-sm">
          Lost contact: {error}. Showing the last known state.
        </p>
      )}
    </div>
  )
}

function Panel({ title, aside, className, children }: {
  title?: string
  aside?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn("bg-card min-w-0 rounded-2xl border p-4 shadow-xs sm:p-5", className)}>
      {(title || aside) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && (
            <h2 className="text-muted-foreground text-sm font-semibold tracking-[0.12em] uppercase">{title}</h2>
          )}
          {typeof aside === "string"
            ? <span className="text-muted-foreground text-sm tabular-nums">{aside}</span>
            : aside}
        </div>
      )}
      {children}
    </section>
  )
}
