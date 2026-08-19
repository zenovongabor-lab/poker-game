/* =========================================================================
   Pocket Poker — online client (WebSocket). Server is authoritative; this
   file only renders redacted state and sends actions.
   ========================================================================= */
'use strict';

const SUITS = ['♠','♥','♦','♣'];
const SUIT_RED = [false,true,true,false];
const RANKS = { 2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A' };
const $ = s => document.querySelector(s);

/* ---------- identity + persistence ---------- */
const store = {
  get pid(){ let v = localStorage.getItem('pp_pid'); if (!v){ v = 'p_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)+Date.now().toString(36)); localStorage.setItem('pp_pid', v); } return v; },
  get name(){ return localStorage.getItem('pp_name') || ''; },
  set name(v){ localStorage.setItem('pp_name', v); },
  get room(){ return sessionStorage.getItem('pp_room') || ''; },
  set room(v){ v ? sessionStorage.setItem('pp_room', v) : sessionStorage.removeItem('pp_room'); },
};

let ws = null, wsReady = false, lastState = null, timerRAF = null;
const cfg = { blind: 10, stack: 1000 };

/* ---------- connection ---------- */
function connect(){
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => {
    wsReady = true; banner(false);
    // auto-rejoin if we were in a room
    if (store.room) sendRaw({ t:'join', code: store.room, pid: store.pid, name: store.name || 'Player' });
  };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
  ws.onclose = () => { wsReady = false; banner(true); setTimeout(connect, 1200); };
  ws.onerror = () => { try { ws.close(); } catch {} };
}
function sendRaw(o){ if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); }
function send(o){ sendRaw(Object.assign({ pid: store.pid }, o)); }
function banner(show){ $('#conn').classList.toggle('show', show); }

function onMessage(m){
  if (m.t === 'joined'){ store.room = m.code; return; }
  if (m.t === 'error'){ return toast(m.message); }
  if (m.t === 'state'){ lastState = m.state; render(m.state); }
}

/* ---------- home ---------- */
function initHome(){
  $('#nameInput').value = store.name;
  $('#nameInput').addEventListener('input', e => store.name = e.target.value);
  wireSeg('blindSeg', 'blind');
  wireSeg('stackSeg', 'stack');
  $('#createBtn').onclick = () => {
    const name = requireName(); if (!name) return;
    send({ t:'create', name, sb: cfg.blind, stack: cfg.stack });
  };
  $('#joinBtn').onclick = () => {
    const name = requireName(); if (!name) return;
    const code = $('#joinCode').value.trim().toUpperCase();
    if (code.length < 4) return toast('Enter the 4-letter table code.');
    send({ t:'join', code, name });
  };
  $('#joinCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''); });
  $('#offlineBtn').onclick = () => location.href = 'offline.html';
  $('#menuBtn').onclick = openMenu;
  // deep-link ?room=CODE
  const q = new URLSearchParams(location.search).get('room');
  if (q) $('#joinCode').value = q.toUpperCase().slice(0,4);
}
function requireName(){
  const n = $('#nameInput').value.trim();
  if (!n){ toast('Enter your name first.'); $('#nameInput').focus(); return ''; }
  store.name = n; return n;
}
function wireSeg(id, key){
  const seg = document.getElementById(id);
  seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    seg.querySelectorAll('button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    cfg[key] = Number(b.dataset[Object.keys(b.dataset)[0]]);
  });
}

/* ---------- screen routing ---------- */
function show(id){ document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); $('#'+id).classList.add('active'); }

function render(st){
  if (st.stage === 'lobby'){ renderLobby(st); show('lobby'); }
  else { renderTable(st); show('table'); }
}

/* ---------- lobby ---------- */
function renderLobby(st){
  $('#lobbyCode').textContent = st.code || store.room || '----';
  $('#lobbyBlinds').textContent = `Blinds ${st.sb}/${st.bb} · ${st.players.length} at the table`;
  const list = $('#lobbyPlayers'); list.innerHTML = '';
  for (const p of st.players){
    const row = document.createElement('div');
    row.className = 'prow' + (p.connected ? '' : ' off');
    const tags = [];
    if (p.id === st.hostId) tags.push('<span class="ptag">HOST</span>');
    if ((st.bots||[]).includes(p.id)) tags.push('<span class="ptag">BOT</span>');
    if (!p.connected) tags.push('<span class="ptag">away</span>');
    const kick = (st.isHost && (st.bots||[]).includes(p.id)) ? `<button class="kick" data-bid="${p.id}">✕</button>` : '';
    row.innerHTML = `<div class="pav">${initial(p.name)}</div>
      <div class="pname">${escapeHtml(p.name)}</div>${tags.join('')}
      <div class="pstack">${p.stack.toLocaleString()}</div>${kick}`;
    list.appendChild(row);
  }
  list.querySelectorAll('.kick').forEach(b => b.onclick = () => send({ t:'removebot', bid: b.dataset.bid }));

  const actions = $('#lobbyActions'); actions.innerHTML = '';
  if (st.isHost){
    const canStart = st.players.filter(p => p.stack > 0 && !p.sittingOut).length >= 2;
    const start = mkBtn('btn-primary big', canStart ? 'Deal In' : 'Need 2+ players', () => send({ t:'start' }));
    start.disabled = !canStart;
    actions.appendChild(start);
    const row = document.createElement('div'); row.className = 'row2';
    row.appendChild(mkBtn('btn-ghost', '+ Add bot', () => send({ t:'addbot' })));
    row.appendChild(mkBtn('btn-ghost', 'Copy link', copyLink));
    actions.appendChild(row);
    $('#lobbyNote').textContent = 'Share the code, add bots to fill seats, then Deal In.';
  } else {
    actions.appendChild(mkBtn('btn-ghost', 'Leave table', leaveRoom));
    $('#lobbyNote').textContent = 'Waiting for the host to deal…';
  }
  $('#copyBtn').onclick = copyLink;
}
function mkBtn(cls, label, on){ const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = on; return b; }
function initial(n){ return (n||'?').trim().charAt(0).toUpperCase() || '?'; }

function copyLink(){
  const url = `${location.origin}/?room=${lastState?.code || store.room}`;
  const done = () => toast('Invite link copied!');
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('Copy this link:', url));
  else prompt('Copy this link:', url);
}
function leaveRoom(){ send({ t:'leave' }); store.room = ''; lastState = null; show('home'); }

