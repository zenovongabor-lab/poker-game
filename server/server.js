/* =========================================================================
   Pocket Poker — online multiplayer server
   Serves the web client and runs real-time tables over WebSocket. The deck
   and every hole card live only here; each client receives a redacted view.
   ========================================================================= */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Table, estimateEquity } = require('./engine');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/* ---------- Static file server ---------- */
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml',
  '.png':'image/png', '.ico':'image/x-icon', '.webmanifest':'application/manifest+json' };

const server = http.createServer((req, res) => {
  if (req.url === '/healthz'){ res.writeHead(200); return res.end('ok'); }
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)){ res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err){ res.writeHead(404, {'Content-Type':'text/plain'}); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

/* ---------- Rooms ---------- */
const rooms = new Map(); // code -> Room
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars
function newCode(){
  let code;
  do { code = Array.from({length:4}, () => CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

const TURN_MS = 35000;        // human turn clock
const SHOWDOWN_MS = 6000;     // pause on results before next hand
const BOT_MIN_MS = 900, BOT_MAX_MS = 1900;
const EMPTY_ROOM_TTL = 15 * 60 * 1000;

class Room {
  constructor(code, opts){
    this.code = code;
    this.table = new Table({ smallBlind: opts.sb, startingStack: opts.stack });
    this.table.code = code;
    this.hostPid = null;
    this.sockets = new Map();   // pid -> ws (humans only)
    this.bots = new Set();      // pids that are bots
    this.names = new Map();     // pid -> name
    this.turnTimer = null;
    this.nextHandTimer = null;
    this.deleteTimer = null;
    this.actorDeadline = null;
  }
  broadcast(){
    const t = this.table;
    t.hostId = this.hostPid;
    for (const [pid, ws] of this.sockets){
      if (ws.readyState === ws.OPEN){
        const state = t.publicState(pid);
        state.actorDeadline = this.actorDeadline;
        state.isHost = pid === this.hostPid;
        state.bots = [...this.bots];
        send(ws, { t:'state', state });
      }
    }
  }
  connectedHumans(){ return [...this.sockets.values()].filter(ws => ws.readyState === ws.OPEN).length; }
  clearTimers(){ clearTimeout(this.turnTimer); clearTimeout(this.nextHandTimer); this.turnTimer=this.nextHandTimer=null; this.actorDeadline=null; }
}

function send(ws, obj){ try { ws.send(JSON.stringify(obj)); } catch {} }

/* ---------- Turn scheduling ---------- */
function scheduleActor(room){
  const t = room.table;
  clearTimeout(room.turnTimer); room.turnTimer = null; room.actorDeadline = null;
  if (!t.handLive){
    // hand over -> schedule next hand if possible
    scheduleNextHand(room);
    room.broadcast();
    return;
  }
  const actorId = t.players[t.actor]?.id;
  if (actorId == null){ room.broadcast(); return; }
  if (room.bots.has(actorId)){
    room.turnTimer = setTimeout(() => botAct(room, actorId), BOT_MIN_MS + Math.random()*(BOT_MAX_MS-BOT_MIN_MS));
    room.broadcast();
    return;
  }
  // human: start the turn clock
  room.actorDeadline = Date.now() + TURN_MS;
  room.turnTimer = setTimeout(() => {
    const la = t.legalActions(actorId);
    if (la){ t.act(actorId, la.canCheck ? 'check' : 'fold', 0); afterServerAction(room); }
  }, TURN_MS);
  room.broadcast();
}

function scheduleNextHand(room){
  clearTimeout(room.nextHandTimer);
  const t = room.table;
  if (t.eligiblePlayers().length >= 2){
    room.nextHandTimer = setTimeout(() => {
      const r = t.startHand();
      if (r.ok) scheduleActor(room); else room.broadcast();
    }, SHOWDOWN_MS);
  }
}

function afterServerAction(room){ scheduleActor(room); }

/* ---------- Bot policy ---------- */
function botAct(room, botId){
  const t = room.table;
  if (!t.handLive || t.players[t.actor]?.id !== botId) return;
  const p = t.seatById(botId);
  const la = t.legalActions(botId);
  if (!la){ return; }
  const numOpp = Math.max(1, t.contenders().length - 1);
  const samples = t.stage === 'preflop' ? 120 : 160;
  let eq = estimateEquity(p.cards, t.board, numOpp, samples) + (Math.random()-0.5)*0.06;
  const pot = t.pot, call = la.callAmount, potOdds = call > 0 ? call/(pot+call) : 0;
  const rnd = Math.random();
  let action = 'check', amount = 0;

  if (call === 0){
    if (la.canRaise && (eq > 0.62 || (rnd < 0.08 && eq > 0.30))){
      action = 'bet';
      const size = eq > 0.8 ? 0.9 : eq > 0.65 ? 0.6 : 0.45;
      amount = clampRaise(la, t.currentBet + Math.round(pot*size));
      if (amount <= t.currentBet) action = 'check';
    } else action = 'check';
  } else {
    if (eq > potOdds + 0.10){
      if (la.canRaise && (eq > 0.8 || (eq > 0.64 && rnd < 0.4))){
        action = 'raise';
        amount = clampRaise(la, t.currentBet + Math.max(t.minRaise, Math.round((pot+call)*0.6)));
        if (amount <= t.currentBet){ action = 'call'; }
      } else action = 'call';
    } else if (eq > potOdds - 0.03 && call <= p.stack*0.15){
      action = 'call';
    } else action = 'fold';
  }
  const res = t.act(botId, action, amount);
  if (!res.ok){ t.act(botId, la.canCheck ? 'check' : 'fold', 0); }
  afterServerAction(room);
}
function clampRaise(la, to){ return Math.max(la.minRaiseTo, Math.min(la.maxRaiseTo, to)); }

/* ---------- WebSocket handling ---------- */
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.pid = null; ws.room = null;
  ws.on('message', (buf) => {
    let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
    handle(ws, msg);
  });
  ws.on('close', () => onClose(ws));
});

function handle(ws, msg){
  const type = msg.t;
  if (type === 'create') return onCreate(ws, msg);
  if (type === 'join')   return onJoin(ws, msg);
  const room = ws.room && rooms.get(ws.room);
  if (!room) return send(ws, { t:'error', message:'You are not in a room.' });
  if (type === 'start')      return onStart(ws, room);
  if (type === 'action')     return onAction(ws, room, msg);
  if (type === 'addbot')     return onAddBot(ws, room);
  if (type === 'removebot')  return onRemoveBot(ws, room, msg);
  if (type === 'sitout')     return onSit(ws, room, true);
  if (type === 'sitin')      return onSit(ws, room, false);
  if (type === 'reset')      return onReset(ws, room);
  if (type === 'leave')      return onLeave(ws, room);
}

function sanitizeName(n){ return String(n||'Player').slice(0,16).replace(/[<>&"]/g,'').trim() || 'Player'; }

function onCreate(ws, msg){
  const sb = clampInt(msg.sb, 5, 500, 10);
  const stack = clampInt(msg.stack, 100, 100000, 1000);
  const code = newCode();
  const room = new Room(code, { sb, stack });
  rooms.set(code, room);
  bindPlayer(ws, room, msg.pid, sanitizeName(msg.name));
  room.hostPid = ws.pid;
  send(ws, { t:'joined', code, pid: ws.pid, host: true });
  room.broadcast();
}

function onJoin(ws, msg){
  const code = String(msg.code||'').toUpperCase().trim();
  const room = rooms.get(code);
  if (!room) return send(ws, { t:'error', message:'Room not found. Check the code.' });
  const existing = room.table.seatById(msg.pid);
  if (existing){
    // reconnect
    room.sockets.set(msg.pid, ws);
    ws.pid = msg.pid; ws.room = code;
    existing.connected = true;
    clearTimeout(room.deleteTimer); room.deleteTimer = null;
    send(ws, { t:'joined', code, pid: msg.pid, host: room.hostPid === msg.pid });
    room.broadcast();
    return;
  }
  if (room.table.players.length >= 9) return send(ws, { t:'error', message:'Table is full (9 seats).' });
  bindPlayer(ws, room, msg.pid, sanitizeName(msg.name));
  if (!room.hostPid) room.hostPid = ws.pid;
  send(ws, { t:'joined', code, pid: ws.pid, host: room.hostPid === ws.pid });
  room.broadcast();
}

function bindPlayer(ws, room, pid, name){
  pid = String(pid || '').slice(0,64) || ('p' + Math.random().toString(36).slice(2,10));
  ws.pid = pid; ws.room = room.code;
  room.sockets.set(pid, ws);
  room.names.set(pid, name);
  const p = room.table.addPlayer(pid, name);
  p.connected = true;
  // Players who join mid-hand sit out until the next hand starts.
  if (room.table.handLive){ p.sittingOut = false; p.inHand = false; p.folded = true; }
}

function onStart(ws, room){
  if (ws.pid !== room.hostPid) return send(ws, { t:'error', message:'Only the host can start.' });
  if (room.table.handLive) return;
  const r = room.table.startHand();
  if (!r.ok) return send(ws, { t:'error', message: r.error });
  scheduleActor(room);
}

function onAction(ws, room, msg){
  const r = room.table.act(ws.pid, msg.action, msg.amount);
  if (!r.ok) return send(ws, { t:'error', message: r.error });
  afterServerAction(room);
}

function onAddBot(ws, room){
  if (ws.pid !== room.hostPid) return send(ws, { t:'error', message:'Only the host can add bots.' });
  if (room.table.players.length >= 9) return send(ws, { t:'error', message:'Table is full.' });
  const names = ['Ada','Blake','Cleo','Dex','Iris','Nova','Rex','Vera'];
  const used = new Set([...room.names.values()]);
  const base = names.find(n => !used.has(n + ' 🤖')) || ('Bot' + (room.bots.size + 1));
  const name = base + ' 🤖';
  const bid = 'bot_' + Math.random().toString(36).slice(2,9);
  room.bots.add(bid); room.names.set(bid, name);
  const p = room.table.addPlayer(bid, name);
  if (room.table.handLive){ p.inHand = false; p.folded = true; }
  room.broadcast();
}
function onRemoveBot(ws, room, msg){
  if (ws.pid !== room.hostPid) return;
  const bid = msg.bid;
  if (room.bots.has(bid)){ room.bots.delete(bid); room.names.delete(bid); room.table.removePlayer(bid); room.broadcast(); }
}

function onSit(ws, room, out){
  const p = room.table.seatById(ws.pid);
  if (p){ p.sittingOut = out; room.broadcast(); }
}

function onReset(ws, room){
  if (ws.pid !== room.hostPid) return send(ws, { t:'error', message:'Only the host can start a new game.' });
  room.clearTimers();
  room.table.resetGame();
  room.broadcast();
}

function onLeave(ws, room){
  room.table.removePlayer(ws.pid);
  room.sockets.delete(ws.pid); room.names.delete(ws.pid);
  reassignHost(room);
  ws.room = null;
  maybeAdvanceAfterLeave(room);
}

function onClose(ws){
  const room = ws.room && rooms.get(ws.room);
  if (!room) return;
  const p = room.table.seatById(ws.pid);
  if (p) p.connected = false;
  room.sockets.delete(ws.pid);
  // If it was their turn, let the turn clock auto-act; otherwise just update.
  reassignHost(room);
  if (room.connectedHumans() === 0){
    // keep the room briefly for reconnects, then discard
    room.clearTimers();
    room.deleteTimer = setTimeout(() => rooms.delete(room.code), EMPTY_ROOM_TTL);
  } else {
    room.broadcast();
  }
}

function reassignHost(room){
  if (room.hostPid && (room.table.seatById(room.hostPid)) && room.sockets.has(room.hostPid)) return;
  // pick another connected human as host
  const next = [...room.sockets.keys()].find(pid => !room.bots.has(pid));
  room.hostPid = next || null;
}

function maybeAdvanceAfterLeave(room){
  const t = room.table;
  if (t.handLive && t.contenders().length <= 1){ afterServerAction(room); }
  else room.broadcast();
}

function clampInt(v, lo, hi, dflt){ v = parseInt(v,10); if (!Number.isFinite(v)) return dflt; return Math.max(lo, Math.min(hi, v)); }

server.listen(PORT, () => console.log(`Pocket Poker server on :${PORT}`));
