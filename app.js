const SIZE = 19;
const CELL = 40;
const PADDING = 20;
const ROOM_PREFIX = 'weiqi-room-';

const boardCanvas = document.getElementById('board');
const ctx = boardCanvas.getContext('2d');
const statusEl = document.getElementById('status');
const modeLabel = document.getElementById('mode-label');
const roomControls = document.getElementById('room-controls');
const hostControls = document.getElementById('host-controls');
const joinControls = document.getElementById('join-controls');
const roomCodeOutput = document.getElementById('room-code-output');
const joinStatus = document.getElementById('join-status');

const game = {
  mode: null, // ai | local | room
  roomRole: null, // host | guest
  roomCode: null,
  playerColor: 1,
  current: 1,
  board: createBoard(),
  passes: 0,
  locked: false,
};

function createBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function resetBoard() {
  game.board = createBoard();
  game.current = 1;
  game.passes = 0;
  game.locked = false;
  draw();
  updateStatus('新对局已开始，黑先。');
  syncRoomState();
}

function setMode(mode, extra = {}) {
  game.mode = mode;
  game.roomRole = extra.roomRole || null;
  game.roomCode = extra.roomCode || null;
  game.playerColor = extra.playerColor || 1;

  roomControls.hidden = mode !== 'room';
  hostControls.hidden = extra.roomRole !== 'host';
  joinControls.hidden = extra.roomRole !== 'guest';

  const labelMap = {
    ai: '人机对决',
    local: '本机双人',
    room: extra.roomRole === 'host' ? '房主（联机）' : '玩家（联机）',
  };
  modeLabel.textContent = `当前模式：${labelMap[mode] || '未选择'}`;
  resetBoard();
}

function draw() {
  ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
  drawGrid();
  drawStars();
  drawStones();
}

function drawGrid() {
  ctx.strokeStyle = '#5b3b15';
  ctx.lineWidth = 1;
  for (let i = 0; i < SIZE; i++) {
    const pos = PADDING + i * CELL;
    ctx.beginPath();
    ctx.moveTo(PADDING, pos);
    ctx.lineTo(PADDING + CELL * (SIZE - 1), pos);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pos, PADDING);
    ctx.lineTo(pos, PADDING + CELL * (SIZE - 1));
    ctx.stroke();
  }
}

function drawStars() {
  const points = [3, 9, 15];
  ctx.fillStyle = '#5b3b15';
  for (const x of points) {
    for (const y of points) {
      ctx.beginPath();
      ctx.arc(PADDING + x * CELL, PADDING + y * CELL, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawStones() {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const stone = game.board[y][x];
      if (!stone) continue;
      const cx = PADDING + x * CELL;
      const cy = PADDING + y * CELL;
      ctx.beginPath();
      ctx.arc(cx, cy, 16, 0, Math.PI * 2);
      const gradient = ctx.createRadialGradient(cx - 5, cy - 5, 3, cx, cy, 16);
      if (stone === 1) {
        gradient.addColorStop(0, '#666');
        gradient.addColorStop(1, '#000');
      } else {
        gradient.addColorStop(0, '#fff');
        gradient.addColorStop(1, '#ddd');
      }
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = stone === 1 ? '#222' : '#aaa';
      ctx.stroke();
    }
  }
}

function toBoardPosition(clientX, clientY) {
  const rect = boardCanvas.getBoundingClientRect();
  const x = Math.round((clientX - rect.left - PADDING) / CELL);
  const y = Math.round((clientY - rect.top - PADDING) / CELL);
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return null;
  return { x, y };
}

function updateStatus(text) {
  statusEl.textContent = text;
}

function canCurrentPlayerMove() {
  if (!game.mode) return false;
  if (game.mode !== 'room') return true;
  return game.current === game.playerColor;
}

function placeStone(x, y) {
  if (game.locked || !canCurrentPlayerMove()) return;
  if (game.board[y][x] !== 0) {
    updateStatus('该位置已有棋子，请重新落子。');
    return;
  }

  game.board[y][x] = game.current;
  game.passes = 0;
  game.current = game.current === 1 ? 2 : 1;
  draw();
  updateStatus(`落子成功，轮到${game.current === 1 ? '黑' : '白'}方。`);
  syncRoomState();

  if (game.mode === 'ai' && game.current === 2) {
    game.locked = true;
    setTimeout(aiMove, 280);
  }
}

function aiMove() {
  const options = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (game.board[y][x] === 0) options.push({ x, y });
    }
  }

  if (!options.length) {
    updateStatus('棋盘已满，对局结束。');
    game.locked = true;
    return;
  }

  const choice = options[Math.floor(Math.random() * options.length)];
  game.board[choice.y][choice.x] = 2;
  game.current = 1;
  game.locked = false;
  draw();
  updateStatus(`AI 落子 (${choice.x + 1}, ${choice.y + 1})，轮到黑方。`);
}

