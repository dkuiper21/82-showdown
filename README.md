# 82 Showdown

Head-to-head NBA draft game. Each round, both players see the same random
single-season roster (e.g. the '96 Bulls) drawn from a pool of **108
team-seasons** (1957–2025), pick one player, and slot him into an 8-man
rotation — five starters by position plus three bench spots. Stats are hidden
by default (tap **Show stats** to peek). One re-roll each. After 8 rounds the
squads battle in a simulated best-of-7 series with era-adjusted ratings, so
1962 Wilt doesn't auto-win.

A player who appears on multiple team-seasons (Wilt, Shaq, LeBron…) can only
be on your roster once. If that rule ever leaves you with no legal pick on a
drawn team, you get a free re-roll automatically.

## Play flow

1. Player 1 creates a game and gets a 4-letter code (or shares the invite link).
2. Player 2 enters the code (or opens the link) on their phone.
3. Both draft simultaneously each round; picks stay hidden until tip-off.
4. Tap **Play Game N** to reveal the series one game at a time.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. Locally, rooms are stored in memory — two browser
tabs can play each other without any setup.

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: **Add New Project** → import the repo → deploy (defaults are fine).
3. Add Redis (required in production — serverless instances don't share memory):
   - Project → **Storage** → **Create Database** → choose **Upstash for Redis**
     (free tier) → connect it to the project.
   - This auto-sets `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or
     `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) — the app reads
     either pair.
4. Redeploy. Done — share your-app.vercel.app with friends.

## Notes & known limitations

- Player stats are approximate per-game numbers for each season; steals and
  blocks before 1974 are estimates (the NBA didn't track them).
- Rooms expire after 24 hours.
- Clients poll every 2 seconds (no websockets needed on Vercel). If both
  players confirm a pick in the exact same instant, one pick can occasionally
  fail to register — the screen will still show your slot as open, just pick
  again.
- No accounts: identity is a random ID in the browser's localStorage, so
  reopening the same link on the same phone resumes your game.

## Tuning the sim

`lib/sim.js` — era factors, bench weight (0.55), offense/defense formulas, and
score noise all live here. `lib/data.js` holds the 108 team-seasons; add more
by following the same shape (every team needs all five positions covered).
