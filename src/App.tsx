import { useState } from 'react'
import Home from './pages/Home'
import CircularMotionSim from './projects/circular-motion/CircularMotionSim'
import { useTheme } from './lib/useTheme'

type Route = { name: 'home' } | { name: 'project'; id: string }

export default function App() {
  const { theme, toggle } = useTheme()
  const [route, setRoute] = useState<Route>({ name: 'home' })

  if (route.name === 'project' && route.id === 'circular-motion') {
    return (
      <CircularMotionSim
        theme={theme}
        onBack={() => setRoute({ name: 'home' })}
      />
    )
  }

  return (
    <Home
      theme={theme}
      onToggleTheme={toggle}
      onOpenProject={(id) => setRoute({ name: 'project', id })}
    />
  )
}
