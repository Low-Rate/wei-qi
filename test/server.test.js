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
