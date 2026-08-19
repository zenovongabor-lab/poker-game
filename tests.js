/* =========================================================================
   Pocket Poker — automated test suite
   Run with:  node tests.js
   Covers the ruleset's testing requirements: deck, dealing, hand evaluation
   (every category + special cases), betting (incl. short all-in reopening),
   side pots, odd-chip splits, and the card/chip invariants. Also validates
   the evaluator against the exact 5-card hand frequencies by full enumeration.
   ========================================================================= */
'use strict';

// --- Minimal DOM / timer stubs so the browser engine can load & run in Node ---
const stubEl = new Proxy(function(){}, {
  get(_t, prop){
    if (prop === 'classList') return { add(){}, remove(){}, contains(){ return false; } };
    if (prop === 'style') return {};
    if (prop === 'dataset') return {};
    if (prop === 'innerHTML' || prop === 'textContent' || prop === 'value') return '';
    return () => stubEl;
  },
  set(){ return true; },
  apply(){ return stubEl; },
});
global.document = {
  querySelector: () => stubEl, querySelectorAll: () => [],
  getElementById: () => stubEl, createElement: () => stubEl, addEventListener: () => {},
};
global.setTimeout = () => 0; // neutralize the engine's async turn scheduling

const P = require('./game.js');
const { makeDeck, shuffle, cardKey, eval5, bestHand, cmpScore, handName,
        buildPots, computePayouts, applyAction, needsToAct, bettingComplete, G } = P;

// --- tiny test harness ---
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond){ if (cond) pass++; else { fail++; fails.push(name); } }
function eq(name, a, b){ ok(name + ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b)); }

// card helper: C(rank, suit) with suit 0♠ 1♥ 2♦ 3♣
const C = (r, s) => ({ r, s });
const S = { s:0, h:1, d:2, c:3 };
// hand from shorthand like "As Kh" using suit letters
function h(str){ return str.trim().split(/\s+/).map(t => {
  const suit = S[t.slice(-1)];
  const rk = t.slice(0, -1);
  const r = rk === 'A' ? 14 : rk === 'K' ? 13 : rk === 'Q' ? 12 : rk === 'J' ? 11 : rk === 'T' ? 10 : +rk;
  return { r, s: suit };
}); }

/* ===================== 1. Deck ===================== */
(function deckTests(){
  const d = makeDeck();
  eq('deck has 52 cards', d.length, 52);
  const keys = new Set(d.map(cardKey));
  eq('deck cards all unique', keys.size, 52);
  const suitCounts = [0,0,0,0]; const rankCounts = {};
  for (const c of d){ suitCounts[c.s]++; rankCounts[c.r] = (rankCounts[c.r]||0)+1; }
  eq('4 suits of 13', suitCounts, [13,13,13,13]);
  ok('13 ranks x4', Object.keys(rankCounts).length === 13 && Object.values(rankCounts).every(n => n === 4));
  ok('ranks span 2..14', rankCounts[2] === 4 && rankCounts[14] === 4);
  // shuffle preserves the multiset
  const sh = shuffle(makeDeck());
  eq('shuffle keeps 52 unique', new Set(sh.map(cardKey)).size, 52);
})();

/* ===================== 2. Shuffle bias (light) ===================== */
(function shuffleBias(){
  // First card should be roughly uniform across 52 positions over many trials.
  const N = 52000, counts = new Array(52).fill(0);
  for (let i = 0; i < N; i++){ const d = shuffle(makeDeck()); counts[cardKey(d[0]) % 52]++; }
  const expected = N / 52;
  const maxDev = Math.max(...counts.map(c => Math.abs(c - expected) / expected));
  ok(`shuffle first-card roughly uniform (max dev ${(maxDev*100).toFixed(1)}%)`, maxDev < 0.20);
})();

