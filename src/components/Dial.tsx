import './Dial.css'

interface Props {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}

export default function Dial({ label, value, min, max, step, unit, onChange }: Props) {
  return (
    <label className="dial">
      <span className="dial__top">
        <span className="dial__label">{label}</span>
        <span className="dial__value mono">
          {value.toFixed(2)}
          {unit ? ` ${unit}` : ''}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="dial__input"
      />
    </label>
  )
}
