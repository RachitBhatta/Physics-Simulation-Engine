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
  
]
