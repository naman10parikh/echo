---
globs: ["*.tsx", "*.jsx"]
---

- Functional components only, no class components
- React Server Components where possible (Next.js 15 App Router)
- State: Zustand for global, useState for local, no Redux
- Styling: TailwindCSS utilities, no inline styles, no CSS modules
- Dark mode: use `dark:` prefix variants, test both modes
- shadcn/ui for all base components (Button, Dialog, Input, etc.)
- Fonts: Instrument Serif for display/headings, Poppins for body — both via `next/font` (matches `.claude/rules/design.md`; serif+sans pairing is the single highest-impact anti-AI-slop change)
- Theme: warm-black surfaces (#141312, NOT pure black) + amber accent + editorial serif/sans pairing. The canonical token set lives in `.claude/rules/design.md` and is operationalized + enforced by **pixel** (the CP123 frontend employee — warm-black+amber+Instrument-Serif design tokens + a `pixel-anti-slop` skill at `naman10parikh/pixel`). Do NOT use the old generic-purple / AI-gradient palette. New product frontends should consume pixel (CLI/MCP/skill) — see `audit/cp123/HUB-CONSUMPTION.md`.