/* ---------- table ---------- */
function cardHTML(card, small, faceDown){
  if (faceDown || !card) return `<div class="card${small?' sm':''} back"></div>`;
  const red = SUIT_RED[card.s];
  const r = RANKS[card.r], s = SUITS[card.s];
  return `<div class="card${small?' sm':''} ${red?'red':'black'} deal-in"><span class="rank">${r}</span><span class="suit">${s}</span><span class="rank-br">${r}</span></div>`;
}
function emptyCard(small){ return `<div class="card${small?' sm':''} empty"></div>`; }

function renderTable(st){
  $('#potAmount').textContent = (st.pot||0).toLocaleString();
  const names = { preflop:'Pre-Flop', flop:'Flop', turn:'Turn', river:'River', showdown:'Showdown' };
  $('#stageBadge').textContent = names[st.stage] || '—';

  const board = $('#board'); board.innerHTML = '';
  for (let i=0;i<5;i++) board.insertAdjacentHTML('beforeend', st.board[i] ? cardHTML(st.board[i],false,false) : emptyCard(false));

  const winners = new Set();
  if (st.results && st.results.payouts) for (const id in st.results.payouts) winners.add(id);

  const seats = $('#seats'); seats.innerHTML = '';
  for (const p of st.players){
    const seat = document.createElement('div');
    seat.className = 'seat'
      + (p.id === st.actor ? ' active' : '')
      + (p.folded && st.stage!=='showdown' ? ' folded' : '')
      + (p.id === st.you ? ' you-seat' : '')
      + (winners.has(p.id) ? ' winner' : '')
      + (!p.connected ? ' disc' : '');
    let cards = '';
    if (p.hasCards || (p.cards && p.cards.length)){
      const cs = (p.cards && p.cards.length) ? p.cards.map(c => cardHTML(c,true,false)).join('')
                                             : `${cardHTML(null,true,true)}${cardHTML(null,true,true)}`;
      cards = `<div class="seat-cards">${cs}</div>`;
    }
    const badge = p.isDealer ? '<span class="seat-badge">D</span>' : '';
    const nm = escapeHtml(p.name) + (p.busted ? ' 💀' : (!p.connected ? ' 📴' : ''));
    seat.innerHTML = `${badge}<div class="seat-name">${nm}</div>${cards}
      <div class="seat-stack">${p.stack.toLocaleString()}</div>
      <div class="seat-bet">${p.bet>0?'bet '+p.bet:''}</div>`;
    if (p.lastAction && st.stage!=='showdown'){
      const a = document.createElement('div'); a.className = 'seat-action '+p.lastAction; a.textContent = p.lastAction.toUpperCase(); seat.appendChild(a);
    }
    if (p.id === st.actor && st.actorDeadline){
      const bar = document.createElement('div'); bar.className='timer'; bar.innerHTML='<i></i>'; seat.appendChild(bar);
    }
    seats.appendChild(seat);
  }
  $('#tableMsg').textContent = st.message || '';

  renderYou(st);
  renderControls(st);
  startTimerAnim(st);

  if (st.stage === 'showdown' && st.results) showResults(st); else closeModal();
  // game over?
  const withChips = st.players.filter(p => p.stack > 0);
  if (st.stage === 'showdown' && !st.handLive && withChips.length < 2) showGameOver(st);
}

