# Decisions and assumptions

Where the build deviates from or interprets SPEC.md / PROGRAM.md. Peter: skim this and push back on anything that is wrong.

| # | Decision | Why |
|---|---|---|
| D1 | One Worker (`gym`) serves the PWA as static assets and the API under `/api`, instead of Pages + a separate Worker. | Matches the peterslab.app convention (one repo and Worker per app on `slug.peterslab.app`). One deploy, one domain. |
| D2 | Program templates (program, phase, program_day, prescription) live in `config/program.json`, not in database tables. User edits (block swaps, session order) live in the synced `settings` row. | Templates are static; storing them as rows would drift from config. Logs keep target and actual side by side, so history is intact. |
| D3 | `training_week` stores only user flags (`repaired`). Week state (done counts, floor, target, zero, training week index) is always computed by the engine. `progression_state` is computed, not stored. | Derived data stored in synced rows goes stale and conflicts. The engine replays history deterministically, so it is always right and changing `engine.json` changes behavior immediately (acceptance criterion 6). |
| D4 | Check-in scores: 1 to 5, higher is better for all four (soreness 5 = fresh, stress 5 = calm). | One direction makes the average meaningful and the UI consistent. |
| D5 | Progression is tracked per exercise + rep range ("track"); e1RM stats per exercise. | Romanian deadlift appears light (8 to 10) and heavy (6 to 8); one load track would mix them. |
| D6 | Face pull 12 to 15 (program: 2 × 15), biceps curl and triceps pushdown 10 to 12 (program: 2 × 12). | Double progression needs a range; a single number makes every 14 a "below range". |
| D7 | Large jump: every set ≥ top + 1 and at least half the sets ≥ top + 2. | SPEC 6.3 maps 10, 10, 9 (range 6 to 8) to the larger jump, while PROGRAM.md says all sets beat by 2+. The spec example is an acceptance test, so this rule satisfies both as closely as possible. |
| D8 | Reactive deload makes the *next* training week the deload and cancels week 8. After week 8 it only flags. | "Pulls the week 8 deload forward (once per block)". |
| D9 | Repair = streak freeze: a repaired zero week keeps the run going and counts in "weeks without a zero", but the phase still does not advance. | Spec says one repair per 4 weeks without defining it. |
| D10 | A zero week is a completed week with no strength, travel or cardio session. Walks do not count. | "Weeks without a zero" and "floor weeks" are shown separately, so zero ≠ below floor. |
| D11 | Never miss twice: nudge when 48 h have passed since the last strength session and the floor is not reached. | SPEC 6.4 wording. There are no planned days to miss. |
| D12 | Readiness load cut applies to the first exercise (PROGRAM.md "take 5 to 10% off the first exercise"); configurable. | SPEC says "top set"; the program is more specific. |
| D13 | Rest timer alert: sound + screen flash. iPhone Safari has no vibration API. | Platform limit. |
| D14 | Sync auth: a sync key (Worker secret `SYNC_TOKEN`) pasted once in Settings on each device. Cloudflare Access JWT verification is also implemented and switches on when `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set. `/api` refuses everything when neither is configured, except the public `GET/HEAD` routes `/api/health`, `/api/auth/login` and `/api/ics` (the calendar link opens outside the app without the key; it echoes its query and reads no stored data). The app shell is public and holds no data. | Peter chose the sync key on 2026-11-08: home screen apps on iPhone can loop on Access login when the session expires. The repo and subdomain are public, so the API fails closed. Logging never depends on the network. |
| D15 | D1 database in the EU jurisdiction. | Personal training and check-in data. |
| D16 | Pull-up is the default B3 exercise (spec order); lat pulldown is one tap away and can be swapped for the block. | Spec order. Swap if pull-ups at bodyweight are too hard for week 1. |
| D17 | Defaults from Peter's answers (2026-11-08): no limitations, intervals on bike or rower (both offered), week killers = work peaks, travel, evenings. The app leads with the ★ 30 min version after the evening hour (default 19:00) and when the floor is at risk, keeps the travel version one tap away, and pushes the Sunday booking of two floor sessions. | SPEC 11.4 and 11.5. |
