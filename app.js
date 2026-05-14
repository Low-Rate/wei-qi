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
const gameMinutesInput = document.getElementById('game-minutes');
const moveSecondsInput = document.getElementById('move-seconds');
const timersEl = document.getElementById('timers');

const game = {
  mode: null, // ai | local | room
  roomRole: null, // host | guest
  roomCode: null,
  playerColor: 1,
  current: 1,
  board: createBoard(),
  passes: 0,
  locked: false,
  finished: false,
  totalLimitMs: 20 * 60 * 1000,
  moveLimitMs: 30 * 1000,
  totalRemainingMs: 20 * 60 * 1000,
  moveRemainingMs: 30 * 1000,
  timerTickId: null,
  lastTickAt: 0,
};

function createBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function resetBoard() {
  game.board = createBoard();
  game.current = 1;
  game.passes = 0;
  game.locked = false;
  game.finished = false;
  applyTimeSettings();
  game.totalRemainingMs = game.totalLimitMs;
  game.moveRemainingMs = game.moveLimitMs;
  startTimers();
  draw();
  updateTimersDisplay();
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
  if (!game.mode || game.finished) return false;
  if (game.mode !== 'room') return true;
  return game.current === game.playerColor;
}

function applyTimeSettings() {
  const gameMinutes = Number(gameMinutesInput.value);
  const moveSeconds = Number(moveSecondsInput.value);
  const safeMinutes = Number.isFinite(gameMinutes) ? Math.min(Math.max(gameMinutes, 1), 180) : 20;
  const safeSeconds = Number.isFinite(moveSeconds) ? Math.min(Math.max(moveSeconds, 5), 600) : 30;
  gameMinutesInput.value = safeMinutes;
  moveSecondsInput.value = safeSeconds;
  game.totalLimitMs = safeMinutes * 60 * 1000;
  game.moveLimitMs = safeSeconds * 1000;
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateTimersDisplay() {
  timersEl.textContent = `总时间：${formatTime(game.totalRemainingMs)} ｜ 当前手剩余：${formatTime(game.moveRemainingMs)} (${game.current === 1 ? '黑' : '白'})`;
}

function stopTimers() {
  if (game.timerTickId) {
    clearInterval(game.timerTickId);
    game.timerTickId = null;
  }
}

function startTimers() {
  stopTimers();
  game.lastTickAt = Date.now();
  game.timerTickId = setInterval(() => {
    if (game.finished || !game.mode) return;
    const now = Date.now();
    const elapsed = now - game.lastTickAt;
    game.lastTickAt = now;
    game.totalRemainingMs = Math.max(0, game.totalRemainingMs - elapsed);
    game.moveRemainingMs = Math.max(0, game.moveRemainingMs - elapsed);
    updateTimersDisplay();

    if (game.moveRemainingMs === 0) {
      const loser = game.current;
      const winner = loser === 1 ? 2 : 1;
      endGame(`${loser === 1 ? '黑' : '白'}方超时负，${winner === 1 ? '黑' : '白'}方胜。`);
      return;
    }

    if (game.totalRemainingMs === 0) {
      finishByScoring('对局总时长结束，自动数目完成。');
    }
  }, 200);
}

function getNeighbors(x, y) {
  return [
    { x: x - 1, y },
    { x: x + 1, y },
    { x, y: y - 1 },
    { x, y: y + 1 },
  ].filter((pos) => pos.x >= 0 && pos.x < SIZE && pos.y >= 0 && pos.y < SIZE);
}

function collectGroup(board, x, y) {
  const color = board[y][x];
  const stack = [{ x, y }];
  const visited = new Set([`${x},${y}`]);
  const group = [];

  while (stack.length) {
    const point = stack.pop();
    group.push(point);
    const neighbors = getNeighbors(point.x, point.y);
    for (const next of neighbors) {
      if (board[next.y][next.x] !== color) continue;
      const key = `${next.x},${next.y}`;
      if (visited.has(key)) continue;
      visited.add(key);
      stack.push(next);
    }
  }

  return group;
}

function countLiberties(board, group) {
  const liberties = new Set();
  for (const point of group) {
    const neighbors = getNeighbors(point.x, point.y);
    for (const next of neighbors) {
      if (board[next.y][next.x] === 0) {
        liberties.add(`${next.x},${next.y}`);
      }
    }
  }
  return liberties.size;
}

function removeGroup(board, group) {
  for (const point of group) {
    board[point.y][point.x] = 0;
  }
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function applyMove(board, x, y, color) {
  if (board[y][x] !== 0) return { ok: false, captured: 0 };

  board[y][x] = color;
  const opponent = color === 1 ? 2 : 1;
  let captured = 0;

  const neighbors = getNeighbors(x, y);
  for (const next of neighbors) {
    if (board[next.y][next.x] !== opponent) continue;
    const enemyGroup = collectGroup(board, next.x, next.y);
    if (countLiberties(board, enemyGroup) === 0) {
      captured += enemyGroup.length;
      removeGroup(board, enemyGroup);
    }
  }

  const selfGroup = collectGroup(board, x, y);
  if (countLiberties(board, selfGroup) === 0) {
    board[y][x] = 0;
    return { ok: false, captured: 0 };
  }

  return { ok: true, captured };
}

function switchTurn() {
  game.current = game.current === 1 ? 2 : 1;
  game.moveRemainingMs = game.moveLimitMs;
  game.lastTickAt = Date.now();
  updateTimersDisplay();
}

function countScore(board) {
  let blackStones = 0;
  let whiteStones = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[y][x] === 1) blackStones += 1;
      if (board[y][x] === 2) whiteStones += 1;
    }
  }

  const visited = new Set();
  let blackTerritory = 0;
  let whiteTerritory = 0;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[y][x] !== 0) continue;
      const key = `${x},${y}`;
      if (visited.has(key)) continue;

      const stack = [{ x, y }];
      const region = [];
      const borders = new Set();
      visited.add(key);

      while (stack.length) {
        const point = stack.pop();
        region.push(point);
        const neighbors = getNeighbors(point.x, point.y);
        for (const next of neighbors) {
          const nextStone = board[next.y][next.x];
          if (nextStone === 0) {
            const nextKey = `${next.x},${next.y}`;
            if (!visited.has(nextKey)) {
              visited.add(nextKey);
              stack.push(next);
            }
          } else {
            borders.add(nextStone);
          }
        }
      }

      if (borders.size === 1) {
        if (borders.has(1)) blackTerritory += region.length;
        if (borders.has(2)) whiteTerritory += region.length;
      }
    }
  }

  return {
    black: blackStones + blackTerritory,
    white: whiteStones + whiteTerritory,
    blackStones,
    whiteStones,
    blackTerritory,
    whiteTerritory,
  };
}

