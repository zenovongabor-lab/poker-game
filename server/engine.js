/* =========================================================================
   Pocket Poker — authoritative server-side engine
   Pure card logic (shared with the tested client) + a Table controller that
   runs a full No-Limit Hold'em hand with server-held hidden cards.
   No dependencies. CommonJS.
   ========================================================================= */
'use strict';

/* ---------- Cards ---------- */
const RANKS = { 2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A' };
const RANK_WORDS = { 2:'Two',3:'Three',4:'Four',5:'Five',6:'Six',7:'Seven',8:'Eight',9:'Nine',10:'Ten',11:'Jack',12:'Queen',13:'King',14:'Ace' };

function makeDeck(){ const d = []; for (let s=0;s<4;s++) for (let r=2;r<=14;r++) d.push({ r, s }); return d; }
function shuffle(a){ for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
const cardKey = c => c.r * 4 + c.s;

/* ---------- Hand evaluation (best 5 of 5..7) ---------- */
function eval5(cards){
  const ranks = cards.map(c => c.r).sort((a,b)=>b-a);
  const suits = cards.map(c => c.s);
  const isFlush = suits.every(s => s === suits[0]);
  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5){
    if (uniq[0]-uniq[4]===4) straightHigh = uniq[0];
    else if (uniq[0]===14 && uniq[1]===5 && uniq[4]===2) straightHigh = 5;
  }
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r]||0)+1;
  const groups = Object.entries(counts).map(([r,n])=>({r:+r,n})).sort((a,b)=>b.n-a.n||b.r-a.r);
  if (isFlush && straightHigh) return [8, straightHigh];
  if (groups[0].n===4) return [7, groups[0].r, groups[1].r];
  if (groups[0].n===3 && groups[1].n===2) return [6, groups[0].r, groups[1].r];
  if (isFlush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (groups[0].n===3) return [3, groups[0].r, ...groups.slice(1).map(g=>g.r)];
  if (groups[0].n===2 && groups[1].n===2){
    const hi=Math.max(groups[0].r,groups[1].r), lo=Math.min(groups[0].r,groups[1].r);
    return [2, hi, lo, groups[2].r];
  }
  if (groups[0].n===2) return [1, groups[0].r, ...groups.slice(1).map(g=>g.r)];
  return [0, ...ranks];
}
function combos(n,k){ const res=[],idx=[]; (function b(start,depth){ if(depth===k){res.push(idx.slice());return;} for(let i=start;i<n;i++){idx.push(i);b(i+1,depth+1);idx.pop();} })(0,0); return res; }
const COMBO_CACHE = {};
function bestHand(cards){
  if (cards.length < 5) return null;
  if (cards.length === 5) return eval5(cards);
  const list = COMBO_CACHE[cards.length] || (COMBO_CACHE[cards.length] = combos(cards.length,5));
  let best = null;
  for (const combo of list){ const s = eval5(combo.map(i=>cards[i])); if (!best || cmpScore(s,best)>0) best = s; }
  return best;
}
function cmpScore(a,b){ const n=Math.max(a.length,b.length); for(let i=0;i<n;i++){ const x=a[i]||0,y=b[i]||0; if(x!==y) return x-y; } return 0; }
function handName(score){
  switch (score[0]){
    case 8: return score[1]===14 ? 'Royal Flush' : `Straight Flush, ${RANK_WORDS[score[1]]} high`;
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

/* ---------- AI equity (Monte-Carlo) for optional bots ---------- */
function estimateEquity(hole, board, numOpp, samples){
  const used = new Set([...hole, ...board].map(cardKey));
  const full = makeDeck().filter(c => !used.has(cardKey(c)));
  let win = 0, tie = 0;
  const needBoard = 5 - board.length;
  for (let s=0;s<samples;s++){
    const pool = full.slice(); shuffle(pool);
    let p = 0;
    const fullBoard = board.concat(pool.slice(p, p+=needBoard));
    const myScore = bestHand(hole.concat(fullBoard));
    let lost = false, tied = false;
    for (let o=0;o<numOpp;o++){
      const oppScore = bestHand(pool.slice(p, p+=2).concat(fullBoard));
      const c = cmpScore(oppScore, myScore);
      if (c > 0){ lost = true; break; }
      if (c === 0) tied = true;
    }
    if (lost) continue;
    if (tied) tie++; else win++;
  }
  return (win + tie*0.5) / samples;
}

/* ---------- Side pots & payouts (pure, dealer-aware odd chips) ---------- */
function sameSet(a,b){ return a.length===b.length && a.every(x=>b.includes(x)); }
function buildPots(players){
  const levels = [...new Set(players.filter(p=>p.totalBet>0).map(p=>p.totalBet))].sort((a,b)=>a-b);
  const pots = []; let prev = 0;
  for (const lvl of levels){
    const seg = lvl - prev;
    const contributors = players.filter(p=>p.totalBet>=lvl);
    const contribIds = contributors.map(p=>p.id);
    const eligible = contributors.filter(p=>!p.folded).map(p=>p.id);
    pots.push({ amount: seg*contributors.length, seg, eligible, contributors: contribIds });
    prev = lvl;
  }
  const merged = [];
  for (const pot of pots){
    const last = merged[merged.length-1];
    if (last && sameSet(last.eligible,pot.eligible) && sameSet(last.contributors,pot.contributors)){ last.amount+=pot.amount; last.seg+=pot.seg; }
    else merged.push({ ...pot });
  }
  return merged;
}
// Order ids clockwise from dealer (small-blind seat first) for odd-chip award.
function orderFromDealer(ids, players, dealer){
  const n = players.length;
  const seat = id => players.findIndex(p=>p.id===id);
  return ids.slice().sort((a,b)=>((seat(a)-dealer-1+n)%n)-((seat(b)-dealer-1+n)%n));
}
function computePayouts(pots, scores, players, dealer){
  const payouts = {}, refunds = {}, results = [];
  for (const pot of pots){
    const contenders = pot.eligible.filter(id => scores[id] !== undefined);
    if (contenders.length === 0){ for (const id of pot.contributors) refunds[id]=(refunds[id]||0)+pot.seg; continue; }
    let best = null;
    for (const id of contenders) if (best===null || cmpScore(scores[id],scores[best])>0) best = id;
    const winners = orderFromDealer(contenders.filter(id=>cmpScore(scores[id],scores[best])===0), players, dealer);
    const share = Math.floor(pot.amount/winners.length);
    let rem = pot.amount - share*winners.length;
    for (const id of winners){ let amt=share; if(rem>0){amt++;rem--;} payouts[id]=(payouts[id]||0)+amt; }
    results.push({ amount: pot.amount, winners, name: handName(scores[best]) });
  }
  return { payouts, refunds, results };
}

/* =========================================================================
   Table controller — one seated game, hand after hand.
   Server-authoritative: the deck and every hole card live here only.
   ========================================================================= */
const STAGES = ['preflop','flop','turn','river'];

class Table {
  constructor({ smallBlind = 10, startingStack = 1000 } = {}){
    this.sb = smallBlind;
    this.bb = smallBlind * 2;
    this.startingStack = startingStack;
    this.players = [];        // seat order
    this.dealer = -1;
    this.stage = 'lobby';     // lobby | preflop | flop | turn | river | showdown
    this.deck = [];
    this.board = [];
    this.currentBet = 0;
    this.minRaise = this.bb;
    this.actor = -1;
    this.handLive = false;
    this.handNum = 0;
    this.lastResults = null;  // { pots:[], reveal:{id:cards}, payouts:{}, message }
    this.message = '';
  }

  addPlayer(id, name){
    if (this.players.find(p => p.id === id)) return this.players.find(p => p.id === id);
    const p = { id, name, stack: this.startingStack, seat: this.players.length,
      cards: [], bet: 0, totalBet: 0, folded: true, allIn: false, acted: false,
      inHand: false, sittingOut: false, connected: true, lastAction: '', busted: false };
    this.players.push(p);
    return p;
  }
  removePlayer(id){
    const p = this.players.find(pl => pl.id === id);
    if (!p) return;
    // If a hand is live and it's their turn or they're in the hand, fold them first.
    if (this.handLive && p.inHand && !p.folded){ this._applyFold(p); this._afterAction(p); }
    this.players = this.players.filter(pl => pl.id !== id);
    this.players.forEach((pl,i)=>pl.seat=i);
    if (this.players.length < 2){ this.handLive = false; if (this.stage !== 'lobby') this.stage = 'lobby'; }
  }
  seatById(id){ return this.players.find(p => p.id === id); }
  eligiblePlayers(){ return this.players.filter(p => p.stack > 0 && !p.sittingOut && !p.busted); }

  /* ---------- Start a hand ---------- */
  startHand(){
    const live = this.eligiblePlayers();
    if (live.length < 2) return { ok:false, error:'Need at least 2 players with chips.' };
    this.handLive = true;
    this.handNum++;
    this.deck = shuffle(makeDeck());
    this.board = [];
    this.currentBet = 0;
    this.minRaise = this.bb;
    this.lastResults = null;
    this.stage = 'preflop';
    for (const p of this.players){
      p.cards = []; p.bet = 0; p.totalBet = 0; p.acted = false; p.lastAction = '';
      p.allIn = false;
      p.inHand = p.stack > 0 && !p.sittingOut && !p.busted;
      p.folded = !p.inHand;
    }
    // advance dealer button to a live seat
    do { this.dealer = (this.dealer + 1) % this.players.length; }
    while (!this.players[this.dealer].inHand);

    const order = this._liveOrderFrom(this.dealer);
    let sbPos, bbPos;
    if (order.length === 2){ sbPos = order[0]; bbPos = order[1]; }
    else { sbPos = order[1]; bbPos = order[2]; }
    this._postBlind(sbPos, this.sb);
    this._postBlind(bbPos, this.bb);
    this.currentBet = this.bb;

    // deal two cards each, starting left of dealer
    for (let r=0;r<2;r++) for (const idx of order.slice(1).concat(order[0]))
      if (this.players[idx].inHand) this.players[idx].cards.push(this.deck.pop());

    this.actor = this._nextLiveNeedingCards(bbPos);
    this.message = `Hand #${this.handNum} — blinds ${this.sb}/${this.bb}`;
    // A blind may have put someone all-in; make sure action can still proceed.
    this._maybeAutoAdvance();
    return { ok:true };
  }

  _liveOrderFrom(start){
    const order = []; let i = start;
    for (let n=0;n<this.players.length;n++){ if (this.players[i].inHand) order.push(i); i=(i+1)%this.players.length; }
    return order;
  }
  _nextLiveNeedingCards(from){
    let i=(from+1)%this.players.length;
    for (let n=0;n<this.players.length;n++){ if (this.players[i].inHand) return i; i=(i+1)%this.players.length; }
    return from;
  }
  _postBlind(idx, amt){
    const p = this.players[idx];
    const put = Math.min(amt, p.stack);
    p.stack -= put; p.bet = put; p.totalBet = put;
    if (p.stack === 0) p.allIn = true;
  }
  get pot(){ return this.players.reduce((a,p)=>a+p.totalBet,0); }

  /* ---------- Turn logic ---------- */
  _needsToAct(p){ return p.inHand && !p.folded && !p.allIn && (!p.acted || p.bet < this.currentBet); }
  _nextActor(from){
    let i = from;
    for (let n=0;n<this.players.length;n++){ i=(i+1)%this.players.length; if (this._needsToAct(this.players[i])) return i; }
    return -1;
  }
  _bettingComplete(){
    const contenders = this.players.filter(p=>p.inHand && !p.folded);
    if (contenders.length <= 1) return true;
    return !this.players.some(p=>this._needsToAct(p));
  }
  contenders(){ return this.players.filter(p=>p.inHand && !p.folded); }

  // What the acting player is legally allowed to do right now.
  legalActions(id){
    const p = this.seatById(id);
    if (!p || !this.handLive || this.players[this.actor]?.id !== id) return null;
    const callAmount = Math.max(0, this.currentBet - p.bet);
    const canCheck = callAmount === 0;
    const maxRaiseTo = p.bet + p.stack;               // all-in ceiling (total street bet)
    const minRaiseTo = Math.min(this.currentBet + this.minRaise, maxRaiseTo);
    return {
      toAct: id,
      callAmount: Math.min(callAmount, p.stack),
      canCheck,
      canRaise: p.stack > callAmount && !p.acted,
      minRaiseTo, maxRaiseTo,
      isAllInCall: callAmount >= p.stack,
      bigBlind: this.bb,
      pot: this.pot,
    };
  }

  // Apply an action from a player. Returns {ok} or {ok:false,error}.
  act(id, action, amount){
    const p = this.seatById(id);
    if (!this.handLive) return { ok:false, error:'No hand in progress.' };
    if (!p || this.players[this.actor]?.id !== id) return { ok:false, error:'Not your turn.' };
    const callAmt = Math.max(0, this.currentBet - p.bet);

    if (action === 'fold'){ this._applyFold(p); }
    else if (action === 'check'){
      if (callAmt !== 0) return { ok:false, error:'Cannot check facing a bet.' };
      p.acted = true; p.lastAction = 'check';
    }
    else if (action === 'call'){
      if (callAmt === 0) { p.acted = true; p.lastAction = 'check'; } // treat as check
      else {
        const put = Math.min(callAmt, p.stack);
        p.stack -= put; p.bet += put; p.totalBet += put;
        if (p.stack === 0) p.allIn = true;
        p.acted = true; p.lastAction = p.allIn ? 'allin' : 'call';
      }
    }
    else if (action === 'bet' || action === 'raise'){
      if (p.stack <= callAmt) return { ok:false, error:'Not enough chips to raise.' };
      // A player who has already acted may only re-raise if a full raise reopened action.
      if (p.acted) return { ok:false, error:'You cannot raise — action was not reopened.' };
      const prevBet = this.currentBet;
      let target = Math.round(amount);
      if (!Number.isFinite(target)) return { ok:false, error:'Invalid amount.' };
      const maxTotal = p.bet + p.stack;
      target = Math.max(target, Math.min(this.currentBet + this.minRaise, maxTotal)); // enforce min-raise unless all-in
      target = Math.min(target, maxTotal);
      if (target <= prevBet) return { ok:false, error:'Raise must exceed the current bet.' };
      const put = target - p.bet;
      p.stack -= put; p.bet = target; p.totalBet += put;
      if (p.stack === 0) p.allIn = true;
      const raiseSize = p.bet - prevBet;
      const isFullRaise = raiseSize >= this.minRaise;
      if (isFullRaise){
        this.minRaise = raiseSize;
        for (const q of this.players) if (q!==p && q.inHand && !q.folded && !q.allIn) q.acted = false;
      }
      this.currentBet = Math.max(prevBet, p.bet);
      p.acted = true;
      p.lastAction = p.allIn ? 'allin' : (action === 'bet' ? 'bet' : 'raise');
    }
    else return { ok:false, error:'Unknown action.' };

    this._afterAction(p);
    return { ok:true };
  }

  _applyFold(p){ p.folded = true; p.acted = true; p.lastAction = 'fold'; }

  _afterAction(p){
    if (this.contenders().length <= 1) return this._awardUncontested();
    if (this._bettingComplete()) return this._advanceStreet();
    const nx = this._nextActor(this.players.indexOf(p));
    if (nx === -1) return this._advanceStreet();
    this.actor = nx;
    this._maybeAutoAdvance();
  }

  // If everyone still in is all-in (nobody can act), run the board out to showdown.
  _maybeAutoAdvance(){
    const canAct = this.players.filter(p=>p.inHand && !p.folded && !p.allIn);
    if (this.contenders().length >= 2 && canAct.length === 0){
      this._runOutAndShowdown();
    }
  }

  _advanceStreet(){
    for (const p of this.players){ p.bet = 0; p.acted = false; if (p.lastAction!=='fold') p.lastAction=''; }
    this.currentBet = 0; this.minRaise = this.bb;
    const canAct = this.players.filter(p=>p.inHand && !p.folded && !p.allIn);
    if (this.stage === 'preflop'){ this.stage='flop'; this._deal(3); }
    else if (this.stage === 'flop'){ this.stage='turn'; this._deal(1); }
    else if (this.stage === 'turn'){ this.stage='river'; this._deal(1); }
    else { return this._showdown(); }
    if (canAct.length <= 1){ return this._runOutAndShowdown(); }
    this.actor = this._firstToActPostflop();
  }

  _runOutAndShowdown(){
    // Deal any remaining board cards, then settle.
    while (this.board.length < 5){
      if (this.stage === 'preflop'){ this.stage='flop'; this._deal(3); }
      else if (this.stage === 'flop'){ this.stage='turn'; this._deal(1); }
      else if (this.stage === 'turn'){ this.stage='river'; this._deal(1); }
      else break;
    }
    this.stage = 'river';
    this._showdown();
  }

  _firstToActPostflop(){
    let i = this.dealer;
    for (let n=0;n<this.players.length;n++){ i=(i+1)%this.players.length; const p=this.players[i]; if (p.inHand && !p.folded && !p.allIn) return i; }
    return this._nextActor(this.dealer);
  }
  _deal(n){ this.deck.pop(); for (let i=0;i<n;i++) this.board.push(this.deck.pop()); }

  _clearBets(){ for (const p of this.players){ p.bet = 0; p.totalBet = 0; } }

  _awardUncontested(){
    const winner = this.contenders()[0];
    const amount = this.pot;
    if (winner) winner.stack += amount;
    this._clearBets();
    this.stage = 'showdown';
    this.handLive = false;
    this.lastResults = {
      pots: [{ amount, winners: winner ? [winner.id] : [], name: '' }],
      reveal: {}, // no cards shown when everyone folds
      payouts: winner ? { [winner.id]: amount } : {},
      message: winner ? `${winner.name} wins ${amount} — everyone folded` : '',
    };
    this.message = this.lastResults.message;
    this._markBusted();
  }

  _showdown(){
    const scores = {};
    const reveal = {};
    for (const p of this.contenders()){ scores[p.id] = bestHand(p.cards.concat(this.board)); reveal[p.id] = p.cards; }
    const pots = buildPots(this.players);
    const { payouts, refunds, results } = computePayouts(pots, scores, this.players, this.dealer);
    for (const id in payouts){ const pl = this.seatById(id); if (pl) pl.stack += payouts[id]; }
    for (const id in refunds){ const pl = this.seatById(id); if (pl) pl.stack += refunds[id]; }
    this._clearBets();
    this.stage = 'showdown';
    this.handLive = false;
    // Build human-readable results with hand names per winner group.
    this.lastResults = {
      pots: results,
      reveal,
      scoresName: Object.fromEntries(Object.keys(scores).map(id=>[id, handName(scores[id])])),
      payouts,
      message: 'Showdown',
    };
    this.message = 'Showdown';
    this._markBusted();
  }

  _markBusted(){ for (const p of this.players) if (p.stack <= 0) p.busted = true; }

  /* ---------- Redacted state for a specific viewer ---------- */
  resetGame(startingStack){
    const stack = startingStack || this.startingStack;
    for (const p of this.players){ p.stack = stack; p.busted = false; p.sittingOut = false; p.folded = true; p.inHand = false; p.cards = []; p.bet = 0; p.totalBet = 0; p.lastAction = ''; }
    this.stage = 'lobby'; this.handLive = false; this.board = []; this.lastResults = null; this.handNum = 0;
  }

  publicState(forId){
    const showdown = this.stage === 'showdown';
    const me = this.seatById(forId);
    let yourHandLabel = '';
    if (me && me.cards.length === 2 && this.board.length >= 3)
      yourHandLabel = handName(bestHand(me.cards.concat(this.board)));
    return {
      yourHandLabel,
      code: this.code,
      stage: this.stage,
      handNum: this.handNum,
      handLive: this.handLive,
      dealer: this.dealer,
      sb: this.sb, bb: this.bb,
      pot: this.pot,
      currentBet: this.currentBet,
      board: this.board,
      actor: this.handLive ? (this.players[this.actor]?.id ?? null) : null,
      message: this.message,
      results: this.lastResults,
      hostId: this.hostId,
      you: forId,
      legal: this.legalActions(forId), // null unless it's this viewer's turn
      canStart: !this.handLive && this.eligiblePlayers().length >= 2,
      players: this.players.map(p => {
        const revealCards = showdown && this.lastResults && this.lastResults.reveal[p.id];
        const showOwn = p.id === forId && p.cards.length;
        return {
          id: p.id, name: p.name, seat: p.seat, stack: p.stack, bet: p.bet,
          folded: p.folded, allIn: p.allIn, inHand: p.inHand, sittingOut: p.sittingOut,
          connected: p.connected, busted: p.busted, lastAction: p.lastAction,
          isDealer: p.seat === this.dealer,
          hasCards: p.cards.length > 0 && p.inHand && !p.folded,
          // cards only for yourself, or for everyone at showdown among contenders
          cards: showOwn ? p.cards : (revealCards ? p.cards : null),
        };
      }),
    };
  }
}

module.exports = {
  makeDeck, shuffle, cardKey, eval5, bestHand, cmpScore, handName,
  combos, buildPots, computePayouts, orderFromDealer, estimateEquity, RANKS, Table,
};
