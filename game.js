/* =========================================================================
   Pocket Poker — Texas Hold'em (vs AI or local Pass & Play)
   Single-file vanilla JS engine + UI. No dependencies.
   ========================================================================= */
'use strict';

/* ---------- Cards ---------- */
const SUITS = ['♠', '♥', '♦', '♣']; // ♠ ♥ ♦ ♣
const SUIT_RED = [false, true, true, false];
const RANKS = { 2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A' };
const RANK_WORDS = { 2:'Two',3:'Three',4:'Four',5:'Five',6:'Six',7:'Seven',8:'Eight',9:'Nine',10:'Ten',11:'Jack',12:'Queen',13:'King',14:'Ace' };

function makeDeck(){
  const d = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ r, s });
  return d;
}
function shuffle(a){
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const cardKey = c => c.r * 4 + c.s;

/* ---------- Hand evaluation (best 5 of 7) ---------- */
// Returns a comparable array: [category, ...tiebreakers]. Bigger = better.
// Categories: 8 SF, 7 Quads, 6 FullHouse, 5 Flush, 4 Straight, 3 Trips, 2 TwoPair, 1 Pair, 0 High
function eval5(cards){
  const ranks = cards.map(c => c.r).sort((a, b) => b - a);
  const suits = cards.map(c => c.s);
  const isFlush = suits.every(s => s === suits[0]);

  // straight (with wheel A-2-3-4-5)
  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5){
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // wheel
  }

  // rank multiplicities
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([r, n]) => ({ r: +r, n }))
    .sort((a, b) => b.n - a.n || b.r - a.r);

  if (isFlush && straightHigh) return [8, straightHigh];
  if (groups[0].n === 4) return [7, groups[0].r, groups[1].r];
  if (groups[0].n === 3 && groups[1].n === 2) return [6, groups[0].r, groups[1].r];
  if (isFlush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (groups[0].n === 3) return [3, groups[0].r, ...groups.slice(1).map(g => g.r)];
  if (groups[0].n === 2 && groups[1].n === 2){
    const hi = Math.max(groups[0].r, groups[1].r);
    const lo = Math.min(groups[0].r, groups[1].r);
    return [2, hi, lo, groups[2].r];
  }
  if (groups[0].n === 2) return [1, groups[0].r, ...groups.slice(1).map(g => g.r)];
  return [0, ...ranks];
}

const C7 = [ // all 5-card index combinations from 7
  [0,1,2,3,4],[0,1,2,3,5],[0,1,2,3,6],[0,1,2,4,5],[0,1,2,4,6],[0,1,2,5,6],
  [0,1,3,4,5],[0,1,3,4,6],[0,1,3,5,6],[0,1,4,5,6],[0,2,3,4,5],[0,2,3,4,6],
  [0,2,3,5,6],[0,2,4,5,6],[0,3,4,5,6],[1,2,3,4,5],[1,2,3,4,6],[1,2,3,5,6],
  [1,2,4,5,6],[1,3,4,5,6],[2,3,4,5,6]
];
function combos(n, k){
  const res = [], idx = [];
  (function build(start, depth){
    if (depth === k){ res.push(idx.slice()); return; }
    for (let i = start; i < n; i++){ idx.push(i); build(i + 1, depth + 1); idx.pop(); }
  })(0, 0);
  return res;
}
const COMBO_CACHE = {};
// Best 5-card hand from any 5..7 card set. Returns null if fewer than 5.
function bestHand(cards){
  if (cards.length < 5) return null;
  if (cards.length === 5) return eval5(cards);
  const key = cards.length;
  const list = COMBO_CACHE[key] || (COMBO_CACHE[key] = combos(cards.length, 5));
  let best = null;
  for (const combo of list){
    const s = eval5(combo.map(i => cards[i]));
    if (!best || cmpScore(s, best) > 0) best = s;
  }
  return best;
}
function bestOf7(cards){ return bestHand(cards); }
function cmpScore(a, b){
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++){
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}
const CAT_NAMES = ['High Card','Pair','Two Pair','Three of a Kind','Straight','Flush','Full House','Four of a Kind','Straight Flush'];
function handName(score){
  const cat = score[0];
  switch (cat){
    case 8: return score[1] === 14 ? 'Royal Flush' : `Straight Flush, ${RANK_WORDS[score[1]]} high`;
    case 7: return `Four of a Kind, ${RANK_WORDS[score[1]]}s`;
    case 6: return `Full House, ${RANK_WORDS[score[1]]}s over ${RANK_WORDS[score[2]]}s`;
    case 5: return `Flush, ${RANK_WORDS[score[1]]} high`;
    case 4: return `Straight, ${RANK_WORDS[score[1]]} high`;
    case 3: return `Three of a Kind, ${RANK_WORDS[score[1]]}s`;
    case 2: return `Two Pair, ${RANK_WORDS[score[1]]}s & ${RANK_WORDS[score[2]]}s`;
    case 1: return `Pair of ${RANK_WORDS[score[1]]}s`;
    default: return `${RANK_WORDS[score[1]]} High`;
  }
}