function endGame(message) {
  game.finished = true;
  game.locked = true;
  stopTimers();
  updateTimersDisplay();
  updateStatus(message);
  syncRoomState();
}

function finishByScoring(prefix = '对局结束，自动数目完成。') {
  const score = countScore(game.board);
  let winnerText = '平局';
  if (score.black > score.white) winnerText = '黑方胜';
  if (score.white > score.black) winnerText = '白方胜';
  endGame(`${prefix} 黑 ${score.black}（子${score.blackStones}+地${score.blackTerritory}）｜白 ${score.white}（子${score.whiteStones}+地${score.whiteTerritory}），${winnerText}。`);
}

function placeStone(x, y) {
  if (game.locked || !canCurrentPlayerMove()) return;
  const moveResult = applyMove(game.board, x, y, game.current);
  if (!moveResult.ok) {
    updateStatus('该位置不能落子（可能已被占用或会自杀）。');
    return;
  }

  game.passes = 0;
  const movedColor = game.current;
  switchTurn();
  draw();
  const captureText = moveResult.captured > 0 ? `，提子 ${moveResult.captured} 颗` : '';
  updateStatus(`${movedColor === 1 ? '黑' : '白'}方落子成功${captureText}，轮到${game.current === 1 ? '黑' : '白'}方。`);
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
      if (game.board[y][x] !== 0) continue;
      const boardCopy = cloneBoard(game.board);
      const result = applyMove(boardCopy, x, y, 2);
      if (result.ok) options.push({ x, y, captured: result.captured });
    }
  }

  if (!options.length) {
    game.passes += 1;
    game.current = 1;
    game.moveRemainingMs = game.moveLimitMs;
    game.lastTickAt = Date.now();
    game.locked = false;
    if (game.passes >= 2) {
      finishByScoring('AI 无合法落子且双方连续停一手。');
    } else {
      updateStatus('AI 无合法落子，停一手。轮到黑方。');
      updateTimersDisplay();
    }
    syncRoomState();
    return;
  }

  const choice = options[Math.floor(Math.random() * options.length)];
  applyMove(game.board, choice.x, choice.y, 2);
  game.passes = 0;
  switchTurn();
  game.locked = false;
  draw();
  const captureText = choice.captured > 0 ? `，提子 ${choice.captured} 颗` : '';
  updateStatus(`AI 落子 (${choice.x + 1}, ${choice.y + 1})${captureText}，轮到黑方。`);
  syncRoomState();
}