function renderYou(st){
  const me = st.players.find(p => p.id === st.you);
  const y = $('#youSeat');
  if (!me){ y.innerHTML=''; return; }
  const cards = (me.cards && me.cards.length) ? me.cards.map(c => cardHTML(c,false,false)).join('')
    : `${cardHTML(null,false,true)}${cardHTML(null,false,true)}`;
  y.innerHTML = `<div class="you-info"><div class="you-name">${escapeHtml(me.name)}</div>
      <div class="you-stack">${me.stack.toLocaleString()}</div></div>
    <div style="text-align:center"><div class="you-cards">${cards}</div>
      <div class="you-hand-label">${escapeHtml(st.yourHandLabel||'')}</div></div>`;
}

function renderControls(st){
  const c = $('#controls'); c.innerHTML = '';
  const legal = st.legal;
  if (!st.handLive){ c.innerHTML = '<div class="note">Next hand starting…</div>'; return; }
  if (!legal){
    const actorName = st.players.find(p => p.id === st.actor)?.name || 'someone';
    c.innerHTML = `<div class="note">Waiting for <b>${escapeHtml(actorName)}</b>…</div>`;
    return;
  }
  // it's your turn
  const callAmt = legal.callAmount;
  const canCheck = legal.canCheck;

  if (legal.canRaise){
    const betRow = document.createElement('div'); betRow.className = 'bet-row';
    const slider = document.createElement('input'); slider.type = 'range';
    slider.min = legal.minRaiseTo; slider.max = legal.maxRaiseTo;
    slider.step = Math.max(1, Math.round(st.bb/2));
    slider.value = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(st.pot*0.5)+st.currentBet));
    const amt = document.createElement('div'); amt.className='bet-amt'; amt.textContent = (+slider.value).toLocaleString();
    slider.oninput = () => amt.textContent = (+slider.value).toLocaleString();
    betRow.appendChild(slider); betRow.appendChild(amt); c.appendChild(betRow);

    const presets = document.createElement('div'); presets.className='raise-presets';
    const set = v => { const x = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, v)); slider.value = x; amt.textContent = (+x).toLocaleString(); };
    presets.appendChild(mkBtn('', '½ Pot', () => set(st.currentBet + Math.round((st.pot+callAmt)*0.5))));
    presets.appendChild(mkBtn('', 'Pot', () => set(st.currentBet + (st.pot+callAmt))));
    presets.appendChild(mkBtn('', 'All In', () => set(legal.maxRaiseTo)));
    c.appendChild(presets);
  }

  const row = document.createElement('div'); row.className = 'action-row';
  row.appendChild(mkBtn('abtn fold', 'Fold', () => act('fold')));
  if (canCheck) row.appendChild(mkBtn('abtn check', 'Check', () => act('check')));
  else row.appendChild(mkBtn('abtn call', `Call ${callAmt.toLocaleString()}`, () => act('call')));
  if (legal.canRaise){
    row.appendChild(mkBtn('abtn raise', canCheck ? 'Bet' : 'Raise', () => {
      const slider = c.querySelector('input[type=range]');
      act(canCheck ? 'bet' : 'raise', +slider.value);
    }));
  }
  c.appendChild(row);
}
function act(action, amount){ send({ t:'action', action, amount: amount||0 }); }