/* ---------- AI equity via Monte Carlo ---------- */
function estimateEquity(hole, board, numOpp, samples){
  const used = new Set([...hole, ...board].map(cardKey));
  const full = makeDeck().filter(c => !used.has(cardKey(c)));
  let win = 0, tie = 0;
  const needBoard = 5 - board.length;
  for (let s = 0; s < samples; s++){
    const pool = full.slice();
    shuffle(pool);
    let p = 0;
    const fullBoard = board.concat(pool.slice(p, p += needBoard));
    const myScore = bestOf7(hole.concat(fullBoard));
    let best = 0, tied = false;
    for (let o = 0; o < numOpp; o++){
      const oppHole = pool.slice(p, p += 2);
      const oppScore = bestOf7(oppHole.concat(fullBoard));
      const c = cmpScore(oppScore, myScore);
      if (c > 0){ best = 1; break; }
      if (c === 0) tied = true;
    }
    if (best) continue;
    if (tied) tie++;
    else win++;
  }
  return (win + tie * 0.5) / samples;
}

/* =========================================================================
   Game state
   ========================================================================= */
const G = {
  mode: 'ai',
  players: [],
  deck: [],
  board: [],
  dealer: 0,
  sb: 10, bb: 20,
  pot: 0,
  currentBet: 0,
  minRaise: 0,
  stage: 'idle',
  actor: -1,
  handNum: 0,
  peeked: false,
  busy: false,
  handLive: false,
};

function newPlayer(id, name, isHuman, stack){
  return { id, name, isHuman, stack, cards: [], bet: 0, totalBet: 0,
           folded: false, allIn: false, acted: false, out: false, lastAction: '' };
}

function startGame(cfg){
  G.mode = cfg.mode;
  G.sb = cfg.blind;
  G.bb = cfg.blind * 2;
  G.players = [];
  if (cfg.mode === 'ai'){
    G.players.push(newPlayer(0, 'You', true, cfg.stack));
    const names = ['Ada', 'Blake', 'Cleo'];
    for (let i = 0; i < cfg.opponents; i++)
      G.players.push(newPlayer(i + 1, names[i], false, cfg.stack));
  } else {
    for (let i = 0; i < cfg.humans; i++)
      G.players.push(newPlayer(i, `Player ${i + 1}`, true, cfg.stack));
  }
  G.dealer = Math.floor(Math.random() * G.players.length);
  G.handNum = 0;
  show('table');
  newHand();
}

function activePlayers(){ return G.players.filter(p => !p.out); }
function inHand(){ return G.players.filter(p => !p.folded && !p.out); }

