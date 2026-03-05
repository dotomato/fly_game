/**
 * 重置房间功能测试
 */
const { io } = require('socket.io-client');
const SERVER = 'http://localhost:3000';

let passed = 0, failed = 0;
function assert(c, label) {
  if (c) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}`); failed++; }
}
const delay = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log('=== 重置房间功能测试 ===\n');
  const ROOM = 'reset-test-' + Date.now();

  const p1 = io(SERVER, { transports: ['websocket'] });
  const p2 = io(SERVER, { transports: ['websocket'] });

  let p1State = null, p2State = null;
  let p1GameOver = null, p2GameOver = null;
  let p1Reset = null, p2Reset = null;
  let p1Errors = [], p2Errors = [];

  p1.on('room-update', s => { p1State = s; });
  p2.on('room-update', s => { p2State = s; });
  p1.on('game-started', s => { p1State = s; });
  p2.on('game-started', s => { p2State = s; });
  p1.on('dice-result', d => { p1State = d.roomState; });
  p2.on('dice-result', d => { p2State = d.roomState; });
  p1.on('game-over', d => { p1GameOver = d; p1State = d.roomState; });
  p2.on('game-over', d => { p2GameOver = d; p2State = d.roomState; });
  p1.on('game-reset', s => { p1Reset = s; p1State = s; });
  p2.on('game-reset', s => { p2Reset = s; p2State = s; });
  p1.on('error', e => p1Errors.push(e.message));
  p2.on('error', e => p2Errors.push(e.message));

  await delay(300);

  // --- 建立房间并开始游戏 ---
  console.log('--- [1] 建立房间并完成一局游戏 ---');
  p1.emit('join-room', { roomId: ROOM, playerName: '小红', maxPlayers: 2 });
  await delay(200);
  p2.emit('join-room', { roomId: ROOM, playerName: '小蓝', maxPlayers: 2 });
  await delay(200);
  p1.emit('start-game', { roomId: ROOM });
  await delay(200);

  // 快速打完一局
  let rounds = 0;
  while (!p1GameOver && rounds < 200) {
    rounds++;
    const state = p1State;
    if (!state || state.status !== 'playing') break;
    const cur = state.players[state.currentTurnIndex];
    const sock = cur.name === '小红' ? p1 : p2;
    sock.emit('roll-dice', { roomId: ROOM });
    await delay(100);
  }
  await delay(300);

  assert(!!p1GameOver, '游戏正常结束，P1 收到 game-over');
  assert(!!p2GameOver, '游戏正常结束，P2 收到 game-over');
  assert(p1State?.status === 'finished', '房间状态为 finished');

  // --- 权限测试：非房主不能重置 ---
  console.log('\n--- [2] 非房主重置被拒绝 ---');
  const p2ErrsBefore = p2Errors.length;
  p2.emit('reset-game', { roomId: ROOM });
  await delay(200);
  assert(p2Errors.length > p2ErrsBefore, 'P2（非房主）重置被拒绝');
  assert(!p1Reset, '房间未被非法重置');

  // --- 游戏进行中不能重置 ---
  console.log('\n--- [3] 游戏进行中不能重置（用新房间验证）---');
  const ROOM2 = 'reset-test-mid-' + Date.now();
  const q1 = io(SERVER, { transports: ['websocket'] });
  const q2 = io(SERVER, { transports: ['websocket'] });
  let q1State = null, q1Errors = [];
  q1.on('room-update', s => { q1State = s; });
  q1.on('game-started', s => { q1State = s; });
  q1.on('error', e => q1Errors.push(e.message));
  await delay(200);
  q1.emit('join-room', { roomId: ROOM2, playerName: '玩家A', maxPlayers: 2 });
  await delay(150);
  q2.emit('join-room', { roomId: ROOM2, playerName: '玩家B', maxPlayers: 2 });
  await delay(150);
  q1.emit('start-game', { roomId: ROOM2 });
  await delay(200);
  const q1ErrsBefore = q1Errors.length;
  q1.emit('reset-game', { roomId: ROOM2 });
  await delay(200);
  assert(q1Errors.length > q1ErrsBefore, '游戏进行中重置被拒绝');

  // --- 房主正常重置 ---
  console.log('\n--- [4] 房主重置游戏 ---');
  p1.emit('reset-game', { roomId: ROOM });
  await delay(300);

  assert(!!p1Reset, 'P1 收到 game-reset 事件');
  assert(!!p2Reset, 'P2 收到 game-reset 事件');
  assert(p1Reset?.status === 'playing', '重置后状态为 playing');
  assert(p1Reset?.players?.every(p => p.position === 0), '重置后所有玩家位置归0');
  assert(p1Reset?.players?.every(p => !p.isFinished), '重置后所有玩家 isFinished=false');
  assert(p1Reset?.players?.every(p => p.finishOrder === null), '重置后所有玩家 finishOrder=null');
  assert(p1Reset?.currentTurnIndex === 0, '重置后回合从第0号玩家开始');

  // --- 重置后可以正常掷骰子 ---
  console.log('\n--- [5] 重置后游戏可正常进行 ---');
  let diceAfterReset = 0;
  p1.on('dice-result', () => { diceAfterReset++; });
  p1.emit('roll-dice', { roomId: ROOM });
  await delay(300);
  assert(diceAfterReset >= 1, '重置后可以正常掷骰子');

  // 清理
  [p1, p2, q1, q2].forEach(s => s.disconnect());

  console.log('\n==============================');
  console.log(`测试完成: ${passed} 通过，${failed} 失败`);
  console.log('==============================');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
