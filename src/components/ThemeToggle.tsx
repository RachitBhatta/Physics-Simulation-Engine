import type { Theme } from '../lib/useTheme'
import './ThemeToggle.css'

interface Props {
  theme: Theme
  onToggle: () => void
}

export default function ThemeToggle({ theme, onToggle }: Props) {
  const isWalnut = theme === 'walnut'
  return (
    <button
      className="theme-toggle"
      onClick={onToggle}
      aria-label={`Switch to ${isWalnut ? 'oak' : 'walnut'} finish`}
      title={`Switch to ${isWalnut ? 'oak' : 'walnut'} finish`}
    >
      <span className="theme-toggle__label">{isWalnut ? 'Walnut' : 'Oak'}</span>
      <span className={`theme-toggle__rail ${isWalnut ? 'is-on' : ''}`}>
        <span className="theme-toggle__knob" />
      </span>
    </button>
  )
}