function newHand(){
  // remove busted players
  for (const p of G.players) if (p.stack <= 0) p.out = true;
  const live = activePlayers();
  if (live.length < 2){ return endGame(); }

  G.handLive = true;
  G.busy = false;
  G.handNum++;
  G.deck = shuffle(makeDeck());
  G.board = [];
  G.pot = 0;
  G.currentBet = 0;
  G.stage = 'preflop';
  G.peeked = false;
  for (const p of G.players){
    p.cards = []; p.bet = 0; p.totalBet = 0; p.acted = false;
    p.lastAction = '';
    p.folded = p.out;
    p.allIn = false;
  }

  // advance dealer to a live player
  do { G.dealer = (G.dealer + 1) % G.players.length; } while (G.players[G.dealer].out);

  const order = liveOrderFrom(G.dealer); // dealer first
  // blind positions
  let sbPos, bbPos;
  if (order.length === 2){ sbPos = order[0]; bbPos = order[1]; }
  else { sbPos = order[1]; bbPos = order[2]; }

  postBlind(sbPos, G.sb);
  postBlind(bbPos, G.bb);
  G.currentBet = G.bb;
  G.minRaise = G.bb;

  // deal 2 cards each, starting left of dealer
  for (let round = 0; round < 2; round++)
    for (const idx of order.slice(1).concat(order[0]))
      if (!G.players[idx].out) G.players[idx].cards.push(G.deck.pop());

  // first to act preflop = player after BB
  G.actor = nextLive(bbPos);
  renderTable();
  setMsg(`Hand #${G.handNum} — blinds ${G.sb}/${G.bb}`);
  setTimeout(processTurn, 500);
}

function liveOrderFrom(start){
  const order = [];
  let i = start;
  for (let n = 0; n < G.players.length; n++){
    if (!G.players[i].out) order.push(i);
    i = (i + 1) % G.players.length;
  }
  return order;
}
function nextLive(from){
  let i = (from + 1) % G.players.length;
  while (G.players[i].out) i = (i + 1) % G.players.length;
  return i;
}
function postBlind(idx, amt){
  const p = G.players[idx];
  const put = Math.min(amt, p.stack);
  p.stack -= put; p.bet = put; p.totalBet = put; p.pot; G.pot += put;
  if (p.stack === 0) p.allIn = true;
}

/* ---------- Betting engine ---------- */
function needsToAct(p){ return !p.folded && !p.allIn && !p.out && (!p.acted || p.bet < G.currentBet); }

function nextActor(from){
  let i = from;
  for (let n = 0; n < G.players.length; n++){
    i = (i + 1) % G.players.length;
    if (needsToAct(G.players[i])) return i;
  }
  return -1;
}

function bettingComplete(){
  const contenders = G.players.filter(p => !p.folded && !p.out);
  if (contenders.length <= 1) return true;
  return !G.players.some(needsToAct);
}

function processTurn(){
  if (!G.handLive) return; // stale timer after hand already resolved
  // Only one contender left -> award pot
  const contenders = inHand();
  if (contenders.length <= 1){ return awardUncontested(); }

  if (bettingComplete()){ return advanceStreet(); }

  const p = G.players[G.actor];
  if (!needsToAct(p)){
    G.actor = nextActor(G.actor);
    if (G.actor === -1) return advanceStreet();
    return processTurn();
  }

  renderTable();
  if (p.isHuman){
    if (G.mode === 'pass') showHandoff(p);
    else { G.peeked = true; renderYou(p); renderControls(p); }
  } else {
    setMsg(`${p.name} is thinking…`);
    renderControls(null);
    setTimeout(() => aiAct(p), 650 + Math.random() * 500);
  }
}

function humanTurnBegin(p){ // called after handoff peek confirm
  G.peeked = true;
  renderYou(p);
  renderControls(p);
}

