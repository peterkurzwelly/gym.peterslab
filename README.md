# Workout OS · gym.peterslab.app

A personal, consistency-first training app for one person on iPhone: a home screen PWA that tells you the next session in line, logs each set in one or two taps, sets the next targets from what you actually did, and explains every change. Its main job is 12 weeks without a zero week.

Part of [peterslab.app](https://peterslab.app). Built in public; the data stays private (offline first on the phone, synced to a Cloudflare D1 database behind a sync key).

- `docs/SPEC.md`: what the app does · `docs/PROGRAM.md`: the 12-week program
- `docs/ENGINE_RULES.md`: exact progression and scheduling rules · `docs/DECISIONS.md`: judgment calls
- `CLAUDE.md`: layout, commands and rules for working on the code

Stack: Vite, React, Tailwind, Dexie, Zod, Hono on Cloudflare Workers, D1. The training engine (`packages/engine`) is pure TypeScript with every threshold in `config/engine.json`.

Not medical advice. The program follows common coaching practice; check with a doctor if you have heart risk factors or pain.