/* ===================== 3+4. Hand evaluation & special cases ===================== */
(function evalTests(){
  const cat = cards => eval5(cards)[0];
  eq('royal flush category', cat(h('As Ks Qs Js Ts')), 8);
  ok('royal flush name', handName(bestHand(h('As Ks Qs Js Ts'))) === 'Royal Flush');
  eq('straight flush category', cat(h('9h 8h 7h 6h 5h')), 8);
  // wheel straight flush is 5-high, NOT ace-high
  eq('wheel straight-flush high = 5', bestHand(h('Ah 2h 3h 4h 5h'))[1], 5);
  eq('four of a kind', cat(h('Kd Ks Kh Kc 7d')), 7);
  eq('full house', cat(h('As Ah Ad 7c 7h')), 6);
  eq('flush', cat(h('Ad Td 7d 4d 2d')), 5);
  eq('plain straight', cat(h('9d 8s 7h 6c 5d')), 4);
  // wheel straight is 5-high
  eq('wheel straight high = 5', bestHand(h('Ah 2s 3d 4c 5h'))[1], 5);
  eq('three of a kind', cat(h('Qs Qh Qd 9c 2h')), 3);
  eq('two pair', cat(h('Js Jh 4d 4c 9h')), 2);
  eq('one pair', cat(h('Ts Th 8d 5c 2h')), 1);
  eq('high card', cat(h('As Jh 9d 5c 2h')), 0);

  // category ordering: each strictly beats the next
  const ladder = [
    h('As Ks Qs Js Ts'), h('9h 8h 7h 6h 5h'), h('Kd Ks Kh Kc 7d'),
    h('As Ah Ad 7c 7h'), h('Ad Td 7d 4d 2d'), h('9d 8s 7h 6c 5d'),
    h('Qs Qh Qd 9c 2h'), h('Js Jh 4d 4c 9h'), h('Ts Th 8d 5c 2h'), h('As Jh 9d 5c 2h'),
  ];
  let ordered = true;
  for (let i = 0; i + 1 < ladder.length; i++) if (cmpScore(eval5(ladder[i]), eval5(ladder[i+1])) <= 0) ordered = false;
  ok('category ladder strictly ordered', ordered);

  // tie-breaks
  ok('high-card kicker: AK9-7-3 > AK9-6-3', cmpScore(eval5(h('Ah Kd 9s 7c 3h')), eval5(h('As Kh 9d 6c 3s'))) > 0);
  ok('pair kicker decides', cmpScore(eval5(h('Ah As Kd Qc 9h')), eval5(h('Ad Ac Kh Qd 8s'))) > 0);
  ok('two pair kicker decides', cmpScore(eval5(h('Ah As Kd Kc 9h')), eval5(h('Ad Ac Kh Ks 8d'))) > 0);
  // full house: compare trips first — AAA22 beats KKKAA
  ok('full house trips dominate: AAA22 > KKKAA', cmpScore(eval5(h('Ah As Ad 2c 2h')), eval5(h('Kh Ks Kd Ac Ah'))) > 0);
  // quads: rank then kicker
  ok('quads kicker: 7777A > 7777K', cmpScore(eval5(h('7h 7s 7d 7c Ah')), eval5(h('7h 7s 7d 7c Kh'))) > 0);
  // flush compared high-to-low
  ok('flush high card decides', cmpScore(eval5(h('Ad Kd 7d 4d 2d')), eval5(h('Kh Qh 7h 4h 2h'))) > 0);
  // 6-high straight beats the wheel
  ok('6-5-4-3-2 beats A-2-3-4-5', cmpScore(eval5(h('6h 5s 4d 3c 2h')), eval5(h('Ah 2s 3d 4c 5h'))) > 0);
  // suits never break ties
  ok('identical hands of different suits tie', cmpScore(eval5(h('As Ks 7s 4s 2s')), eval5(h('Ah Kh 7h 4h 2h'))) === 0);
})();