function applyAction(idx, action, amount){
  const p = G.players[idx];
  p.acted = true;
  const callAmt = G.currentBet - p.bet;

  if (action === 'fold'){
    p.folded = true; p.lastAction = 'fold';
  } else if (action === 'check'){
    p.lastAction = 'check';
  } else if (action === 'call'){
    const put = Math.min(callAmt, p.stack);
    p.stack -= put; p.bet += put; p.totalBet += put; G.pot += put;
    if (p.stack === 0) p.allIn = true;
    p.lastAction = p.allIn ? 'allin' : 'call';
  } else if (action === 'bet' || action === 'raise'){
    // amount = total this-street bet the player is moving to
    const target = Math.min(amount, p.bet + p.stack);
    const put = target - p.bet;
    p.stack -= put; p.bet = target; p.totalBet += put; G.pot += put;
    const raiseSize = p.bet - G.currentBet;
    if (raiseSize >= G.minRaise) G.minRaise = raiseSize;
    G.currentBet = Math.max(G.currentBet, p.bet);
    if (p.stack === 0) p.allIn = true;
    // a genuine raise re-opens action
    for (const q of G.players) if (q !== p && !q.folded && !q.allIn && !q.out) q.acted = false;
    p.lastAction = p.allIn ? 'allin' : (action === 'bet' ? 'bet' : 'raise');
  }

  G.peeked = false;
  G.actor = nextActor(idx);
  renderTable();
  G.busy = false;
  setTimeout(processTurn, action === 'fold' ? 350 : 500);
}

function advanceStreet(){
  // reset street bets
  for (const p of G.players){ p.bet = 0; p.acted = false; if (p.lastAction !== 'fold') p.lastAction = ''; }
  G.currentBet = 0;
  G.minRaise = G.bb;

  if (G.stage === 'preflop'){ G.stage = 'flop'; dealBoard(3); }
  else if (G.stage === 'flop'){ G.stage = 'turn'; dealBoard(1); }
  else if (G.stage === 'turn'){ G.stage = 'river'; dealBoard(1); }
  else { return showdown(); }

  // if everyone is all-in, keep dealing to showdown
  const canAct = G.players.filter(p => !p.folded && !p.allIn && !p.out);
  G.actor = nextLive(G.dealer); // first active left of dealer (SB seat)
  while (G.players[G.actor].folded || G.players[G.actor].out || G.players[G.actor].allIn){
    const nx = nextActor(G.actor - 1 < 0 ? G.players.length - 1 : G.actor);
    if (nx === -1) break;
    G.actor = nx; break;
  }
  renderTable();
  if (canAct.length <= 1){
    setMsg('All in — running it out…');
    setTimeout(() => { if (!G.handLive) return; if (G.stage !== 'river') advanceStreet(); else showdown(); }, 900);
  } else {
    // proper first actor postflop = first live, non-allin left of dealer
    G.actor = firstToActPostflop();
    setTimeout(processTurn, 600);
  }
}
function firstToActPostflop(){
  let i = G.dealer;
  for (let n = 0; n < G.players.length; n++){
    i = (i + 1) % G.players.length;
    const p = G.players[i];
    if (!p.folded && !p.out && !p.allIn) return i;
  }
  return nextLive(G.dealer);
}

function dealBoard(n){
  G.deck.pop(); // burn
  for (let i = 0; i < n; i++) G.board.push(G.deck.pop());
}

/* ---------- Showdown & pots ---------- */
function buildPots(){
  const contribs = G.players.filter(p => p.totalBet > 0);
  const levels = [...new Set(contribs.map(p => p.totalBet))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const lvl of levels){
    const seg = lvl - prev;
    const contributors = G.players.filter(p => p.totalBet >= lvl);
    const amount = seg * contributors.length;
    const contribIds = contributors.map(p => p.id);
    const eligible = contributors.filter(p => !p.folded).map(p => p.id);
    pots.push({ amount, seg, eligible, contributors: contribIds });
    prev = lvl;
  }
  // merge consecutive pots with identical eligibility AND contributor sets
  const merged = [];
  for (const pot of pots){
    const last = merged[merged.length - 1];
    if (last && sameSet(last.eligible, pot.eligible) && sameSet(last.contributors, pot.contributors)){
      last.amount += pot.amount; last.seg += pot.seg;
    } else merged.push({ ...pot });
  }
  return merged;
}
function sameSet(a, b){ return a.length === b.length && a.every(x => b.includes(x)); }

