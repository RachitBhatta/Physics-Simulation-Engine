import './Checkbox.css'

interface Props {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}

export default function Checkbox({ label, checked, onChange }: Props) {
  return (
    <label className="checkbox-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="checkbox-row__box" />
      <span className="checkbox-row__label">{label}</span>
    </label>
  )
}
