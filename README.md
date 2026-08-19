# 🂡 Pocket Poker

Texas Hold'em you can actually play with friends — **online across devices**, or
offline against AI / pass-and-play on a single phone. No accounts, no installs.

## Two ways to play

### 🌐 Online multiplayer (play with friends over the internet)
Everyone opens the site, one person taps **Create Table** and shares the 4-letter
code; friends tap **Join**. You're all at the same table from your own phones, and
**each person sees only their own hole cards** — the deck lives on the server, so
nobody can peek at anyone else's hand. Fill empty seats with **bots** if you're a
player short. Reconnect and your seat is still there.

This mode needs the small **Node server** in this repo running somewhere (see
[Deploy](#deploy-the-online-server) below).

### 📱 Offline (no server needed)
`offline.html` (and the repo root) is a single self-contained page: play against
**1–3 AI opponents**, or **pass-and-play** where 2–4 people share one phone and tap
*Peek* to see their cards privately. This works from any static host (e.g. GitHub
Pages) — no server required.

## Run it locally

```bash
npm install
npm start
# open http://localhost:3000  — create a table, add a bot, Deal In
```

Open the same URL in a second browser/tab (or another device on your network) and
join with the code to see real multiplayer.

## Deploy the online server

The online mode is a tiny Node app (`server/server.js`, ~1 dependency) that serves
the web client **and** runs the WebSocket game. Any host that runs Node works. This
repo includes a **Render** blueprint for a near one-click deploy:

1. Push this repo to GitHub (already done).
2. Go to **[render.com](https://render.com)** → **New +** → **Blueprint** →
   connect this repository → **Apply**. Render reads `render.yaml` and deploys.
3. When it's live you'll get a URL like `https://pocket-poker.onrender.com` — share
   that with friends. That's your online table.

Any equivalent host (Railway, Fly.io, a VPS) works too — the start command is just
`npm start` and it listens on `$PORT`. Free tiers may sleep when idle, so the first
visit after a while can take a few seconds to wake.

> GitHub Pages can host the **offline** game (static files), but **not** the online
> mode — Pages can't run a server, and hidden cards require one.

## How online stays fair

The server is authoritative: it holds the shuffled deck and every hole card, runs
all betting and showdown logic, and sends each connected player a **redacted** view
containing only their own cards (opponents show as face-down until showdown). Clients
can't see or forge state they weren't given. Turn timers auto-check/fold idle
players, and disconnects keep your seat for reconnection.

## Full Texas Hold'em rules

- Small/big blinds with a rotating dealer button (correct heads-up rules)
- Pre-flop, flop, turn, river betting; fold / check / call / bet / raise with a bet slider and pot-fraction presets
- Minimum-raise enforcement, and a **short all-in does not reopen** betting for players who already acted
- **All-in run-outs with correct side pots** and uncalled-bet returns
- Best 5-of-7 hand evaluation (straight flushes down to high card, including the wheel), exact tie-breaks, dealer-relative odd-chip splits

## Project layout

| Path | Purpose |
|------|---------|
| `server/server.js` | Online server: static hosting + WebSocket rooms |
| `server/engine.js` | Authoritative game engine (cards, evaluation, betting, side pots) |
| `public/` | Online web client (`index.html`, `style.css`, `client.js`) + bundled `offline.html` |
| `index.html`, `style.css`, `game.js` | The standalone offline game (also served at `public/offline.html`) |
| `tests.js`, `server/engine.test.js` | Automated test suites |

## Testing

```bash
npm test          # runs both suites
```

- **`tests.js`** (79 assertions) — deck integrity, every hand category and tie-break,
  the ace-low wheel, best-5-of-7 (0/1/2 hole cards, board plays), side pots and splits,
  dealer-relative odd chips, betting incl. short-all-in reopening, card/chip invariants,
  and a full `C(52,5)` enumeration matching the exact 5-card hand frequencies.
- **`server/engine.test.js`** (23 assertions) — multi-player hands to completion with
  chip conservation, **hidden-card redaction**, fold-to-one, all-in run-outs with side
  pots, and turn enforcement.

Plus end-to-end checks over real WebSocket connections (no card leaks, chips conserved,
bots act, reconnection restores seats) and headless-browser playthroughs of both clients.

Everything is vanilla JavaScript. The only runtime dependency is `ws` (WebSocket) for
the server; the browser clients use no frameworks and load no external assets.