function showdown(){
  if (!G.handLive) return;
  G.handLive = false;
  G.stage = 'showdown';
  renderTable();
  const scores = {};
  for (const p of inHand()) scores[p.id] = bestOf7(p.cards.concat(G.board));

  const pots = buildPots();
  const winnings = {};
  const potResults = [];
  for (const pot of pots){
    const contenders = pot.eligible.filter(id => scores[id]);
    if (contenders.length === 0){
      // No eligible winner (uncalled chips): refund to this layer's contributors.
      for (const id of pot.contributors) G.players.find(p => p.id === id).stack += pot.seg;
      continue;
    }
    let best = null;
    for (const id of contenders) if (!best || cmpScore(scores[id], scores[best]) > 0) best = id;
    const winners = contenders.filter(id => cmpScore(scores[id], scores[best]) === 0);
    const share = Math.floor(pot.amount / winners.length);
    let rem = pot.amount - share * winners.length;
    for (const id of winners){
      let amt = share;
      if (rem > 0){ amt++; rem--; }
      winnings[id] = (winnings[id] || 0) + amt;
      G.players.find(p => p.id === id).stack += amt;
    }
    potResults.push({ amount: pot.amount, winners, name: handName(scores[best]) });
  }
  for (const p of G.players) if (winnings[p.id]) markWinner(p.id);
  G.pot = 0;
  renderTable();
  showShowdownModal(scores, potResults, winnings);
}

function awardUncontested(){
  if (!G.handLive) return;
  G.handLive = false;
  const winner = inHand()[0];
  if (!winner){ G.pot = 0; return nextHandOrEnd(); }
  winner.stack += G.pot;
  markWinner(winner.id);
  renderTable();
  const won = G.pot;
  G.pot = 0;
  setMsg(`${winner.name} wins ${won} — everyone folded`);
  G.busy = true;
  setTimeout(() => { clearWinners(); nextHandOrEnd(); }, 1600);
}

let winnerIds = new Set();
function markWinner(id){ winnerIds.add(id); }
function clearWinners(){ winnerIds = new Set(); }

function nextHandOrEnd(){
  clearWinners();
  for (const p of G.players) if (p.stack <= 0) p.out = true;
  if (activePlayers().length < 2) return endGame();
  newHand();
}

function endGame(){
  const winner = G.players.reduce((a, b) => (b.stack > a.stack ? b : a));
  showModal(`
    <h2>Game Over</h2>
    <p class="muted">${winner.name} takes the table with ${winner.stack} chips.</p>
    <div class="modal-actions">
      <button class="btn-primary" onclick="closeModal(); show('home')">Home</button>
    </div>
  `);
}

/* =========================================================================
   AI
   ========================================================================= */
function aiAct(p){
  const numOpp = Math.max(1, inHand().length - 1);
  const samples = G.stage === 'preflop' ? 160 : 220;
  let equity = estimateEquity(p.cards, G.board, numOpp, samples);

  const callAmt = G.currentBet - p.bet;
  const potOdds = callAmt > 0 ? callAmt / (G.pot + callAmt) : 0;
  const rnd = Math.random();
  const bluff = rnd < 0.08; // occasional bluff
  const potBefore = G.pot;

  // position/looseness jitter
  equity += (Math.random() - 0.5) * 0.06;

  let action = 'check', amount = 0;

  if (callAmt === 0){
    // option to check or bet
    if (equity > 0.62 || (bluff && equity > 0.30)){
      action = 'bet';
      const size = equity > 0.80 ? 0.9 : equity > 0.65 ? 0.6 : 0.45;
      amount = betTarget(p, Math.round(potBefore * size));
      if (amount <= p.bet){ action = 'check'; }
    } else {
      action = 'check';
    }
  } else {
    if (equity > potOdds + 0.10){
      // strong enough to continue; sometimes raise
      const canRaise = p.stack > callAmt;
      if (canRaise && (equity > 0.80 || (equity > 0.64 && rnd < 0.45) || (bluff && rnd < 0.5))){
        action = 'raise';
        const size = equity > 0.85 ? 0.95 : 0.6;
        amount = betTarget(p, G.currentBet + Math.max(G.minRaise, Math.round((potBefore + callAmt) * size)));
        if (amount <= G.currentBet){ action = 'call'; amount = 0; }
      } else {
        action = 'call';
      }
    } else if (equity > potOdds - 0.03 && callAmt <= p.stack * 0.15){
      action = 'call'; // cheap to see
    } else if (bluff && p.stack > callAmt * 3 && G.stage !== 'preflop'){
      action = 'raise';
      amount = betTarget(p, G.currentBet + Math.max(G.minRaise, Math.round(potBefore * 0.6)));
      if (amount <= G.currentBet){ action = 'fold'; }
    } else {
      action = 'fold';
    }
  }

  applyAction(p.id === undefined ? 0 : G.players.indexOf(p), action, amount);
}

