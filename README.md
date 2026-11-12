# Workout OS · gym.peterslab.app

A personal training app for one person on iPhone, built for one outcome: getting lean and strong. A home screen PWA that tells you the next workout, shows how to do every exercise (photos, a plain how-to and a video), logs each set in one tap, raises the weights from what you actually did, and keeps the fat loss side honest: calories and protein targets that correct themselves from your real weight trend, plus daily steps.

Part of [peterslab.app](https://peterslab.app). Built in public; the data stays private (offline first on the phone, synced to a Cloudflare D1 database behind a sync key).

- `docs/SPEC.md`: what the app does · `docs/PROGRAM.md`: the 12-week program
- `docs/ENGINE_RULES.md`: exact progression and scheduling rules · `docs/DECISIONS.md`: judgment calls
- `CLAUDE.md`: layout, commands and rules for working on the code

Stack: Vite, React, Tailwind, Dexie, Zod, Hono on Cloudflare Workers, D1. The training engine (`packages/engine`) is pure TypeScript with every threshold in `config/engine.json`.

Exercise photos and the base of the exercise library come from [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense). The how-to videos are YouTube links to their creators' own uploads; nothing is rehosted.

Not medical advice. The program follows common coaching practice; check with a doctor if you have heart risk factors or pain.
