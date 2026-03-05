/**
 * 测试：重置（随时）+ 销毁房间
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
  console.log('=== 重置（随时）+ 销毁房间测试 ===\n');

  // ---- 辅助：创建房间并开始游戏 ----
  async function setupRoom(roomId, names = ['小红', '小蓝']) {
    const sockets = names.map(() => io(SERVER, { transports: ['websocket'] }));
    const states = sockets.map(() => ({ state: null, errors: [], reset: null, destroyed: null }));
    sockets.forEach((s, i) => {
      s.on('room-update', st => { states[i].state = st; });
      s.on('game-started', st => { states[i].state = st; });
      s.on('dice-result', d => { states[i].state = d.roomState; });
      s.on('game-over', d => { states[i].state = d.roomState; });
      s.on('game-reset', st => { states[i].reset = st; states[i].state = st; });
      s.on('room-destroyed', d => { states[i].destroyed = d; });
      s.on('error', e => states[i].errors.push(e.message));
    });
    await delay(300);
    sockets[0].emit('join-room', { roomId, playerName: names[0], maxPlayers: 2 });
    await delay(150);
    sockets[1].emit('join-room', { roomId, playerName: names[1], maxPlayers: 2 });
    await delay(150);
    sockets[0].emit('start-game', { roomId });
    await delay(200);
    return { sockets, states };
  }

  // ==============================
  // [1] 游戏进行中直接重置
  // ==============================
  console.log('--- [1] 游戏进行中，房主随时可重置 ---');
  const ROOM1 = 'reset-mid-' + Date.now();
  const { sockets: s1, states: st1 } = await setupRoom(ROOM1);

  // 掷几步但不结束
  for (let i = 0; i < 4; i++) {
    const cur = st1[0].state?.players?.[st1[0].state.currentTurnIndex];
    if (!cur) break;
    const sock = cur.name === '小红' ? s1[0] : s1[1];
    sock.emit('roll-dice', { roomId: ROOM1 });
    await delay(150);
  }
  const posBefore = st1[0].state?.players?.map(p => p.position);
  assert(posBefore?.some(p => p > 0), '已移动一些格子');

  s1[0].emit('reset-game', { roomId: ROOM1 });
  await delay(300);

  assert(!!st1[0].reset, 'P1 收到 game-reset');
  assert(!!st1[1].reset, 'P2 收到 game-reset');
  assert(st1[0].reset?.status === 'playing', '重置后状态为 playing');
  assert(st1[0].reset?.players?.every(p => p.position === 0), '所有玩家归回起点');
  assert(st1[0].reset?.players?.every(p => !p.isFinished), 'isFinished 全为 false');
  assert(st1[0].reset?.currentTurnIndex === 0, '回合归零');

  // ==============================
  // [2] 非房主不能重置
  // ==============================
  console.log('\n--- [2] 非房主重置被拒绝 ---');
  const errsBefore = st1[1].errors.length;
  s1[1].emit('reset-game', { roomId: ROOM1 });
  await delay(200);
  assert(st1[1].errors.length > errsBefore, 'P2 重置被拒绝');

  // ==============================
  // [3] 游戏结束后也能重置
  // ==============================
  console.log('\n--- [3] 游戏结束后重置 ---');
  const ROOM2 = 'reset-after-' + Date.now();
  const { sockets: s2, states: st2 } = await setupRoom(ROOM2);
  let rounds = 0;
  while (!st2[0].state?.players?.every(p => p.isFinished) && rounds < 200) {
    rounds++;
    const cur = st2[0].state?.players?.[st2[0].state.currentTurnIndex];
    if (!cur || st2[0].state.status !== 'playing') break;
    const sock = cur.name === '小红' ? s2[0] : s2[1];
    sock.emit('roll-dice', { roomId: ROOM2 });
    await delay(100);
  }
  await delay(300);
  assert(st2[0].state?.status === 'finished', '游戏已结束');

  st2[0].reset = null;
  s2[0].emit('reset-game', { roomId: ROOM2 });
  await delay(300);
  assert(!!st2[0].reset, '游戏结束后重置成功');
  assert(st2[0].reset?.status === 'playing', '重置后可继续游戏');

  // ==============================
  // [4] 销毁房间 - 非房主被拒
  // ==============================
  console.log('\n--- [4] 非房主销毁被拒绝 ---');
  const ROOM3 = 'destroy-test-' + Date.now();
  const { sockets: s3, states: st3 } = await setupRoom(ROOM3);
  const d_errsBefore = st3[1].errors.length;
  s3[1].emit('destroy-room', { roomId: ROOM3 });
  await delay(200);
  assert(st3[1].errors.length > d_errsBefore, 'P2 销毁被拒绝');
  assert(!st3[0].destroyed, '房间未被非法销毁');

  // ==============================
  // [5] 房主销毁房间
  // ==============================
  console.log('\n--- [5] 房主销毁房间 ---');
  s3[0].emit('destroy-room', { roomId: ROOM3 });
  await delay(300);
  assert(!!st3[0].destroyed, 'P1（房主）收到 room-destroyed');
  assert(!!st3[1].destroyed, 'P2 收到 room-destroyed');
  assert(st3[0].destroyed.message?.includes('解散'), '销毁消息正确');

  // 验证房间已不存在（再次加入应重新创建）
  const s4 = io(SERVER, { transports: ['websocket'] });
  let s4Joined = false;
  s4.on('joined', () => { s4Joined = true; });
  await delay(200);
  s4.emit('join-room', { roomId: ROOM3, playerName: '新玩家', maxPlayers: 2 });
  await delay(300);
  assert(s4Joined, '房间销毁后可重新创建同名房间');
  s4.disconnect();

  // ==============================
  // [6] 游戏进行中也能销毁
  // ==============================
  console.log('\n--- [6] 游戏进行中销毁房间 ---');
  const ROOM4 = 'destroy-mid-' + Date.now();
  const { sockets: s5, states: st5 } = await setupRoom(ROOM4);
  s5[0].emit('roll-dice', { roomId: ROOM4 });
  await delay(150);
  s5[0].emit('destroy-room', { roomId: ROOM4 });
  await delay(300);
  assert(!!st5[0].destroyed, '游戏进行中也能销毁');
  assert(!!st5[1].destroyed, 'P2 收到销毁通知');

  // 清理
  [...s1, ...s2, ...s3, ...s5].forEach(s => s.disconnect());

  console.log('\n==============================');
  console.log(`测试完成: ${passed} 通过，${failed} 失败`);
  console.log('==============================');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