// clamp a desired total-street bet to legal bounds
function betTarget(p, desiredTotal){
  const maxTotal = p.bet + p.stack; // all-in ceiling
  let t = Math.min(desiredTotal, maxTotal);
  // ensure at least a min-raise unless it's an all-in shove
  const minLegal = G.currentBet + G.minRaise;
  if (t < minLegal && t < maxTotal) t = Math.min(minLegal, maxTotal);
  return Math.max(t, G.currentBet); // never below current
}

/* =========================================================================
   Rendering
   ========================================================================= */
const $ = sel => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

function cardHTML(card, small, faceDown){
  if (faceDown) return `<div class="card${small ? ' sm' : ''} back"></div>`;
  const red = SUIT_RED[card.s];
  const r = RANKS[card.r], suit = SUITS[card.s];
  return `<div class="card${small ? ' sm' : ''} ${red ? 'red' : 'black'} deal-in">
      <span class="rank">${r}</span><span class="suit">${suit}</span><span class="rank-br">${r}</span></div>`;
}
function emptyCardHTML(small){ return `<div class="card${small ? ' sm' : ''} empty"></div>`; }

function renderTable(){
  $('#potAmount').textContent = G.pot.toLocaleString();
  const stageNames = { preflop:'Pre-Flop', flop:'Flop', turn:'Turn', river:'River', showdown:'Showdown' };
  $('#stageBadge').textContent = stageNames[G.stage] || '—';

  // board
  const board = $('#board');
  board.innerHTML = '';
  for (let i = 0; i < 5; i++){
    board.insertAdjacentHTML('beforeend', G.board[i] ? cardHTML(G.board[i], false, false) : emptyCardHTML(false));
  }

  // seats — everyone
  const seats = $('#seats');
  seats.innerHTML = '';
  G.players.forEach((p, idx) => {
    if (p.out && p.stack <= 0 && G.stage !== 'showdown') { /* still show as out */ }
    const seat = el('div', 'seat');
    if (idx === G.actor && G.stage !== 'showdown' && !p.folded) seat.classList.add('active');
    if (p.folded) seat.classList.add('folded');
    if (winnerIds.has(p.id)) seat.classList.add('winner');

    let badge = '';
    if (idx === G.dealer) badge = '<span class="seat-badge">D</span>';

    // cards display
    let cards = '';
    const revealAtShowdown = G.stage === 'showdown' && !p.folded;
    const showFace = revealAtShowdown ||
      (p.isHuman && G.mode === 'ai') ||               // your own cards in AI mode
      (p.isHuman && idx === G.actor && G.peeked);     // peeked in pass mode
    if (p.cards.length){
      cards = `<div class="seat-cards">${p.cards.map(c => cardHTML(c, true, !showFace)).join('')}</div>`;
    }

    seat.innerHTML = `${badge}
      <div class="seat-name">${p.name}${p.out ? ' 💀' : ''}</div>
      ${cards}
      <div class="seat-stack">${p.stack.toLocaleString()}</div>
      <div class="seat-bet">${p.bet > 0 ? 'bet ' + p.bet : ''}</div>`;
    if (p.lastAction && p.lastAction !== '' && G.stage !== 'showdown'){
      const a = el('div', 'seat-action ' + p.lastAction, p.lastAction.toUpperCase());
      seat.appendChild(a);
    }
    seats.appendChild(seat);
  });
}