function pass() {
  if (!canCurrentPlayerMove()) return;
  game.passes += 1;
  const currentColor = game.current;
  game.current = game.current === 1 ? 2 : 1;
  updateStatus(`${currentColor === 1 ? '黑' : '白'}方停一手。`);
  syncRoomState();
  if (game.mode === 'ai' && game.current === 2) {
    game.locked = true;
    setTimeout(aiMove, 280);
  }
  if (game.passes >= 2) {
    game.locked = true;
    updateStatus('双方连续停一手，对局结束（未计算目数）。');
  }
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function saveRoomState() {
  if (!game.roomCode) return;
  const payload = {
    board: game.board,
    current: game.current,
    passes: game.passes,
    updatedAt: Date.now(),
  };
  localStorage.setItem(ROOM_PREFIX + game.roomCode, JSON.stringify(payload));
}

function loadRoomState(code) {
  const raw = localStorage.getItem(ROOM_PREFIX + code);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function syncRoomState() {
  if (game.mode === 'room' && game.roomCode) {
    saveRoomState();
  }
}

window.addEventListener('storage', (event) => {
  if (!game.roomCode || event.key !== ROOM_PREFIX + game.roomCode || !event.newValue) return;
  const state = JSON.parse(event.newValue);
  game.board = state.board;
  game.current = state.current;
  game.passes = state.passes;
  draw();
  updateStatus(`房间已同步，轮到${game.current === 1 ? '黑' : '白'}方。`);
});

// Controls

document.getElementById('mode-ai').addEventListener('click', () => setMode('ai'));
document.getElementById('mode-local').addEventListener('click', () => setMode('local'));

document.getElementById('mode-room-host').addEventListener('click', () => {
  setMode('room', { roomRole: 'host', playerColor: 1 });
  roomCodeOutput.textContent = '请点击“生成房间码”。';
});

document.getElementById('mode-room-join').addEventListener('click', () => {
  setMode('room', { roomRole: 'guest', playerColor: 2 });
  joinStatus.textContent = '输入房间码并加入。';
});

document.getElementById('create-room').addEventListener('click', () => {
  const code = generateRoomCode();
  game.roomCode = code;
  roomCodeOutput.textContent = `房间码：${code}`;
  saveRoomState();
  updateStatus(`房间 ${code} 已创建，你执黑。`);
});

document.getElementById('join-room').addEventListener('click', () => {
  const input = document.getElementById('room-code-input');
  const code = input.value.trim().toUpperCase();
  if (!code) {
    joinStatus.textContent = '请先输入房间码。';
    return;
  }
  const state = loadRoomState(code);
  if (!state) {
    joinStatus.textContent = '房间不存在，请检查房间码。';
    return;
  }

  game.roomCode = code;
  game.board = state.board;
  game.current = state.current;
  game.passes = state.passes;
  draw();
  joinStatus.textContent = `已加入房间：${code}`;
  updateStatus(`加入成功，你执白。轮到${game.current === 1 ? '黑' : '白'}方。`);
});

document.getElementById('restart').addEventListener('click', resetBoard);
document.getElementById('pass').addEventListener('click', pass);

boardCanvas.addEventListener('click', (event) => {
  const pos = toBoardPosition(event.clientX, event.clientY);
  if (!pos) return;
  placeStone(pos.x, pos.y);
});

draw();
