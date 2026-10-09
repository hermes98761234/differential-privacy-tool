import { useState } from 'react'

interface Props {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  label?: string
  className?: string
}

/** Number input that keeps what you type until it parses. */
export default function NumField({ value, onChange, min, max, step, label, className }: Props) {
  const [text, setText] = useState(String(value))
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    // The value changed from outside (not by typing): show it.
    setSeen(value)
    if (Number(text) !== value) setText(String(value))
  }
  return (
    <input
      type="number"
      inputMode="decimal"
      aria-label={label}
      className={className}
      value={text}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        setText(e.target.value)
        const v = Number(e.target.value)
        if (e.target.value.trim() !== '' && Number.isFinite(v)) {
          setSeen(v)
          onChange(v)
        }
      }}
    />
  )
}