/* ===================== 5. Best 5 of 7 ===================== */
(function bestOf7Tests(){
  // Board plays: everyone with this board has a royal; hole cards irrelevant.
  const board = h('As Ks Qs Js Ts');
  const a = bestHand(h('2h 3d').concat(board));
  const b = bestHand(h('7c 8c').concat(board));
  ok('board-play royal for both', a[0] === 8 && b[0] === 8 && cmpScore(a, b) === 0);
  // Uses zero hole cards when board is best
  eq('zero-hole-card best hand = board royal', bestHand(h('2h 7d').concat(board))[0], 8);
  // Uses exactly one hole card
  const oneHole = bestHand(h('Ac 2d').concat(h('Ah As Kd 7c 3s'))); // trip aces via one hole ace
  eq('one hole card -> trips', oneHole[0], 3);
  // Uses two hole cards
  const twoHole = bestHand(h('Ah Ad').concat(h('As Kd 7c 3s 2h'))); // trip aces using both? one board ace
  ok('two hole cards -> trip aces', twoHole[0] === 3 && twoHole[1] === 14);
  // best of 7 picks flush over lower made hands
  eq('best-of-7 finds flush', bestHand(h('Ad Kd').concat(h('7d 4d 2d 9s 9c')))[0], 5);
})();

/* ===================== 6. Side pots & distribution ===================== */
function setPlayers(list){ // list of {tot, folded, hand?}
  G.players = list.map((p, i) => ({ id: i, name: 'P'+i, stack: 0, bet: 0,
    totalBet: p.tot, folded: !!p.folded, allIn: false, out: false, acted: false,
    cards: p.hand || [] }));
  G.dealer = 0;
}
(function sidePotTests(){
  // Normal single pot, two contributors equal, P1 better hand wins all.
  setPlayers([{ tot: 100 }, { tot: 100 }]);
  let scores = { 0: eval5(h('Ah As Kd Qc 9h')), 1: eval5(h('Kh Ks Qd Jc 9s')) };
  let { payouts } = computePayouts(buildPots(), scores);
  eq('normal pot to best hand', payouts, { 0: 200 });

  // Two-way split (identical hands)
  setPlayers([{ tot: 100 }, { tot: 100 }]);
  scores = { 0: eval5(h('Ah As Kd Qc 9h')), 1: eval5(h('Ad Ac Kh Qd 9s')) };
  ({ payouts } = computePayouts(buildPots(), scores));
  eq('two-way split', payouts, { 0: 100, 1: 100 });

  // Folded player contributes but cannot win.
  setPlayers([{ tot: 50, folded: true }, { tot: 100 }, { tot: 100 }]);
  scores = { 1: eval5(h('Ah As Kd Qc 9h')), 2: eval5(h('Kh Ks Qd Jc 9s')) };
  ({ payouts } = computePayouts(buildPots(), scores));
  eq('folded contributor’s chips go to winner', payouts, { 1: 250 });

  // One side pot: A all-in 50 (best hand), B & C put 100. A wins main(150), best of B/C wins side(100).
  setPlayers([{ tot: 50 }, { tot: 100 }, { tot: 100 }]);
  scores = {
    0: eval5(h('Ah As Ad Qc 9h')), // trips aces (best overall)
    1: eval5(h('Kh Ks Qd Jc 9s')), // pair kings
    2: eval5(h('Qh Qs 7d 4c 2s')), // pair queens
  };
  ({ payouts } = computePayouts(buildPots(), scores));
  eq('main pot to all-in short stack', payouts[0], 150);
  eq('side pot to best non-all-in', payouts[1], 100);
  ok('C wins nothing', !payouts[2]);

  // Tied side pot but different main-pot winner:
  // A all-in 50 wins main; B and C tie the side pot.
  setPlayers([{ tot: 50 }, { tot: 100 }, { tot: 100 }]);
  scores = {
    0: eval5(h('Ah As Ad Kc 9h')), // trips aces -> wins main
    1: eval5(h('Kh Ks Qd Jc 9s')), // pair kings
    2: eval5(h('Kd Kc Qs Jh 9d')), // pair kings (ties B)
  };
  ({ payouts } = computePayouts(buildPots(), scores));
  eq('A wins main 150', payouts[0], 150);
  eq('B and C split side 100', [payouts[1], payouts[2]], [50, 50]);

  // Multiple side pots with three different all-in amounts.
  setPlayers([{ tot: 50 }, { tot: 100 }, { tot: 200 }]);
  scores = {
    0: eval5(h('Ah As Ad Kc 9h')),  // trips aces – wins everything eligible
    1: eval5(h('Kh Ks Qd Jc 9s')),
    2: eval5(h('Qh Qs 7d 4c 2s')),
  };
  const pots = buildPots();
  ({ payouts } = computePayouts(pots, scores));
  // main = 50*3=150 -> A; side1 = 50*2=100 (B,C) -> B; side2 = 100 uncalled,
  // sole contributor C -> returned to C by winning that single-contender pot.
  eq('three-level: A main', payouts[0], 150);
  eq('three-level: B side1', payouts[1], 100);
  eq('three-level: C keeps uncalled 100', payouts[2], 100);
  const total = Object.values(payouts).reduce((a,b)=>a+b,0);
  eq('three-level: chips conserved', total, 350);
})();

