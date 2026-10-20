'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'rooms.json');
const SECRET = process.env.AUTH_SECRET || (process.env.NODE_ENV === 'production' ? null : 'replace-this-development-secret');
if (!SECRET) throw new Error('AUTH_SECRET must be set in production.');
const clients = new Set();
const STATIC_FILES = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/app.js', 'app.js'], ['/style.css', 'style.css']]);
let db = { rooms: {}, sessions: {} };

function ensureData() { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
function save() { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function sign(payload) { const body = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`; }
function userFromToken(token) { if (!token) return null; try { const parts = token.split('.'); if (parts.length !== 2 || !parts[0] || !parts[1]) return null; const [body, signature] = parts; const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url'); const actualBytes = Buffer.from(signature); const expectedBytes = Buffer.from(expected); if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) return null; const user = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return user && typeof user.id === 'string' && typeof user.exp === 'number' && user.exp > Date.now() ? user : null; } catch { return null; } }
function actor(req, url) { const headerToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, ''); const token = headerToken || (url.pathname === '/events' ? url.searchParams.get('token') : null); return userFromToken(token); }
function publicRoom(room) { return { id: room.id, ownerNickname: room.ownerNickname, title: room.title, introduction: room.introduction, boardSize: room.boardSize, timeSettings: room.timeSettings, status: room.status, createdAt: room.createdAt }; }
function broadcast(type, data, predicate = () => true) { const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; for (const client of clients) if (predicate(client.user)) client.res.write(message); }
function roomChanged(room) { broadcast('room-list-changed', { room: publicRoom(room) }); }
function error(res, status, code, message) { json(res, status, { error: { code, message } }); }
function json(res, status, payload) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); }
function body(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', c => raw += c); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('INVALID_JSON')); } }); }); }
function requireUser(req, res, url) { const user = actor(req, url); if (!user) { error(res, 401, 'UNAUTHENTICATED', '请先登录后再操作房间。'); return null; } return user; }
function getRoom(roomId, res) { const room = db.rooms[roomId]; if (!room) { error(res, 404, 'ROOM_NOT_FOUND', '房间不存在或已被关闭。'); return null; } return room; }
function authorizeOwner(room, user, res) { if (room.ownerId !== user.id) { error(res, 403, 'NOT_ROOM_OWNER', '只有房主可以处理本房间的申请。'); return false; } return true; }
function roomMoveLimit(session) { const room = db.rooms[session.roomId]; return room ? room.timeSettings.moveSeconds * 1000 : session.state.moveRemainingMs; }
function clockedState(session, now = Date.now()) {
 const state = session.state;
 if (state.finished) return { ...state, board: state.board.map(row => [...row]) };
 const elapsed = Math.max(0, now - new Date(state.turnStartedAt || session.updatedAt).getTime());
 const totalRemainingMs = Math.max(0, state.totalRemainingMs - elapsed);
 const moveRemainingMs = Math.max(0, state.moveRemainingMs - elapsed);
 const timedOut = totalRemainingMs === 0 || moveRemainingMs === 0; return { ...state, board: state.board.map(row => [...row]), totalRemainingMs, moveRemainingMs, finished: timedOut, ...(timedOut ? { finishedReason: moveRemainingMs === 0 ? 'move-timeout' : 'total-timeout', winner: state.current === 1 ? 2 : 1 } : {}) };
}
function sessionState(session) { return { id: session.id, roomId: session.roomId, boardSize: session.boardSize, players: session.players, state: clockedState(session), createdAt: session.createdAt, updatedAt: session.updatedAt }; }
function persistTimeout(session) {
 const state = clockedState(session);
 if (!state.finished || session.state.finished) return false;
 session.state = { ...state, finished: true, finishedReason: state.moveRemainingMs === 0 ? 'move-timeout' : 'total-timeout' };
 session.updatedAt = new Date().toISOString(); save();
 broadcast('game-state', { session: sessionState(session) }, u => u.id === session.players.black || u.id === session.players.white);
 return true;
}
function neighbors(board, x, y) { return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([nx, ny]) => ny >= 0 && ny < board.length && nx >= 0 && nx < board.length); }
function group(board, x, y) { const color = board[y][x], seen = new Set(), result = [], pending = [[x, y]]; while (pending.length) { const [cx, cy] = pending.pop(), key = `${cx},${cy}`; if (seen.has(key) || board[cy][cx] !== color) continue; seen.add(key); result.push([cx, cy]); for (const point of neighbors(board, cx, cy)) pending.push(point); } return result; }
function liberties(board, stones) { const points = new Set(); for (const [x, y] of stones) for (const [nx, ny] of neighbors(board, x, y)) if (board[ny][nx] === 0) points.add(`${nx},${ny}`); return points.size; }
function applyMove(board, x, y, color) { if (board[y][x] !== 0) return null; const next = board.map(row => [...row]); next[y][x] = color; const opponent = color === 1 ? 2 : 1; for (const [nx, ny] of neighbors(next, x, y)) if (next[ny][nx] === opponent) { const enemy = group(next, nx, ny); if (liberties(next, enemy) === 0) for (const [gx, gy] of enemy) next[gy][gx] = 0; } if (liberties(next, group(next, x, y)) === 0) return null; return next; }
function sameBoard(a, b) { return a.every((row, y) => row.every((value, x) => value === b[y][x])); }

async function handler(req, res) {
 const url = new URL(req.url, `http://${req.headers.host}`);
 if (req.method === 'GET' && url.pathname === '/events') { const user = requireUser(req, res, url); if (!user) return; res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }); res.write('event: connected\ndata: {}\n\n'); const client = { res, user }; clients.add(client); req.on('close', () => clients.delete(client)); return; }
 if (req.method === 'POST' && url.pathname === '/api/auth/anonymous') { const input = await body(req); const nickname = String(input.nickname || '棋手').trim().slice(0, 30) || '棋手'; const user = { id: id('usr'), nickname, exp: Date.now() + 7 * 864e5 }; return json(res, 201, { token: sign(user), user: { id: user.id, nickname } }); }
 if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
 const user = requireUser(req, res, url); if (!user) return;
 if (req.method === 'GET' && url.pathname === '/api/rooms') return json(res, 200, { rooms: Object.values(db.rooms).filter(r => r.status === 'recruiting').map(publicRoom) });
 if (req.method === 'GET' && url.pathname === '/api/sessions') { const sessions = Object.values(db.sessions).filter(s => s.players.black === user.id || s.players.white === user.id); for (const session of sessions) persistTimeout(session); return json(res, 200, { sessions: sessions.filter(session => !session.state.finished).map(session => ({ session: sessionState(session), color: session.players.black === user.id ? 1 : 2 })).sort((a, b) => b.session.updatedAt.localeCompare(a.session.updatedAt)) }); }
 if (req.method === 'POST' && url.pathname === '/api/rooms') { const input = await body(req); const boardSize = Number(input.boardSize); const totalMinutes = Number(input.timeSettings?.totalMinutes); const moveSeconds = Number(input.timeSettings?.moveSeconds); if (![9, 13, 19].includes(boardSize) || !(totalMinutes >= 1 && totalMinutes <= 180) || !(moveSeconds >= 5 && moveSeconds <= 600)) return error(res, 400, 'INVALID_ROOM', '棋盘或用时设置不合法。'); const room = { id: id('room'), ownerId: user.id, ownerNickname: user.nickname, title: String(input.title || '').trim().slice(0, 80), introduction: String(input.introduction || '').trim().slice(0, 500), boardSize, timeSettings: { totalMinutes, moveSeconds }, status: 'recruiting', createdAt: new Date().toISOString(), applications: [] }; if (!room.title) return error(res, 400, 'INVALID_ROOM', '请填写房间标题。'); db.rooms[room.id] = room; save(); roomChanged(room); return json(res, 201, { room: publicRoom(room) }); }
 const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(applications)(?:\/([^/]+)\/(approve|reject))?)?$/);
 if (roomMatch) { const [, roomId, applications, applicationId, action] = roomMatch; const room = getRoom(roomId, res); if (!room) return; if (!applications && req.method === 'GET') return json(res, 200, { room: publicRoom(room) });
   if (applications === 'applications' && !applicationId && req.method === 'POST') { if (room.status !== 'recruiting') return error(res, 409, 'ROOM_UNAVAILABLE', '房间已满或已关闭，不能再申请。'); if (room.ownerId === user.id) return error(res, 409, 'OWNER_CANNOT_APPLY', '房主不能申请自己的房间。'); if (room.applications.some(a => a.userId === user.id && a.status === 'pending')) return error(res, 409, 'DUPLICATE_APPLICATION', '你已申请过该房间，请等待房主处理。'); const application = { id: id('application'), userId: user.id, nickname: user.nickname, status: 'pending', createdAt: new Date().toISOString() }; room.applications.push(application); save(); broadcast('application-arrived', { roomId, application: { ...application, userId: undefined } }, u => u.id === room.ownerId); roomChanged(room); return json(res, 201, { application: { id: application.id, status: application.status } }); }
   if (applications === 'applications' && !applicationId && req.method === 'GET') { if (!authorizeOwner(room, user, res)) return; return json(res, 200, { applications: room.applications.filter(a => a.status === 'pending').map(a => ({ id: a.id, nickname: a.nickname, createdAt: a.createdAt })) }); }
   if (applications && applicationId && action && req.method === 'POST') { if (!authorizeOwner(room, user, res)) return; const application = room.applications.find(a => a.id === applicationId); if (!application || application.status !== 'pending') return error(res, 409, 'APPLICATION_EXPIRED', '该申请已失效或已处理。'); if (action === 'approve') { if (room.status !== 'recruiting') return error(res, 409, 'ROOM_FULL', '客人席位已被占用。'); application.status = 'approved'; room.status = 'full'; const now = new Date().toISOString(); const session = { id: id('game'), roomId, boardSize: room.boardSize, players: { black: room.ownerId, white: application.userId }, state: { board: Array.from({ length: room.boardSize }, () => Array(room.boardSize).fill(0)), current: 1, passes: 0, finished: false, totalRemainingMs: room.timeSettings.totalMinutes * 60000, moveRemainingMs: room.timeSettings.moveSeconds * 1000, turnStartedAt: now }, createdAt: now, updatedAt: now }; db.sessions[session.id] = session; for (const item of room.applications) if (item.id !== application.id && item.status === 'pending') item.status = 'expired'; save(); roomChanged(room); broadcast('application-approved', { roomId, session: sessionState(session) }, u => u.id === application.userId || u.id === room.ownerId); return json(res, 200, { session: sessionState(session) }); } application.status = 'rejected'; save(); broadcast('application-rejected', { roomId }, u => u.id === application.userId); roomChanged(room); return json(res, 200, { application: { id: application.id, status: application.status } }); }
 }
 const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(state|resign))?$/); if (sessionMatch) { const session = db.sessions[sessionMatch[1]]; if (!session) return error(res, 404, 'SESSION_NOT_FOUND', '对局会话不存在。'); if (![session.players.black, session.players.white].includes(user.id)) return error(res, 403, 'NOT_SESSION_PLAYER', '你无权加入该对局。'); if (persistTimeout(session)) { if (req.method !== 'GET') return error(res, 409, 'GAME_OVER', '对局已因超时结束。'); } if (req.method === 'GET') return json(res, 200, { session: sessionState(session), color: session.players.black === user.id ? 1 : 2 }); if (req.method === 'POST' && sessionMatch[2] === 'resign') { if (session.state.finished) return error(res, 409, 'GAME_OVER', '对局已经结束。'); const now = new Date().toISOString(); session.state = { ...clockedState(session), finished: true, finishedReason: 'resignation', resignedBy: user.id, winner: session.players.black === user.id ? 2 : 1 }; session.updatedAt = now; save(); broadcast('game-state', { session: sessionState(session) }, u => u.id === session.players.black || u.id === session.players.white); return json(res, 200, { session: sessionState(session) }); } if (req.method === 'PUT' && url.pathname.endsWith('/state')) { const input = await body(req); const state = input.state; const previous = clockedState(session); const color = session.players.black === user.id ? 1 : 2; if (previous.finished) return error(res, 409, 'GAME_OVER', '对局已经结束。'); if (!state || !Array.isArray(state.board) || state.board.length !== session.boardSize || previous.current !== color || state.current !== (color === 1 ? 2 : 1)) return error(res, 400, 'INVALID_GAME_STATE', '服务端拒绝无效的对局更新。'); for (let y = 0; y < session.boardSize; y++) if (!Array.isArray(state.board[y]) || state.board[y].length !== session.boardSize || state.board[y].some(cell => ![0, 1, 2].includes(cell))) return error(res, 400, 'INVALID_GAME_STATE', '棋盘规格或棋子颜色不匹配。'); let added = null; for (let y = 0; y < session.boardSize; y++) for (let x = 0; x < session.boardSize; x++) if (previous.board[y][x] === 0 && state.board[y][x] === color) { if (added) return error(res, 400, 'INVALID_MOVE', '每次只能落一子。'); added = [x, y]; }
   const isPass = !added && sameBoard(previous.board, state.board) && state.passes === previous.passes + 1;
   const expectedBoard = added && applyMove(previous.board, added[0], added[1], color);
   const repeatsKoPosition = added && Array.isArray(session.state.previousBoard) && sameBoard(expectedBoard || [], session.state.previousBoard);
   const isMove = added && state.passes === 0 && expectedBoard && !repeatsKoPosition && sameBoard(expectedBoard, state.board);
   if (!isPass && !isMove) return error(res, 403, 'INVALID_MOVE', '落子、提子或停一手不符合围棋规则。');
   const now = new Date().toISOString(); session.state = { ...previous, previousBoard: previous.board.map(row => [...row]), board: state.board.map(row => [...row]), current: state.current, passes: state.passes, finished: state.passes >= 2, ...(state.passes >= 2 ? { finishedReason: 'two-passes' } : {}), moveRemainingMs: roomMoveLimit(session), turnStartedAt: now }; session.updatedAt = now; save(); broadcast('game-state', { session: sessionState(session) }, u => u.id === session.players.black || u.id === session.players.white); return json(res, 200, { session: sessionState(session) }); } }
 error(res, 404, 'NOT_FOUND', '接口不存在。');
}
function serveStatic(pathname, res) { const filename = STATIC_FILES.get(pathname); if (!filename) return error(res, 404, 'NOT_FOUND', '页面不存在。'); const file = path.join(__dirname, filename); const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'; res.writeHead(200, { 'content-type': `${type}; charset=utf-8` }); fs.createReadStream(file).pipe(res); }
ensureData();
// Enforce clock expiry even when neither player sends another request.
const timeoutSweep = setInterval(() => {
 for (const session of Object.values(db.sessions)) persistTimeout(session);
}, 1000);
timeoutSweep.unref();
if (require.main === module) http.createServer((req, res) => handler(req, res).catch(err => error(res, 400, err.message, '请求无法处理。'))).listen(PORT, () => console.log(`Wei Qi server listening on ${PORT}`));
module.exports = { handler, resetForTest(data = { rooms: {}, sessions: {} }) { db = data; }, db };
