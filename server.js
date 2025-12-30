const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { WebSocketServer } = WebSocket;

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;
const TICK_RATE = 30;
const SNAPSHOT_RATE = 20;
const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 600;
const MAX_SPEED = 220; // units per second
const MAX_FIRE_RATE_MS = 250; // 4 shots/sec
const RESPAWN_DELAY = 2500;
const VERSION = 1;

let nextPlayerId = 1;
const players = new Map();

function serveStatic(req, res) {
  let filePath = req.url.split('?')[0];
  if (filePath === '/') {
    filePath = '/index.html';
  }
  const resolvedPath = path.join(PUBLIC_DIR, path.normalize(filePath).replace(/^\/+/, ''));
  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(resolvedPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(resolvedPath).toLowerCase();
    const mime = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.png': 'image/png',
      '.json': 'application/json'
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server });

function clampMovement(input) {
  let { moveX, moveY } = input;
  if (!isFinite(moveX) || !isFinite(moveY)) {
    moveX = 0;
    moveY = 0;
  }
  const length = Math.hypot(moveX, moveY);
  if (length > 1e-6) {
    moveX /= length;
    moveY /= length;
  }
  return { moveX, moveY };
}

function createPlayer(id, nickname, characterId) {
  const spawn = randomSpawn();
  return {
    id,
    nickname: nickname || `Player${id}`,
    characterId: Number.isInteger(characterId) ? Math.max(0, Math.min(3, characterId)) : 0,
    x: spawn.x,
    y: spawn.y,
    aimAngle: 0,
    hp: 100,
    alive: true,
    kills: 0,
    deaths: 0,
    lastInputSeq: 0,
    input: { moveX: 0, moveY: 0, aimAngle: 0, shoot: false },
    lastShot: 0,
    respawnTimeout: null,
    socket: null
  };
}

function randomSpawn() {
  return {
    x: 50 + Math.random() * (WORLD_WIDTH - 100),
    y: 50 + Math.random() * (WORLD_HEIGHT - 100)
  };
}

function handleJoin(ws, msg) {
  if (ws.playerId) return;
  const nickname = typeof msg.nickname === 'string' ? msg.nickname.trim().slice(0, 16) : 'Player';
  const characterId = Number(msg.characterId) || 0;
  const playerId = nextPlayerId++;
  const player = createPlayer(playerId, nickname || 'Player', characterId);
  player.socket = ws;
  players.set(playerId, player);
  ws.playerId = playerId;
  send(ws, { v: VERSION, type: 'welcome', playerId, serverTime: Date.now() });
}

function handleInput(ws, msg) {
  const player = players.get(ws.playerId);
  if (!player || !player.alive) return;
  const dt = Number(msg.dt);
  if (!isFinite(dt) || dt < 0 || dt > 0.1) return;
  if (!Number.isFinite(msg.aimAngle)) return;
  const { moveX, moveY } = clampMovement(msg);
  player.input = {
    moveX,
    moveY,
    aimAngle: Number(msg.aimAngle) || 0,
    shoot: !!msg.shoot
  };
  player.lastInputSeq = msg.seq || 0;
}

function handlePing(ws, msg) {
  send(ws, { v: VERSION, type: 'pong', clientTime: msg.clientTime, serverTime: Date.now() });
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(payload) {
  const data = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function update(dt) {
  const now = Date.now();
  players.forEach((player) => {
    if (!player.alive) return;
    const dx = player.input.moveX * MAX_SPEED * dt;
    const dy = player.input.moveY * MAX_SPEED * dt;
    player.x = Math.max(0, Math.min(WORLD_WIDTH, player.x + dx));
    player.y = Math.max(0, Math.min(WORLD_HEIGHT, player.y + dy));
    player.aimAngle = player.input.aimAngle;
    if (player.input.shoot) {
      tryShoot(player, now);
    }
  });
}

function tryShoot(player, now) {
  if (now - player.lastShot < MAX_FIRE_RATE_MS) return;
  player.lastShot = now;
  const hit = hitscan(player);
  if (hit) {
    applyDamage(player, hit, 25);
  }
}

function hitscan(shooter) {
  const dir = { x: Math.cos(shooter.input.aimAngle), y: Math.sin(shooter.input.aimAngle) };
  let closest = null;
  let closestDist = Infinity;
  players.forEach((target) => {
    if (target.id === shooter.id || !target.alive) return;
    const toTarget = { x: target.x - shooter.x, y: target.y - shooter.y };
    const dist = Math.hypot(toTarget.x, toTarget.y);
    if (dist > 900) return;
    const forward = toTarget.x * dir.x + toTarget.y * dir.y;
    if (forward <= 0) return;
    const perp = Math.abs(toTarget.x * dir.y - toTarget.y * dir.x);
    if (perp <= 30 && dist < closestDist) {
      closest = target;
      closestDist = dist;
    }
  });
  return closest;
}

function applyDamage(attacker, target, amount) {
  target.hp -= amount;
  sendEvent({ eventType: 'hit', attackerId: attacker.id, targetId: target.id, hp: Math.max(0, target.hp) });
  if (target.hp <= 0) {
    target.alive = false;
    target.deaths += 1;
    target.hp = 0;
    attacker.kills += 1;
    sendEvent({ eventType: 'death', attackerId: attacker.id, targetId: target.id });
    scheduleRespawn(target);
  }
}

function scheduleRespawn(player) {
  clearTimeout(player.respawnTimeout);
  player.respawnTimeout = setTimeout(() => {
    const spawn = randomSpawn();
    player.x = spawn.x;
    player.y = spawn.y;
    player.hp = 100;
    player.alive = true;
    player.input.shoot = false;
    sendEvent({ eventType: 'respawn', targetId: player.id });
  }, RESPAWN_DELAY);
}

function sendEvent(event) {
  broadcast({ v: VERSION, type: 'event', ...event });
}

function makeSnapshot() {
  const now = Date.now();
  const playersArr = Array.from(players.values()).map((p) => ({
    id: p.id,
    nickname: p.nickname,
    characterId: p.characterId,
    x: p.x,
    y: p.y,
    aimAngle: p.aimAngle,
    hp: p.hp,
    kills: p.kills,
    deaths: p.deaths,
    alive: p.alive
  }));
  return { v: VERSION, type: 'snapshot', tick: now, serverTime: now, players: playersArr, projectiles: [] };
}

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      return;
    }
    if (!msg || msg.v !== VERSION || typeof msg.type !== 'string') return;
    if (msg.type === 'join') return handleJoin(ws, msg);
    if (!ws.playerId) return;
    switch (msg.type) {
      case 'input':
        return handleInput(ws, msg);
      case 'ping':
        return handlePing(ws, msg);
      default:
        return;
    }
  });

  ws.on('close', () => {
    const player = players.get(ws.playerId);
    if (player) {
      clearTimeout(player.respawnTimeout);
      players.delete(player.id);
    }
  });
});

setInterval(() => {
  update(1 / TICK_RATE);
}, 1000 / TICK_RATE);

setInterval(() => {
  broadcast(makeSnapshot());
}, 1000 / SNAPSHOT_RATE);

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
