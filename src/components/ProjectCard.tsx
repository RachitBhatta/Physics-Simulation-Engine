import type { ProjectMeta } from '../lib/projects'
import './ProjectCard.css'

interface Props {
  project: ProjectMeta
  onOpen: (id: string) => void
}

export default function ProjectCard({ project, onOpen }: Props) {
  const disabled = project.status !== 'ready'
  return (
    <button
      className={`plate ${disabled ? 'plate--locked' : ''}`}
      onClick={() => !disabled && onOpen(project.id)}
      disabled={disabled}
    >
      <span className="plate__screw plate__screw--tl" />
      <span className="plate__screw plate__screw--tr" />
      <span className="plate__screw plate__screw--bl" />
      <span className="plate__screw plate__screw--br" />

      <span className="plate__number">{project.number}</span>
      <h3 className="plate__title">{project.title}</h3>
      <p className="plate__subtitle">{project.subtitle}</p>
      <p className="plate__desc">{project.description}</p>

      <span className="plate__tags">
        {project.tags.map((t) => (
          <span key={t} className="plate__tag">
            {t}
          </span>
        ))}
      </span>

      {disabled && <span className="plate__status">Reserved</span>}
    </button>
  )
}