function setMsg(t){ const m = $('#tableMsg'); if (m) m.textContent = t || ''; }

function renderYou(p){
  const y = $('#youSeat');
  if (!p){ y.innerHTML = ''; return; }
  const hideCards = G.mode === 'pass' && !G.peeked;
  const cardsHTML = p.cards.map(c => cardHTML(c, false, hideCards)).join('');
  let label = '';
  if (!hideCards){
    const all = p.cards.concat(G.board);
    if (all.length >= 5) label = handName(bestHand(all));
  }
  y.innerHTML = `
    <div class="you-info">
      <div class="you-name">${p.name}</div>
      <div class="you-stack">${p.stack.toLocaleString()}</div>
    </div>
    <div style="text-align:center">
      <div class="you-cards">${cardsHTML}</div>
      <div class="you-hand-label">${label}</div>
    </div>`;
}

function renderControls(p){
  const c = $('#controls');
  c.innerHTML = '';
  if (!p){ c.innerHTML = '<div class="note">Waiting…</div>'; renderYou(null); return; }
  if (G.mode === 'pass' && !G.peeked){ return; } // handoff overlay handles it

  renderYou(p);

  const callAmt = G.currentBet - p.bet;
  const canCheck = callAmt === 0;
  const maxRaiseTotal = p.bet + p.stack;
  const minRaiseTotal = Math.min(G.currentBet + G.minRaise, maxRaiseTotal);
  const canRaise = p.stack > callAmt; // has chips beyond a call

  // Raise slider
  if (canRaise){
    const betRow = el('div', 'bet-row');
    const slider = el('input');
    slider.type = 'range';
    slider.min = minRaiseTotal;
    slider.max = maxRaiseTotal;
    slider.step = Math.max(1, Math.round(G.bb / 2));
    slider.value = Math.min(Math.max(minRaiseTotal, Math.round((G.pot) * 0.5) + G.currentBet), maxRaiseTotal);
    const amtLabel = el('div', 'bet-amt', slider.value);
    slider.oninput = () => { amtLabel.textContent = (+slider.value).toLocaleString(); };
    betRow.appendChild(slider);
    betRow.appendChild(amtLabel);
    c.appendChild(betRow);

    const presets = el('div', 'raise-presets');
    const mk = (txt, total) => {
      const b = el('button', null, txt);
      b.onclick = () => { const v = Math.min(Math.max(total, minRaiseTotal), maxRaiseTotal); slider.value = v; amtLabel.textContent = (+v).toLocaleString(); };
      return b;
    };
    presets.appendChild(mk('½ Pot', G.currentBet + Math.round((G.pot + callAmt) * 0.5)));
    presets.appendChild(mk('Pot', G.currentBet + (G.pot + callAmt)));
    presets.appendChild(mk('2× Pot', G.currentBet + (G.pot + callAmt) * 2));
    presets.appendChild(mk('All In', maxRaiseTotal));
    c.appendChild(presets);
  }

  const row = el('div', 'action-row');
  const foldBtn = el('button', 'abtn fold', 'Fold');
  foldBtn.onclick = () => act(p, 'fold');
  row.appendChild(foldBtn);

  if (canCheck){
    const b = el('button', 'abtn check', 'Check');
    b.onclick = () => act(p, 'check');
    row.appendChild(b);
  } else {
    const b = el('button', 'abtn call', `Call ${Math.min(callAmt, p.stack).toLocaleString()}`);
    b.onclick = () => act(p, 'call');
    row.appendChild(b);
  }

  if (canRaise){
    const b = el('button', 'abtn raise', canCheck ? 'Bet' : 'Raise');
    b.onclick = () => {
      const slider = c.querySelector('input[type=range]');
      const total = +slider.value;
      act(p, canCheck ? 'bet' : 'raise', total);
    };
    row.appendChild(b);
  }
  c.appendChild(row);
}

function act(p, action, amount){
  if (G.busy) return;
  G.busy = true;
  const idx = G.players.indexOf(p);
  $('#controls').innerHTML = '<div class="note">…</div>';
  applyAction(idx, action, amount || 0);
}

