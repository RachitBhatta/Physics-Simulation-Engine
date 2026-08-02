export interface ProjectMeta {
  id: string
  number: string // e.g. "01" — shown on the specimen plate
  title: string
  subtitle: string
  description: string
  tags: string[]
  status: 'ready' | 'coming-soon'
}

/**
 * Add a new project by appending an entry here, then create a matching
 * component in src/projects/<id>/ and register its route in App.tsx.
 */
export const projects: ProjectMeta[] = [
  {
    id: 'circular-motion',
    number: '01',
    title: 'Circular Motion & SHM',
    subtitle: 'Reference circle demonstration',
    description:
      'Watch a particle trace a circle while its x and y shadows oscillate independently as simple harmonic motion — with velocity, acceleration, and live waveforms.',
    tags: ['Kinematics', 'SHM'],
    status: 'ready',
  },
  {
    id: 'water-ripple',
    number: '02',
    title: 'Water Droplet Ripple',
    subtitle: 'Top-down 2D wave equation',
    description:
      'Drop water onto a still pond and watch the disturbance spread as an expanding circular ring, rendered with real-time normal-mapped lighting for a pseudo-3D water surface.',
    tags: ['Waves', 'Fluids'],
    status: 'ready',
  },
  {
    id: 'string-wave',
    number: '03',
    title: 'Wave on a String',
    subtitle: 'Transverse wave, pluck or drive',
    description:
      'Pluck a string by hand or drive it continuously from one end. Tune the drive frequency against a fixed boundary to lock in a standing wave with visible nodes and antinodes.',
    tags: ['Waves', 'Transverse'],
    status: 'ready',
  },
  {
    id: 'longitudinal-wave',
    number: '04',
    title: 'Longitudinal Wave',
    subtitle: 'Speaker driving a field of molecules',
    description:
      'Click the speaker cone to set it vibrating. Watch compression and rarefaction bands ripple through a field of air molecules — the same mechanism behind sound, with intensity and molecule density under your control.',
    tags: ['Waves', 'Sound'],
    status: 'ready',
  },
  {
    id: 'simple-pendulum',
    number: '05',
    title: 'Simple Pendulum',
    subtitle: 'Length, gravity, friction, live vectors',
    description:
      'Drag the bob to set a starting angle and release it. Live velocity and acceleration vectors reveal exactly why both peak in different places — and how far real motion drifts from small-angle SHM.',
    tags: ['Oscillations', 'SHM'],
    status: 'ready',
  },
]