/* ===================== 7. Odd-chip allocation (§38) ===================== */
(function oddChipTests(){
  // Pot of 101 split between two tied winners -> extra chip to seat closest
  // clockwise from the dealer (dealer=0 -> seat 1 is small blind, gets it first).
  G.players = [0,1].map(i => ({ id: i, name:'P'+i, stack:0, bet:0, totalBet: 50 + (i===0?1:0),
    folded:false, allIn:false, out:false, acted:false, cards:[] }));
  // make contributions 51 and 50 so pot=101 but both eligible for full split:
  G.players[0].totalBet = 51; G.players[1].totalBet = 50;
  G.dealer = 0;
  const scores = { 0: eval5(h('Ah As Kd Qc 9h')), 1: eval5(h('Ad Ac Kh Qd 9s')) };
  const pots = buildPots(); // main 100 (both), plus 1 uncalled from P0
  const { payouts } = computePayouts(pots, scores);
  // main pot 100 splits 50/50; the extra uncalled 1 returns to P0 (sole top contributor)
  eq('even split + uncalled chip to over-contributor', [payouts[0], payouts[1]], [51, 50]);
  eq('odd-chip scenario conserves', payouts[0] + payouts[1], 101);

  // Genuine odd split: 3 equal contributors of 33 -> pot 99? use 100 via equal 100/3 style.
  G.players = [0,1,2].map(i => ({ id:i, name:'P'+i, stack:0, bet:0, totalBet: 100,
    folded:false, allIn:false, out:false, acted:false, cards:[] }));
  G.dealer = 0; // seat1 = SB gets first odd chip, then seat2
  const tie = { 0: eval5(h('Ah As Kd Qc 9h')), 1: eval5(h('Ad Ac Kh Qd 9s')), 2: eval5(h('Ac Ah Ks Qh 9d')) };
  const r = computePayouts(buildPots(), tie).payouts; // pot 300 / 3 = 100 exactly, no remainder
  eq('three-way even split of 300', [r[0], r[1], r[2]], [100,100,100]);

  // remainder case: pot 302, 3 tied -> 101,101,100 with extras to seats 1,2 first
  G.players.forEach(p => p.totalBet = 0);
  G.players[0].totalBet = 100; G.players[1].totalBet = 101; G.players[2].totalBet = 101;
  G.dealer = 0;
  const r2 = computePayouts(buildPots(), tie); // main 300 split + uncalled handling
  const totalPaid = Object.values(r2.payouts).reduce((a,b)=>a+b,0) + Object.values(r2.refunds).reduce((a,b)=>a+b,0);
  eq('odd-split conserves chips', totalPaid, 302);

  // Genuine indivisible split: folded P0 adds 1 chip so the main pot (3) splits
  // between tied P1 & P2 as 2/1 — the extra chip must go to the seat closest
  // clockwise from the dealer, and follow the button when it moves.
  const mk = (dealer) => {
    G.players = [{tot:1,folded:true},{tot:2},{tot:2}].map((p,i)=>({id:i,name:'P'+i,stack:0,bet:0,totalBet:p.tot,folded:!!p.folded,allIn:false,out:false,acted:false,cards:[]}));
    G.dealer = dealer;
    const tScore = { 1: eval5(h('Ah As Kd Qc 9h')), 2: eval5(h('Ad Ac Kh Qd 9s')) };
    return computePayouts(buildPots(), tScore).payouts;
  };
  const dA = mk(0); // dealer seat0 -> SB is seat1 (P1) -> P1 gets the odd chip
  ok('odd chip to SB (P1) when dealer=0', dA[1] === 3 && dA[2] === 2);
  const dB = mk(1); // dealer seat1 -> SB is seat2 (P2) -> P2 gets the odd chip
  ok('odd chip follows button to P2 when dealer=1', dB[1] === 2 && dB[2] === 3);
})();

