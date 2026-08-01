import { useEffect, useState } from 'react'

export type Theme = 'oak' | 'walnut'

const STORAGE_KEY = 'physics-lab-theme'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'oak' || saved === 'walnut') return saved
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'walnut'
      : 'oak'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggle = () => setTheme((t) => (t === 'oak' ? 'walnut' : 'oak'))

  return { theme, toggle }
}
