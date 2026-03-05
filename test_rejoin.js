/**
 * 专项测试：2人房间加入 + 游戏页重连不报"满人"错误
 */
const { io } = require('socket.io-client');
const SERVER = 'http://localhost:3000';

let passed = 0, failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}`); failed++; }
}
const delay = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log('=== 2人房间 + 游戏页重连测试 ===\n');
  const ROOM_ID = 'fix-test-' + Date.now();

  // --- 1. 两人加入等待室 ---
  console.log('--- [1] 两人加入2人房间 ---');
  const p1 = io(SERVER, { transports: ['websocket'] });
  const p2 = io(SERVER, { transports: ['websocket'] });

  let p1Errors = [], p2Errors = [];
  let p1Joined = false, p2Joined = false;
  let p1GameStarted = false, p2GameStarted = false;
  let p1State = null, p2State = null;

  p1.on('joined', () => { p1Joined = true; });
  p2.on('joined', () => { p2Joined = true; });
  p1.on('error', e => p1Errors.push(e.message));
  p2.on('error', e => p2Errors.push(e.message));
  p1.on('room-update', s => { p1State = s; });
  p2.on('room-update', s => { p2State = s; });
  p1.on('game-started', s => { p1GameStarted = true; p1State = s; });
  p2.on('game-started', s => { p2GameStarted = true; p2State = s; });

  await delay(300);
  p1.emit('join-room', { roomId: ROOM_ID, playerName: '小红', maxPlayers: 2 });
  await delay(200);
  p2.emit('join-room', { roomId: ROOM_ID, playerName: '小蓝', maxPlayers: 2 });
  await delay(300);

  assert(p1Joined, 'P1 加入成功');
  assert(p2Joined, 'P2 加入成功');
  assert(p1Errors.length === 0, 'P1 无错误');
  assert(p2Errors.length === 0, 'P2 无错误');
  assert(p1State?.players?.length === 2, '房间内2名玩家');

  // --- 2. 房主开始游戏 ---
  console.log('\n--- [2] 开始游戏 ---');
  p1.emit('start-game', { roomId: ROOM_ID });
  await delay(300);
  assert(p1GameStarted, 'P1 收到 game-started');
  assert(p2GameStarted, 'P2 收到 game-started');

  // --- 3. 模拟 game.html 加载：两个新 socket 用相同名字重连（maxPlayers=0）---
  console.log('\n--- [3] 模拟 game.html 重连（maxPlayers=0，游戏进行中） ---');
  const g1 = io(SERVER, { transports: ['websocket'] });
  const g2 = io(SERVER, { transports: ['websocket'] });
  let g1Joined = false, g2Joined = false;
  let g1Errors = [], g2Errors = [];
  let g1State = null;

  g1.on('joined', () => { g1Joined = true; });
  g2.on('joined', () => { g2Joined = true; });
  g1.on('error', e => g1Errors.push(e.message));
  g2.on('error', e => g2Errors.push(e.message));
  g1.on('room-update', s => { g1State = s; });

  await delay(300);
  // 模拟 game.js 里的 connect 回调
  g1.emit('join-room', { roomId: ROOM_ID, playerName: '小红', maxPlayers: 0 });
  await delay(200);
  g2.emit('join-room', { roomId: ROOM_ID, playerName: '小蓝', maxPlayers: 0 });
  await delay(300);

  assert(g1Joined, 'game.html P1 重连成功（无满人错误）');
  assert(g2Joined, 'game.html P2 重连成功（无满人错误）');
  assert(g1Errors.length === 0, 'game.html P1 无错误');
  assert(g2Errors.length === 0, 'game.html P2 无错误');
  assert(g1State?.players?.length === 2, '重连后房间仍有2名玩家');
  assert(g1State?.status === 'playing', '重连后游戏状态仍为 playing');

  // --- 4. 陌生人加入已满房间 应该报错 ---
  console.log('\n--- [4] 陌生人加入2人满员房间应被拒绝 ---');
  const stranger = io(SERVER, { transports: ['websocket'] });
  let strangerErrors = [];
  stranger.on('error', e => strangerErrors.push(e.message));
  await delay(200);
  stranger.emit('join-room', { roomId: ROOM_ID, playerName: '陌生人', maxPlayers: 2 });
  await delay(300);
  assert(strangerErrors.length > 0, '陌生人加入进行中房间被拒绝');

  // 清理
  [p1, p2, g1, g2, stranger].forEach(s => s.disconnect());

  console.log('\n==============================');
  console.log(`测试完成: ${passed} 通过，${failed} 失败`);
  console.log('==============================');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
