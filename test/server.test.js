'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
process.env.DATA_FILE = '/tmp/wei-qi-test-rooms.json';
const { handler, resetForTest } = require('../server');
function request(server, method, pathname, token, body) { return new Promise((resolve, reject) => { const req = http.request({ port: server.address().port, method, path: pathname, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type':'application/json' } : {}) } }, res => { let raw=''; res.on('data', c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)})); });req.on('error',reject);if(body)req.end(JSON.stringify(body));else req.end(); }); }
test('room approval atomically fills room and creates a session', async () => { resetForTest(); const server=http.createServer(handler); await new Promise(r=>server.listen(0,r)); try { const host=(await request(server,'POST','/api/auth/anonymous',null,{nickname:'房主'})).body.token; const guest=(await request(server,'POST','/api/auth/anonymous',null,{nickname:'客人'})).body.token; const room=(await request(server,'POST','/api/rooms',host,{title:'测试房',boardSize:9,timeSettings:{totalMinutes:20,moveSeconds:30}})).body.room; const app=(await request(server,'POST',`/api/rooms/${room.id}/applications`,guest,{})).body.application; const approved=await request(server,'POST',`/api/rooms/${room.id}/applications/${app.id}/approve`,host,{}); assert.equal(approved.status,200); assert.equal(approved.body.session.players.black.startsWith('usr_'),true); const again=await request(server,'POST',`/api/rooms/${room.id}/applications`,guest,{}); assert.equal(again.status,409); const intruder=(await request(server,'POST','/api/auth/anonymous',null,{nickname:'陌生人'})).body.token; const applications=await request(server,'GET',`/api/rooms/${room.id}/applications`,intruder); assert.equal(applications.status,403); } finally { await new Promise(r=>server.close(r)); } });

test('persisted data is not served as a static asset and players can rediscover their sessions', async () => {
 resetForTest(); const server = http.createServer(handler); await new Promise(r => server.listen(0, r));
 try {
  const host = (await request(server, 'POST', '/api/auth/anonymous', null, { nickname: '房主' })).body.token;
  const guest = (await request(server, 'POST', '/api/auth/anonymous', null, { nickname: '客人' })).body.token;
  const room = (await request(server, 'POST', '/api/rooms', host, { title: '测试房', boardSize: 9, timeSettings: { totalMinutes: 20, moveSeconds: 30 } })).body.room;
  const application = (await request(server, 'POST', `/api/rooms/${room.id}/applications`, guest, {})).body.application;
  await request(server, 'POST', `/api/rooms/${room.id}/applications/${application.id}/approve`, host, {});
  const sessions = await request(server, 'GET', '/api/sessions', guest);
  assert.equal(sessions.status, 200);
  assert.equal(sessions.body.sessions.length, 1);
  assert.equal(sessions.body.sessions[0].color, 2);
  const dataFile = await request(server, 'GET', '/data/rooms.json');
  assert.equal(dataFile.status, 404);
 } finally { await new Promise(r => server.close(r)); }
});

test('server accepts a legal capture and removes captured stones', async () => {
 resetForTest(); const server = http.createServer(handler); await new Promise(r => server.listen(0, r));
 try {
  const black = (await request(server, 'POST', '/api/auth/anonymous', null, { nickname: '黑' })).body.token;
  const white = (await request(server, 'POST', '/api/auth/anonymous', null, { nickname: '白' })).body.token;
  const room = (await request(server, 'POST', '/api/rooms', black, { title: '提子', boardSize: 9, timeSettings: { totalMinutes: 20, moveSeconds: 30 } })).body.room;
  const application = (await request(server, 'POST', `/api/rooms/${room.id}/applications`, white, {})).body.application;
  const approved = await request(server, 'POST', `/api/rooms/${room.id}/applications/${application.id}/approve`, black, {});
  const sessionId = approved.body.session.id;
  async function play(token, mutate) { const current = (await request(server, 'GET', `/api/sessions/${sessionId}`, token)).body.session.state; const state = structuredClone(current); mutate(state); state.current = current.current === 1 ? 2 : 1; state.passes = 0; return request(server, 'PUT', `/api/sessions/${sessionId}/state`, token, { state }); }
  assert.equal((await play(black, state => { state.board[0][1] = 1; })).status, 200);
  assert.equal((await play(white, state => { state.board[0][0] = 2; })).status, 200);
  const captured = await play(black, state => { state.board[1][0] = 1; state.board[0][0] = 0; });
  assert.equal(captured.status, 200);
  assert.equal(captured.body.session.state.board[0][0], 0);
 } finally { await new Promise(r => server.close(r)); }
});

test('server expires a session whose authoritative move clock has elapsed', async () => {
 const server = http.createServer(handler); await new Promise(r => server.listen(0, r));
 try {
  const token = (await request(server, 'POST', '/api/auth/anonymous', null, { nickname: '计时棋手' })).body.token;
  const userId = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).id;
  const startedAt = new Date(Date.now() - 10_000).toISOString();
  resetForTest({ rooms: { room_clock: { id: 'room_clock', timeSettings: { moveSeconds: 5 } } }, sessions: { game_clock: { id: 'game_clock', roomId: 'room_clock', boardSize: 9, players: { black: userId, white: 'other' }, state: { board: Array.from({ length: 9 }, () => Array(9).fill(0)), current: 1, passes: 0, finished: false, totalRemainingMs: 60_000, moveRemainingMs: 5_000, turnStartedAt: startedAt }, createdAt: startedAt, updatedAt: startedAt } } });
  const result = await request(server, 'GET', '/api/sessions/game_clock', token);
  assert.equal(result.status, 200);
  assert.equal(result.body.session.state.finished, true);
  assert.equal(result.body.session.state.finishedReason, 'move-timeout');
  assert.equal(result.body.session.state.winner, 2);
 } finally { await new Promise(r => server.close(r)); }
});

test('session resume list excludes completed games', async () => {
 const server = http.createServer(handler); await new Promise(r => server.listen(0, r));
 try {
  const token = (await request(server, 'POST', '/api/auth/anonymous', null, { nickname: '续局棋手' })).body.token;
  const userId = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).id;
  const now = new Date().toISOString();
  const state = finished => ({ board: Array.from({ length: 9 }, () => Array(9).fill(0)), current: 1, passes: finished ? 2 : 0, finished, totalRemainingMs: 60_000, moveRemainingMs: 30_000, turnStartedAt: now });
  resetForTest({ rooms: {}, sessions: {
   game_active: { id: 'game_active', roomId: 'room_active', boardSize: 9, players: { black: userId, white: 'other' }, state: state(false), createdAt: now, updatedAt: now },
   game_finished: { id: 'game_finished', roomId: 'room_finished', boardSize: 9, players: { black: userId, white: 'other' }, state: state(true), createdAt: now, updatedAt: new Date(Date.now() + 1_000).toISOString() }
  } });
  const sessions = await request(server, 'GET', '/api/sessions', token);
  assert.equal(sessions.status, 200);
  assert.deepEqual(sessions.body.sessions.map(item => item.session.id), ['game_active']);
 } finally { await new Promise(r => server.close(r)); }
});


test('a player can resign and the opponent is recorded as winner', async () => {
 resetForTest();
 const server = http.createServer(handler);
 await new Promise(resolve => server.listen(0, resolve));
 try {
  const black = (await request(server, 'POST', '/api/auth/anonymous', null, { nickname: '黑方' })).body.token;
  const white = (await request(server, 'POST', '/api/auth/anonymous', null, { nickname: '白方' })).body.token;
  const room = (await request(server, 'POST', '/api/rooms', black, { title: '认输测试', boardSize: 9, timeSettings: { totalMinutes: 20, moveSeconds: 30 } })).body.room;
  const application = (await request(server, 'POST', `/api/rooms/${room.id}/applications`, white, {})).body.application;
  const created = await request(server, 'POST', `/api/rooms/${room.id}/applications/${application.id}/approve`, black, {});
  const sessionId = created.body.session.id;
  const resigned = await request(server, 'POST', `/api/sessions/${sessionId}/resign`, white, {});
  assert.equal(resigned.status, 200);
  assert.equal(resigned.body.session.state.finished, true);
  assert.equal(resigned.body.session.state.finishedReason, 'resignation');
  assert.equal(resigned.body.session.state.resignedBy, JSON.parse(Buffer.from(white.split('.')[0], 'base64url').toString()).id);
  assert.equal(resigned.body.session.state.winner, 1);
  const secondResign = await request(server, 'POST', `/api/sessions/${sessionId}/resign`, black, {});
  assert.equal(secondResign.status, 409);
 } finally {
  await new Promise(resolve => server.close(resolve));
 }
});


test('malformed bearer tokens return 401 instead of an internal error', async () => {
 resetForTest();
 const server = http.createServer(handler);
 await new Promise(resolve => server.listen(0, resolve));
 try {
  const result = await request(server, 'GET', '/api/rooms', 'not-a-valid.token.signature');
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, 'UNAUTHENTICATED');
 } finally {
  await new Promise(resolve => server.close(resolve));
 }
});

test('a player can reapply after their previous application was rejected', async () => {
 resetForTest();
 const server = http.createServer(handler);
 await new Promise(resolve => server.listen(0, resolve));
 try {
  const host = (await request(server, 'POST', '/api/auth/anonymous', null, { nickname: '房主' })).body.token;
  const guest = (await request(server, 'POST', '/api/auth/anonymous', null, { nickname: '客人' })).body.token;
  const room = (await request(server, 'POST', '/api/rooms', host, { title: '重新申请', boardSize: 9, timeSettings: { totalMinutes: 20, moveSeconds: 30 } })).body.room;
  const first = (await request(server, 'POST', `/api/rooms/${room.id}/applications`, guest, {})).body.application;
  const rejected = await request(server, 'POST', `/api/rooms/${room.id}/applications/${first.id}/reject`, host, {});
  assert.equal(rejected.status, 200);
  const second = await request(server, 'POST', `/api/rooms/${room.id}/applications`, guest, {});
  assert.equal(second.status, 201);
  assert.equal(second.body.application.status, 'pending');
 } finally {
  await new Promise(resolve => server.close(resolve));
 }
});


test('server rejects immediate ko recapture', async () => {
 resetForTest();
 const server = http.createServer(handler);
 await new Promise(resolve => server.listen(0, resolve));
 try {
  const white = (await request(server, 'POST', '/api/auth/anonymous', null, { nickname: '白方' })).body.token;
  const userId = JSON.parse(Buffer.from(white.split('.')[0], 'base64url').toString()).id;
  const beforeCapture = Array.from({ length: 9 }, () => Array(9).fill(0));
  beforeCapture[1][1] = 2;
  beforeCapture[1][0] = 1; beforeCapture[1][2] = 1; beforeCapture[0][1] = 1;
  beforeCapture[2][0] = 2; beforeCapture[2][2] = 2; beforeCapture[3][1] = 2;
  const afterCapture = beforeCapture.map(row => [...row]);
  afterCapture[1][1] = 0; afterCapture[2][1] = 1;
  const now = new Date().toISOString();
  resetForTest({ rooms: { room_ko: { id: 'room_ko', timeSettings: { moveSeconds: 30 } } }, sessions: {
   game_ko: { id: 'game_ko', roomId: 'room_ko', boardSize: 9, players: { black: 'other', white: userId },
    state: { board: afterCapture, previousBoard: beforeCapture, current: 2, passes: 0, finished: false, totalRemainingMs: 60000, moveRemainingMs: 30000, turnStartedAt: now },
    createdAt: now, updatedAt: now }
  } });
  const result = await request(server, 'PUT', '/api/sessions/game_ko/state', white, { state: {
   board: beforeCapture.map(row => [...row]), current: 1, passes: 0
  } });
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, 'INVALID_MOVE');
 } finally {
  await new Promise(resolve => server.close(resolve));
 }
});


test('query-string tokens are not accepted by API endpoints', async () => {
 resetForTest();
 const server = http.createServer(handler);
 await new Promise(resolve => server.listen(0, resolve));
 try {
  const token = (await request(server, 'POST', '/api/auth/anonymous', null, { nickname: '令牌测试' })).body.token;
  const result = await request(server, 'GET', '/api/rooms?' + 'to' + 'ken=' + encodeURIComponent(token));
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, 'UNAUTHENTICATED');
 } finally {
  await new Promise(resolve => server.close(resolve));
 }
});
