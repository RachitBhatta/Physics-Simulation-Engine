import { useState } from 'react'
import Home from './pages/Home'
import CircularMotionSim from './projects/circular-motion/CircularMotionSim'
import WaterRippleSim from './projects/water-ripple/WaterRippleSim'
import StringWaveSim from './projects/string-wave/StringWaveSim'
import LongitudinalWaveSim from './projects/longitudinal-wave/LongitudinalWaveSim'
import PendulumSim from './projects/simple-pendulum/PendulumSim'
import { useTheme } from './lib/useTheme'

type Route = { name: 'home' } | { name: 'project'; id: string }

export default function App() {
  const { theme, toggle } = useTheme()
  const [route, setRoute] = useState<Route>({ name: 'home' })
  const onBack = () => setRoute({ name: 'home' })

  if (route.name === 'project' && route.id === 'circular-motion') {
    return <CircularMotionSim theme={theme} onBack={onBack} />
  }
  if (route.name === 'project' && route.id === 'water-ripple') {
    return <WaterRippleSim theme={theme} onBack={onBack} />
  }
  if (route.name === 'project' && route.id === 'string-wave') {
    return <StringWaveSim theme={theme} onBack={onBack} />
  }
  if (route.name === 'project' && route.id === 'longitudinal-wave') {
    return <LongitudinalWaveSim theme={theme} onBack={onBack} />
  }
  if (route.name === 'project' && route.id === 'simple-pendulum') {
    return <PendulumSim theme={theme} onBack={onBack} />
  }

  return (
    <Home
      theme={theme}
      onToggleTheme={toggle}
      onOpenProject={(id) => setRoute({ name: 'project', id })}
    />
  )
}