/* ===================== 8. Betting engine & short all-in (§16) ===================== */
function betState(players, opts = {}){
  G.mode = 'ai'; G.bb = opts.bb || 20; G.sb = (opts.bb||20)/2;
  G.stage = opts.stage || 'flop'; G.handLive = true; G.busy = false;
  G.pot = opts.pot || 0; G.board = opts.board || [];
  G.currentBet = opts.currentBet || 0; G.minRaise = opts.minRaise || G.bb;
  G.dealer = 0; G.actor = opts.actor != null ? opts.actor : 0;
  G.players = players.map((p, i) => ({ id:i, name:'P'+i, isHuman:false,
    stack: p.stack, bet: p.bet||0, totalBet: p.totalBet||p.bet||0,
    folded:!!p.folded, allIn:!!p.allIn, out:false, acted:!!p.acted, cards:[], lastAction:'' }));
}
(function bettingTests(){
  // check when nothing owed
  betState([{ stack:1000 },{ stack:1000 }], { currentBet:0, actor:0 });
  applyAction(0, 'check', 0);
  ok('check keeps stack', G.players[0].stack === 1000 && G.players[0].acted);

  // opening bet sets current bet; min post-flop bet is a big blind
  betState([{ stack:1000 },{ stack:1000 }], { currentBet:0, pot:40, actor:0, bb:20 });
  applyAction(0, 'bet', 20);
  ok('opening bet moves chips', G.players[0].stack === 980 && G.currentBet === 20 && G.pot === 60);

  // call matches the bet
  betState([{ stack:980, bet:20 },{ stack:1000 }], { currentBet:20, pot:60, actor:1 });
  applyAction(1, 'call', 0);
  ok('call matches', G.players[1].stack === 980 && G.players[1].bet === 20 && G.pot === 80);

  // full raise reopens action (already-acted opponent gets to act again)
  betState([{ stack:900, bet:100, acted:true },{ stack:1000 }], { currentBet:100, minRaise:100, pot:200, actor:1 });
  applyAction(1, 'raise', 200); // raise by 100 == min -> full raise
  ok('full raise updates currentBet', G.currentBet === 200 && G.minRaise === 100);
  ok('full raise reopens for P0', G.players[0].acted === false);

  // SHORT all-in does NOT reopen for a player who already acted
  betState([{ stack:1000, bet:0, acted:true },   // P0 already acted (called earlier)
            { stack:120, bet:100 },              // P1 will jam all-in for 120 (short)
            { stack:1000, bet:0, acted:false }],  // P2 has not acted yet
           { currentBet:100, minRaise:100, pot:300, actor:1 });
  applyAction(1, 'raise', 220); // total 120+? -> capped at stack: bet becomes 220? clamp
  // P1 only had 120 stack on top of bet 100 -> max total 220; raise increment = 220-100 = 120 >= 100 => actually full!
  // Re-do with a genuinely short jam:
  betState([{ stack:1000, bet:0, acted:true },
            { stack:20, bet:100 },               // can only add 20 -> total 120, increment 20 (< 100) short
            { stack:1000, bet:0, acted:false }],
           { currentBet:100, minRaise:100, pot:300, actor:1 });
  applyAction(1, 'raise', 120);
  ok('short all-in sets currentBet to jam', G.currentBet === 120);
  ok('short all-in does NOT raise the min-raise', G.minRaise === 100);
  ok('short all-in: P1 is all-in', G.players[1].allIn === true);
  ok('short all-in does NOT reopen for already-acted P0', G.players[0].acted === true);
  ok('short all-in leaves not-yet-acted P2 free to act', G.players[2].acted === false);
  // P0 still owes the extra (must be given call/fold), because bet<currentBet
  ok('already-acted P0 still must respond to jam', needsToAct(G.players[0]));

  // fold removes from contention
  betState([{ stack:1000, bet:20 },{ stack:1000, bet:100 }], { currentBet:100, actor:0 });
  applyAction(0, 'fold', 0);
  ok('fold marks folded', G.players[0].folded === true);

  // all-in call for less than owed
  betState([{ stack:30, bet:0 },{ stack:1000, bet:100 }], { currentBet:100, pot:100, actor:0 });
  applyAction(0, 'call', 0);
  ok('all-in call caps at stack', G.players[0].stack === 0 && G.players[0].allIn && G.players[0].bet === 30);
})();

