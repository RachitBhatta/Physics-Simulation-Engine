import './RadioGroup.css'

interface Option<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  legend?: string
  options: Option<T>[]
  value: T
  onChange: (v: T) => void
}

export default function RadioGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
}: Props<T>) {
  return (
    <fieldset className="radio-group">
      {legend && <legend className="radio-group__legend mono">{legend}</legend>}
      {options.map((opt) => (
        <label key={opt.value} className="radio-row">
          <input
            type="radio"
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
          />
          <span className="radio-row__dot" />
          <span className="radio-row__label">{opt.label}</span>
        </label>
      ))}
    </fieldset>
  )
}
