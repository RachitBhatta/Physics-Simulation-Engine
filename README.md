<<<<<<< HEAD
# The Physics Bench

A small React + TypeScript + Vite site for physics simulations, styled as a
cabinet of numbered specimen plates on a wood workbench. Oak (light) and
Walnut (dark) finishes, toggleable, persisted in `localStorage`.

First project: **Circular Motion & SHM** — a particle traces a reference
circle while its x and y "shadows" oscillate as simple harmonic motion, with
optional velocity/acceleration vectors, a motion trail, and live x(t)/y(t)
waveform traces.

## Run it locally

```bash
npm install
npm run dev
```

Then open the printed local URL (usually `http://localhost:5173`).

## Build for production

```bash
npm run build
npm run preview
```

## Push to GitHub

```bash
git init
git add .
git commit -m "Physics Bench: circular motion / SHM simulation"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

## Adding your next project

1. Add an entry to `src/lib/projects.ts` (number, title, description, tags,
   `status: 'ready'`).
2. Create `src/projects/<your-id>/YourSim.tsx` (+ a matching `.css` file).
3. In `src/App.tsx`, add a branch that renders your component when
   `route.id === '<your-id>'`.

That's the whole pattern — the home page grid updates automatically from the
registry, so you never touch the layout code again.

## Project structure

```
src/
  components/     shared UI: Dial (slider), Switch, ThemeToggle, ProjectCard
  lib/             theme hook + the project registry
  pages/           Home.tsx (the cabinet grid)
  projects/
    circular-motion/   first simulation, self-contained
  styles/          global.css — all color tokens live here (oak + walnut)
```
=======
# Physcis-Simulation-Engine
This is a small phycis simulation engine made for high school physcis to make the uderstanding of real world phenomenon more comprehensive
>>>>>>> 494748a7fd498a5aa4d9204656d759120a6fb9d9