/* ===================== 9. Invariants ===================== */
(function invariantTests(){
  // Card invariant on a freshly built + partially dealt scenario.
  const deck = shuffle(makeDeck());
  const hole = [deck.pop(), deck.pop(), deck.pop(), deck.pop()];
  const burns = [deck.pop()];
  const board = [deck.pop(), deck.pop(), deck.pop()];
  const allSeen = new Set([...deck, ...hole, ...burns, ...board].map(cardKey));
  eq('card invariant: deck+hole+burn+board = 52 unique', allSeen.size, 52);
  eq('card counts sum to 52', deck.length + hole.length + burns.length + board.length, 52);

  // Chip conservation across a full random settlement.
  let leaks = 0;
  for (let t = 0; t < 5000; t++){
    const n = 2 + (Math.floor(Math.random()*4));
    const list = []; let totalIn = 0;
    for (let i = 0; i < n; i++){ const tot = Math.floor(Math.random()*6)*10; list.push({ tot, folded: Math.random()<0.4 }); totalIn += tot; }
    if (list.filter(p => !p.folded).length < 1) continue;
    setPlayers(list);
    const scores = {};
    for (const p of G.players) if (!p.folded) scores[p.id] = [Math.floor(Math.random()*9)];
    const { payouts, refunds } = computePayouts(buildPots(), scores);
    const paid = Object.values(payouts).reduce((a,b)=>a+b,0) + Object.values(refunds).reduce((a,b)=>a+b,0);
    if (paid !== totalIn) leaks++;
  }
  eq('chip invariant across 5000 random settlements', leaks, 0);
})();

/* ===================== 10. Exact 5-card frequencies (§72) ===================== */
(function frequencyTests(){
  // Full enumeration of C(52,5) = 2,598,960 hands, categorized by the evaluator.
  // Must match the known combinatorial counts exactly.
  const deck = makeDeck();
  const counts = new Array(9).fill(0); // by category 0..8
  let straightFlush = 0, royal = 0;
  const a = deck;
  for (let i=0;i<48;i++) for (let j=i+1;j<49;j++) for (let k=j+1;k<50;k++)
    for (let l=k+1;l<51;l++) for (let m=l+1;m<52;m++){
      const sc = eval5([a[i],a[j],a[k],a[l],a[m]]);
      counts[sc[0]]++;
      if (sc[0] === 8){ straightFlush++; if (sc[1] === 14) royal++; }
    }
  eq('High Card count', counts[0], 1302540);
  eq('One Pair count', counts[1], 1098240);
  eq('Two Pair count', counts[2], 123552);
  eq('Three of a Kind count', counts[3], 54912);
  eq('Straight (excl SF) count', counts[4], 10200);
  eq('Flush (excl SF) count', counts[5], 5108);
  eq('Full House count', counts[6], 3744);
  eq('Four of a Kind count', counts[7], 624);
  eq('Straight Flush (incl royal) count', straightFlush, 40);
  eq('Royal Flush count', royal, 4);
  const total = counts.reduce((x,y)=>x+y,0);
  eq('all categories sum to C(52,5)', total, 2598960);
})();

/* ===================== results ===================== */
console.log(`\n${pass} passed, ${fail} failed`);
if (fail){ console.log('FAILURES:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('All tests passed ✔');
