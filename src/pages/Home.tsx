import { projects } from '../lib/projects'
import ProjectCard from '../components/ProjectCard'
import ThemeToggle from '../components/ThemeToggle'
import type { Theme } from '../lib/useTheme'
import './Home.css'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  onOpenProject: (id: string) => void
}

export default function Home({ theme, onToggleTheme, onOpenProject }: Props) {
  return (
    <div className="home">
      <header className="home__header">
        <div className="home__brand">
          <img src="/logo.svg" alt="" className="home__logo" width={52} height={52} />
          <div>
            <span className="home__eyebrow">The Physics Bench</span>
            <h1 className="home__title">A cabinet of working simulations</h1>
            <p className="home__lede">
              Each plate below opens a small, self-contained demonstration —
              built to build intuition, not just show an animation.
            </p>
          </div>
        </div>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </header>

      <div className="home__grid">
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} onOpen={onOpenProject} />
        ))}
      </div>
    </div>
  )
}