/* ---------- turn timer animation ---------- */
function startTimerAnim(st){
  cancelAnimationFrame(timerRAF);
  if (!st.actorDeadline) return;
  const bar = $('#seats .seat.active .timer > i');
  if (!bar) return;
  const total = 35000;
  const tick = () => {
    const remain = st.actorDeadline - Date.now();
    const frac = Math.max(0, Math.min(1, remain/total));
    bar.style.transform = `scaleX(${frac})`;
    bar.style.background = frac < 0.3 ? '#e0574a' : 'var(--gold)';
    if (remain > 0) timerRAF = requestAnimationFrame(tick);
  };
  tick();
}

/* ---------- results / showdown ---------- */
function showResults(st){
  const r = st.results;
  let html = '';
  if (r.reveal && Object.keys(r.reveal).length){
    html += '<h2>Showdown</h2>';
    const shown = st.players.filter(p => r.reveal[p.id]);
    for (const p of shown){
      const won = (r.payouts && r.payouts[p.id]) || 0;
      const hn = (r.scoresName && r.scoresName[p.id]) || '';
      html += `<div class="result-line ${won?'win':''}">
        <div><div>${escapeHtml(p.name)} ${won?'<span class="win-badge">+'+won+'</span>':''}</div>
        <div class="showdown-hand">${(r.reveal[p.id]||[]).map(c=>cardHTML(c,true,false)).join('')}</div>
        <div class="muted">${escapeHtml(hn)}</div></div></div>`;
    }
  } else {
    html += `<h2>Hand over</h2><p class="muted">${escapeHtml(r.message||'')}</p>`;
  }
  html += `<div class="countdown" id="cdown"></div>`;
  showModal(html);
}

function showGameOver(st){
  const winner = st.players.reduce((a,b) => (b.stack > (a?a.stack:-1) ? b : a), null);
  let html = `<h2>Game Over</h2><p class="muted">${escapeHtml(winner?winner.name:'Someone')} wins the table with ${winner?winner.stack.toLocaleString():0} chips.</p>`;
  html += '<div class="modal-actions">';
  if (st.isHost) html += '<button class="btn-primary" id="againBtn">New Game</button>';
  html += '<button class="btn-ghost" id="leaveBtn2">Leave</button></div>';
  showModal(html);
  const again = $('#againBtn'); if (again) again.onclick = () => { closeModal(); send({ t:'reset' }); };
  $('#leaveBtn2').onclick = leaveRoom;
}

/* ---------- menu ---------- */
function openMenu(){
  const st = lastState || {};
  let html = `<h2>Menu</h2>
    <div class="result-line"><span>Table</span><span>${st.code||store.room||'-'}</span></div>
    <div class="result-line"><span>Blinds</span><span>${st.sb||''}/${st.bb||''}</span></div>
    <div class="modal-actions"><button class="btn-ghost" id="resumeBtn">Resume</button>`;
  html += `<button class="abtn fold" id="leaveBtn">Leave table</button></div>`;
  showModal(html);
  $('#resumeBtn').onclick = closeModal;
  $('#leaveBtn').onclick = leaveRoom;
}

/* ---------- modal + toast ---------- */
function showModal(html){ $('#modalBody').innerHTML = html; $('#modal').classList.add('show'); }
function closeModal(){ if ($('#modal').classList.contains('show') && !$('#modalBody').querySelector('#againBtn')) { $('#modal').classList.remove('show'); $('#modalBody').innerHTML=''; } }
let toastTimer = null;
function toast(msg){
  const b = $('#conn'); b.textContent = msg; b.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (!wsReady){ b.textContent='Reconnecting…'; } else b.classList.remove('show'); }, 2600);
}
function escapeHtml(s){ return String(s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

document.addEventListener('DOMContentLoaded', () => { initHome(); connect(); });
