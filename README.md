# 🂡 Pocket Poker

A polished, mobile-first **Texas Hold'em** game you can play right in the browser —
against the computer or against the person sitting next to you.

No installs, no accounts, no build step. Just open `index.html`.

## Play

- **On your phone:** open `index.html` in any mobile browser (or host the folder anywhere static).
- **On desktop:** open `index.html` directly.

## Modes

### 🤖 vs AI
Play heads-up or against up to 3 AI opponents. Each bot estimates its real win
probability with a Monte-Carlo equity simulation on every decision, mixes in pot
odds, and bluffs occasionally — so it calls, folds, value-bets and check-raises
like a real (if imperfect) opponent rather than following a fixed script.

### 👥 Pass & Play
Two to four people share a single phone. Between turns the screen blanks with a
**"Pass the phone to …"** hand-off, and each player taps **Peek** to privately see
their own hole cards. Everything is revealed at showdown.

## Full Texas Hold'em rules

- Small/big blinds with a rotating dealer button (heads-up blind rules handled correctly)
- Pre-flop, flop, turn and river betting rounds
- Fold / check / call / bet / raise, with a bet slider and ½-pot, pot, 2×-pot and all-in presets
- Minimum-raise enforcement and re-opened action on raises
- **All-in handling with correct side pots** and uncalled-bet refunds
- Proper 5-of-7 hand evaluation (straight flushes down to high card, including the wheel)
- Odd-chip and split-pot distribution

## Configuration

From the home screen you choose the mode, number of opponents/players, starting
stack (500 / 1,000 / 2,500) and the small blind (5 / 10 / 25). The big blind is
twice the small blind. Play continues until one player holds all the chips.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup and screen structure |
| `style.css`  | All styling (mobile-first, safe-area aware, dark felt theme) |
| `game.js`    | Game engine, hand evaluator, AI, and UI logic — no dependencies |

## Under the hood

- **Hand evaluation** — evaluates the best 5-card hand from any 5–7 cards and returns
  a comparable score array for exact tie-breaking.
- **AI equity** — `estimateEquity()` runs a few hundred Monte-Carlo rollouts against
  random opponent holdings given the current board.
- **Betting engine** — a small state machine drives street progression, blind posting,
  action re-opening, and all-in run-outs, with chip conservation guaranteed (verified by
  fuzz tests and full-game browser playthroughs).

Everything is vanilla JavaScript — no frameworks, no network calls, no external assets.
