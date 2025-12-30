const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const octx = overlay.getContext('2d');
const uiPanel = document.getElementById('ui-panel');
const startBtn = document.getElementById('startBtn');
const nicknameInput = document.getElementById('nickname');
const charactersDiv = document.getElementById('characters');
const statsDiv = document.getElementById('stats');
const scoreboardDiv = document.getElementById('scoreboard');

const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 600;
const RENDER_DELAY = 100; // ms
const VERSION = 1;

let socket = null;
let localPlayerId = null;
let chosenCharacter = 0;
let joined = false;
let lastFrame = performance.now();
let inputSeq = 0;
let pingInterval = null;
let serverTimeOffset = 0;

const snapshotBuffer = [];
const localState = {
  x: WORLD_WIDTH / 2,
  y: WORLD_HEIGHT / 2,
  aimAngle: 0,
  hp: 100,
  alive: true,
  kills: 0,
  deaths: 0,
  serverPosKnown: false
};

const sprites = [];
const fallbackColors = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444'];
for (let i = 0; i < 4; i++) {
  const img = new Image();
  img.src = `/assets/char${i}.png`;
  sprites.push(img);
}

function setupCharacterButtons() {
  for (let i = 0; i < 4; i++) {
    const btn = document.createElement('div');
    btn.className = 'char-option' + (i === 0 ? ' selected' : '');
    btn.dataset.id = i;
    const swatch = document.createElement('div');
    swatch.className = 'char-swatch';
    swatch.style.background = fallbackColors[i];
    const label = document.createElement('div');
    label.textContent = `#${i}`;
    btn.appendChild(swatch);
    btn.appendChild(label);
    btn.addEventListener('click', () => {
      chosenCharacter = i;
      document.querySelectorAll('.char-option').forEach((el) => el.classList.remove('selected'));
      btn.classList.add('selected');
    });
    charactersDiv.appendChild(btn);
  }
}
setupCharacterButtons();

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  overlay.width = window.innerWidth;
  overlay.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}`);
  socket.addEventListener('open', () => {
    send({ v: VERSION, type: 'join', nickname: nicknameInput.value || 'Player', characterId: chosenCharacter });
  });
  socket.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (!msg || msg.v !== VERSION) return;
    switch (msg.type) {
      case 'welcome':
        localPlayerId = msg.playerId;
        serverTimeOffset = Date.now() - msg.serverTime;
        joined = true;
        uiPanel.style.display = 'none';
        startPing();
        break;
      case 'snapshot':
        snapshotBuffer.push({ ...msg, receivedAt: Date.now() });
        while (snapshotBuffer.length > 50) snapshotBuffer.shift();
        applyLocalCorrection(msg);
        break;
      case 'event':
        handleEvent(msg);
        break;
      case 'pong':
        const now = performance.now();
        const rtt = now - msg.clientTime;
        serverTimeOffset = Date.now() - msg.serverTime;
        statsDiv.dataset.ping = Math.round(rtt);
        break;
    }
  });
  socket.addEventListener('close', () => {
    stopPing();
    joined = false;
    uiPanel.style.display = 'flex';
  });
}

function send(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function startPing() {
  stopPing();
  pingInterval = setInterval(() => {
    send({ v: VERSION, type: 'ping', clientTime: performance.now() });
  }, 2000);
}
function stopPing() {
  clearInterval(pingInterval);
}

startBtn.addEventListener('click', () => {
  if (joined) return;
  connect();
});

// Input handling
let joystickTouchId = null;
let aimTouchId = null;
let joystickPos = { x: 0, y: 0 };
let joystickVector = { x: 0, y: 0 };
let isShooting = false;
let mouseDown = false;

function screenToWorld(px, py) {
  return {
    x: (px / canvas.width) * WORLD_WIDTH,
    y: (py / canvas.height) * WORLD_HEIGHT
  };
}

function updateAimFromPointer(px, py) {
  const world = screenToWorld(px, py);
  const dx = world.x - localState.x;
  const dy = world.y - localState.y;
  localState.aimAngle = Math.atan2(dy, dx);
}

function handleTouchStart(e) {
  if (!joined) return;
  e.preventDefault();
  for (const touch of e.changedTouches) {
    const x = touch.clientX;
    const y = touch.clientY;
    if (x < canvas.width * 0.45 && y > canvas.height * 0.5 && joystickTouchId === null) {
      joystickTouchId = touch.identifier;
      joystickPos = { x, y };
      joystickVector = { x: 0, y: 0 };
    } else if (aimTouchId === null) {
      aimTouchId = touch.identifier;
      isShooting = true;
      updateAimFromPointer(x, y);
    }
  }
}
function handleTouchMove(e) {
  if (!joined) return;
  e.preventDefault();
  for (const touch of e.changedTouches) {
    if (touch.identifier === joystickTouchId) {
      const dx = touch.clientX - joystickPos.x;
      const dy = touch.clientY - joystickPos.y;
      const len = Math.hypot(dx, dy);
      const max = 60;
      const clamped = len > max ? max / len : 1;
      joystickVector = { x: dx * clamped / max, y: dy * clamped / max };
    } else if (touch.identifier === aimTouchId) {
      updateAimFromPointer(touch.clientX, touch.clientY);
    }
  }
}
function handleTouchEnd(e) {
  if (!joined) return;
  e.preventDefault();
  for (const touch of e.changedTouches) {
    if (touch.identifier === joystickTouchId) {
      joystickTouchId = null;
      joystickVector = { x: 0, y: 0 };
    }
    if (touch.identifier === aimTouchId) {
      aimTouchId = null;
      isShooting = false;
    }
  }
}

document.addEventListener('touchstart', handleTouchStart, { passive: false });
document.addEventListener('touchmove', handleTouchMove, { passive: false });
document.addEventListener('touchend', handleTouchEnd, { passive: false });
document.addEventListener('touchcancel', handleTouchEnd, { passive: false });

document.addEventListener('mousedown', (e) => {
  mouseDown = true;
  updateAimFromPointer(e.clientX, e.clientY);
  isShooting = true;
});
document.addEventListener('mousemove', (e) => {
  if (mouseDown) updateAimFromPointer(e.clientX, e.clientY);
});
document.addEventListener('mouseup', () => {
  mouseDown = false;
  isShooting = false;
});

const keys = new Set();
document.addEventListener('keydown', (e) => {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
    keys.add(e.code);
  }
});
document.addEventListener('keyup', (e) => {
  keys.delete(e.code);
});

function getKeyboardVector() {
  let x = 0, y = 0;
  if (keys.has('KeyA')) x -= 1;
  if (keys.has('KeyD')) x += 1;
  if (keys.has('KeyW')) y -= 1;
  if (keys.has('KeyS')) y += 1;
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

function sendInput(dt) {
  if (!joined) return;
  const move = joystickTouchId !== null ? joystickVector : getKeyboardVector();
  const payload = {
    v: VERSION,
    type: 'input',
    seq: ++inputSeq,
    dt,
    moveX: move.x,
    moveY: move.y,
    aimAngle: localState.aimAngle,
    shoot: isShooting,
    clientTime: Date.now()
  };
  send(payload);
  // local prediction
  applyLocalPrediction(move, dt, payload.shoot);
}

function applyLocalPrediction(move, dt, shoot) {
  const speed = 220;
  localState.x = clamp(localState.x + move.x * speed * dt, 0, WORLD_WIDTH);
  localState.y = clamp(localState.y + move.y * speed * dt, 0, WORLD_HEIGHT);
  if (shoot) {
    // visual recoil placeholder
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function applyLocalCorrection(snapshot) {
  if (!localPlayerId) return;
  const me = snapshot.players.find((p) => p.id === localPlayerId);
  if (!me) return;
  if (!localState.serverPosKnown) {
    localState.x = me.x;
    localState.y = me.y;
    localState.serverPosKnown = true;
  } else {
    const dx = me.x - localState.x;
    const dy = me.y - localState.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 12) {
      localState.x = localState.x + dx * 0.35;
      localState.y = localState.y + dy * 0.35;
    }
  }
  localState.hp = me.hp;
  localState.alive = me.alive;
  localState.kills = me.kills;
  localState.deaths = me.deaths;
}

function handleEvent(evt) {
  if (evt.eventType === 'respawn' && evt.targetId === localPlayerId) {
    localState.hp = 100;
    localState.alive = true;
  }
}

function getSnapshotForRender() {
  const renderTime = Date.now() - RENDER_DELAY - serverTimeOffset;
  if (snapshotBuffer.length === 0) return null;
  let older = null;
  let newer = null;
  for (let i = snapshotBuffer.length - 1; i >= 0; i--) {
    const snap = snapshotBuffer[i];
    if (snap.serverTime <= renderTime && (!older || snap.serverTime > older.serverTime)) {
      older = snap;
    }
    if (snap.serverTime >= renderTime) {
      newer = snap;
    }
  }
  if (!older) older = snapshotBuffer[0];
  if (!newer) newer = snapshotBuffer[snapshotBuffer.length - 1];
  return { older, newer, t: newer.serverTime === older.serverTime ? 0 : (renderTime - older.serverTime) / (newer.serverTime - older.serverTime) };
}

function lerp(a, b, t) { return a + (b - a) * t; }

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const interp = getSnapshotForRender();
  const scaleX = canvas.width / WORLD_WIDTH;
  const scaleY = canvas.height / WORLD_HEIGHT;
  if (interp) {
    const { older, newer, t } = interp;
    const players = newer.players.map((p, idx) => {
      const o = older.players.find((op) => op.id === p.id) || p;
      return {
        ...p,
        x: lerp(o.x, p.x, t),
        y: lerp(o.y, p.y, t),
        aimAngle: p.aimAngle
      };
    });

    players.forEach((p) => {
      const px = p.x * scaleX;
      const py = p.y * scaleY;
      const size = 48;
      const sprite = sprites[p.characterId];
      if (sprite && sprite.complete && sprite.naturalWidth) {
        ctx.drawImage(sprite, px - size / 2, py - size / 2, size, size);
      } else {
        ctx.fillStyle = fallbackColors[p.characterId % fallbackColors.length];
        ctx.fillRect(px - size / 2, py - size / 2, size, size);
      }
      // weapon line
      const lineLen = 28;
      const lx = px + Math.cos(p.aimAngle) * lineLen;
      const ly = py + Math.sin(p.aimAngle) * lineLen;
      ctx.strokeStyle = '#f8fafc';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(lx, ly);
      ctx.stroke();

      // hp bar
      const hpw = 40;
      const hpRatio = Math.max(0, p.hp) / 100;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(px - hpw / 2, py - 38, hpw, 6);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(px - hpw / 2, py - 38, hpw * hpRatio, 6);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(p.nickname, px - ctx.measureText(p.nickname).width / 2, py - 44);
    });

    updateScoreboard(players);
  }
  drawJoystick();
  requestAnimationFrame(draw);
}

function updateScoreboard(players) {
  const sorted = [...players].sort((a, b) => b.kills - a.kills);
  const ping = statsDiv.dataset.ping ? `${statsDiv.dataset.ping}ms` : '...';
  statsDiv.textContent = `Ping: ${ping} | Giocatori: ${sorted.length}`;
  scoreboardDiv.innerHTML = sorted
    .map((p) => `<div>${p.nickname} — K:${p.kills} D:${p.deaths}${p.id === localPlayerId ? ' (tu)' : ''}</div>`)
    .join('');
}

function drawJoystick() {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (joystickTouchId !== null) {
    const base = joystickPos;
    const knob = { x: base.x + joystickVector.x * 60, y: base.y + joystickVector.y * 60 };
    octx.globalAlpha = 0.5;
    octx.fillStyle = '#0ea5e9';
    octx.beginPath();
    octx.arc(base.x, base.y, 50, 0, Math.PI * 2);
    octx.fill();
    octx.fillStyle = '#22c55e';
    octx.beginPath();
    octx.arc(knob.x, knob.y, 30, 0, Math.PI * 2);
    octx.fill();
    octx.globalAlpha = 1;
  }
}

function gameLoop() {
  const now = performance.now();
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  if (joined) {
    const move = joystickTouchId !== null ? joystickVector : getKeyboardVector();
    if (mouseDown || aimTouchId !== null) {
      isShooting = true;
    }
    sendInput(dt);
  }
  requestAnimationFrame(gameLoop);
}

draw();
gameLoop();
