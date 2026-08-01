import './Switch.css'

interface Props {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  swatch?: string
}

export default function Switch({ label, checked, onChange, swatch }: Props) {
  return (
    <button
      className={`switch-row ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
      type="button"
    >
      <span className="switch-row__rail">
        <span className="switch-row__knob" />
      </span>
      <span className="switch-row__label">{label}</span>
      {swatch && (
        <span className="switch-row__swatch" style={{ background: swatch }} />
      )}
    </button>
  )
}
