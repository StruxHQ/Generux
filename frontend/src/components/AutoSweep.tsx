import { useState } from "react"
import { PlayIcon, RepeatIcon, SquareIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { formatHz, parseHz } from "@/hooks/use-wave"

export interface SweepPlan {
  from: number
  to: number
  seconds: number
  loop: boolean
}

/**
 * An automatic sweep from one frequency to another over a time, logarithmic, once
 * or over and over. It is driven from this browser tab: closing the tab stops it
 * where it is.
 */
export function AutoSweep({
  min,
  max,
  active,
  disabled,
  onStart,
  onStop,
}: {
  min: number
  max: number
  active: boolean
  disabled?: boolean
  onStart: (plan: SweepPlan) => void
  onStop: () => void
}) {
  const [from, setFrom] = useState("100")
  const [to, setTo] = useState("10k")
  const [seconds, setSeconds] = useState("5")
  const [loop, setLoop] = useState(true)

  const f = parseHz(from)
  const t = parseHz(to)
  const s = Number(seconds.replace(",", "."))
  const inRange = (hz: number) => Number.isFinite(hz) && hz >= min && hz <= max
  const valid = inRange(f) && inRange(t) && f !== t && Number.isFinite(s) && s >= 0.2 && s <= 3600

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (active) onStop()
        else if (valid) onStart({ from: f, to: t, seconds: s, loop })
      }}
    >
      <div className="grid grid-cols-3 gap-2">
        <Field id="sweep-from" label="From" value={from} onChange={setFrom}
          invalid={from !== "" && !inRange(f)} hint={inRange(f) ? formatHz(f) : "Hz, or 1.5k"} />
        <Field id="sweep-to" label="To" value={to} onChange={setTo}
          invalid={to !== "" && !inRange(t)} hint={inRange(t) ? formatHz(t) : "Hz, or 1.5k"} />
        <Field id="sweep-time" label="Time" value={seconds} onChange={setSeconds}
          invalid={seconds !== "" && !(s >= 0.2 && s <= 3600)} hint="seconds" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Switch id="sweep-loop" checked={loop} onCheckedChange={setLoop} disabled={active} />
          <Label htmlFor="sweep-loop" className="flex items-center gap-1.5">
            <RepeatIcon className="size-3.5" /> Repeat
          </Label>
        </div>
        <Button
          type="submit"
          disabled={disabled || (!active && !valid)}
          className={active ? "" : "bg-signal text-signal-foreground hover:bg-signal/90"}
          variant={active ? "outline" : "default"}
        >
          {active ? <SquareIcon /> : <PlayIcon />}
          {active ? "Stop sweep" : "Start sweep"}
        </Button>
      </div>
    </form>
  )
}

function Field({ id, label, value, onChange, invalid, hint }: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  invalid: boolean
  hint: string
}) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-muted-foreground text-xs">{label}</Label>
      <Input id={id} value={value} inputMode="decimal" aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)} />
      <p className="text-muted-foreground truncate text-xs">{hint}</p>
    </div>
  )
}