/* ---------- Pass & Play handoff ---------- */
function showHandoff(p){
  renderControls(null);
  renderYou(null);
  const felt = $('.felt');
  const old = felt.querySelector('.handoff');
  if (old) old.remove();
  const ho = el('div', 'handoff');
  ho.innerHTML = `
    <h2>${p.name}</h2>
    <p>Pass the phone to <b>${p.name}</b>.<br>Make sure no one else is looking, then peek at your cards.</p>
    <button class="btn-primary" id="peekBtn">Peek at my cards</button>`;
  felt.appendChild(ho);
  ho.querySelector('#peekBtn').onclick = () => {
    ho.remove();
    humanTurnBegin(p);
  };
}

/* ---------- Showdown modal ---------- */
function showShowdownModal(scores, potResults, winnings){
  let html = '<h2>Showdown</h2>';
  const shown = inHand();
  for (const p of shown){
    const sc = scores[p.id];
    const won = winnings[p.id] || 0;
    html += `<div class="result-line ${won ? 'win' : ''}">
        <div>
          <div>${p.name} ${won ? '<span class="win-badge">+' + won + '</span>' : ''}</div>
          <div class="showdown-hand">${p.cards.map(c => cardHTML(c, true, false)).join('')}</div>
          <div class="muted">${handName(sc)}</div>
        </div>
      </div>`;
  }
  if (potResults.length > 1){
    html += '<p class="muted" style="margin-top:10px">Side pots were split by eligibility.</p>';
  }
  html += `<div class="modal-actions">
      <button class="btn-primary" id="nextHandBtn">Next Hand</button>
    </div>`;
  showModal(html);
  $('#nextHandBtn').onclick = () => { closeModal(); nextHandOrEnd(); };
}

/* ---------- Menu ---------- */
function showMenu(){
  showModal(`
    <h2>Menu</h2>
    <div class="result-line"><span>Mode</span><span>${G.mode === 'ai' ? 'vs AI' : 'Pass & Play'}</span></div>
    <div class="result-line"><span>Blinds</span><span>${G.sb} / ${G.bb}</span></div>
    <div class="result-line"><span>Hand</span><span>#${G.handNum}</span></div>
    <div class="modal-actions">
      <button class="abtn ghost" onclick="closeModal()">Resume</button>
      <button class="abtn fold" id="quitBtn">Quit to Home</button>
    </div>
  `);
  $('#quitBtn').onclick = () => { closeModal(); show('home'); };
}

/* ---------- Modal utils ---------- */
function showModal(html){ $('#modalBody').innerHTML = html; $('#modal').classList.add('show'); }
function closeModal(){ $('#modal').classList.remove('show'); $('#modalBody').innerHTML = ''; }

/* ---------- Screen switching ---------- */
function show(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('#' + id).classList.add('active');
}

/* =========================================================================
   Setup screen wiring
   ========================================================================= */
const cfg = { mode: 'ai', opponents: 1, humans: 2, stack: 1000, blind: 10 };

function wireSeg(segId, key, cast, cb){
  const seg = document.getElementById(segId);
  seg.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    seg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    cfg[key] = cast(btn.dataset[Object.keys(btn.dataset)[0]]);
    if (cb) cb();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modeSeg').addEventListener('click', e => {
    const btn = e.target.closest('button'); if (!btn) return;
    document.querySelectorAll('#modeSeg button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    cfg.mode = btn.dataset.mode;
    document.getElementById('opponentsField').style.display = cfg.mode === 'ai' ? '' : 'none';
    document.getElementById('humansField').style.display = cfg.mode === 'pass' ? '' : 'none';
  });
  wireSeg('oppSeg', 'opponents', Number);
  wireSeg('humanSeg', 'humans', Number);
  wireSeg('stackSeg', 'stack', Number);
  wireSeg('blindSeg', 'blind', Number);

  document.getElementById('startBtn').onclick = () => startGame({ ...cfg });
  document.getElementById('menuBtn').onclick = showMenu;
});