function pass() {
  if (!canCurrentPlayerMove()) return;
  game.passes += 1;
  const currentColor = game.current;
  switchTurn();
  updateStatus(`${currentColor === 1 ? '黑' : '白'}方停一手。`);
  syncRoomState();
  if (game.mode === 'ai' && game.current === 2) {
    game.locked = true;
    setTimeout(aiMove, 280);
  }
  if (game.passes >= 2) {
    finishByScoring('双方连续停一手。');
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
    totalLimitMs: game.totalLimitMs,
    moveLimitMs: game.moveLimitMs,
    totalRemainingMs: game.totalRemainingMs,
    moveRemainingMs: game.moveRemainingMs,
    finished: game.finished,
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
  game.totalLimitMs = state.totalLimitMs ?? game.totalLimitMs;
  game.moveLimitMs = state.moveLimitMs ?? game.moveLimitMs;
  gameMinutesInput.value = Math.round(game.totalLimitMs / 60000);
  moveSecondsInput.value = Math.round(game.moveLimitMs / 1000);
  game.totalRemainingMs = state.totalRemainingMs ?? game.totalLimitMs;
  game.moveRemainingMs = state.moveRemainingMs ?? game.moveLimitMs;
  game.finished = !!state.finished;
  game.locked = game.finished;
  draw();
  updateTimersDisplay();
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
  game.totalLimitMs = state.totalLimitMs ?? game.totalLimitMs;
  game.moveLimitMs = state.moveLimitMs ?? game.moveLimitMs;
  gameMinutesInput.value = Math.round(game.totalLimitMs / 60000);
  moveSecondsInput.value = Math.round(game.moveLimitMs / 1000);
  game.totalRemainingMs = state.totalRemainingMs ?? game.totalLimitMs;
  game.moveRemainingMs = state.moveRemainingMs ?? game.moveLimitMs;
  game.finished = !!state.finished;
  game.locked = game.finished;
  draw();
  updateTimersDisplay();
  joinStatus.textContent = `已加入房间：${code}`;
  updateStatus(`加入成功，你执白。轮到${game.current === 1 ? '黑' : '白'}方。`);
});

document.getElementById('restart').addEventListener('click', resetBoard);
document.getElementById('pass').addEventListener('click', pass);
gameMinutesInput.addEventListener('change', applyTimeSettings);
moveSecondsInput.addEventListener('change', applyTimeSettings);

boardCanvas.addEventListener('click', (event) => {
  const pos = toBoardPosition(event.clientX, event.clientY);
  if (!pos) return;
  placeStone(pos.x, pos.y);
});

draw();
updateTimersDisplay();
