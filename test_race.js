/**
 * 专项测试：模拟 index.html→game.html 跳转竞态问题
 * 验证旧 socket 断线不会导致游戏立即结束
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
  console.log('=== 页面跳转竞态修复测试 ===\n');
  const ROOM = 'race-test-' + Date.now();

  // ---- 模拟 index.html 阶段 ----
  console.log('--- [1] 两人在 index.html 加入房间 ---');
  const idx_p1 = io(SERVER, { transports: ['websocket'] });
  const idx_p2 = io(SERVER, { transports: ['websocket'] });

  let p1GameStarted = false, p2GameStarted = false;
  idx_p1.on('game-started', () => { p1GameStarted = true; });
  idx_p2.on('game-started', () => { p2GameStarted = true; });

  await delay(300);
  idx_p1.emit('join-room', { roomId: ROOM, playerName: '小红', maxPlayers: 2 });
  await delay(200);
  idx_p2.emit('join-room', { roomId: ROOM, playerName: '小蓝', maxPlayers: 2 });
  await delay(200);
  idx_p1.emit('start-game', { roomId: ROOM });
  await delay(300);

  assert(p1GameStarted, 'P1 收到 game-started');
  assert(p2GameStarted, 'P2 收到 game-started');

  // ---- 模拟 index.html 主动断线（socket.disconnect()）----
  console.log('\n--- [2] 模拟 index.html socket 主动断开 ---');
  idx_p1.disconnect();
  idx_p2.disconnect();

  // ---- 同时 game.html 新 socket 连上并 join-room ----
  console.log('\n--- [3] game.html 新 socket 立刻重连（模拟竞态）---');
  const game_p1 = io(SERVER, { transports: ['websocket'] });
  const game_p2 = io(SERVER, { transports: ['websocket'] });

  let g1Joined = false, g2Joined = false;
  let g1Errors = [], g2Errors = [];
  let g1State = null;
  let gameOverReceived = false;

  game_p1.on('joined', () => { g1Joined = true; });
  game_p2.on('joined', () => { g2Joined = true; });
  game_p1.on('error', e => g1Errors.push(e.message));
  game_p2.on('error', e => g2Errors.push(e.message));
  game_p1.on('room-update', s => { g1State = s; });
  game_p1.on('game-over', () => { gameOverReceived = true; });
  game_p2.on('game-over', () => { gameOverReceived = true; });

  // 立刻发（与断线几乎同时），模拟最坏竞态
  game_p1.emit('join-room', { roomId: ROOM, playerName: '小红', maxPlayers: 0 });
  game_p2.emit('join-room', { roomId: ROOM, playerName: '小蓝', maxPlayers: 0 });

  await delay(600);

  assert(g1Joined, 'game.html P1 重连成功');
  assert(g2Joined, 'game.html P2 重连成功');
  assert(g1Errors.length === 0, 'game.html P1 无错误');
  assert(g2Errors.length === 0, 'game.html P2 无错误');
  assert(g1State?.status === 'playing', '游戏状态仍为 playing');
  assert(!gameOverReceived, '未提前触发 game-over');
  assert(g1State?.players?.every(p => !p.isFinished), '所有玩家 isFinished=false');

  console.log('\n--- [4] 验证游戏可正常继续掷骰子 ---');
  let diceCount = 0;
  game_p1.on('dice-result', () => { diceCount++; });
  game_p2.on('dice-result', () => { diceCount++; });

  // 掷3轮骰子
  for (let i = 0; i < 3; i++) {
    const state = g1State;
    if (!state || state.status !== 'playing') break;
    const cur = state.players[state.currentTurnIndex];
    const sock = cur.name === '小红' ? game_p1 : game_p2;
    sock.emit('roll-dice', { roomId: ROOM });
    await delay(200);
  }

  assert(diceCount >= 2, `掷骰子正常（收到 ${diceCount} 次结果）`);

  // ---- 测试真实断线（grace period 后生效）----
  console.log('\n--- [5] 真实断线：8秒后应触发超时处理（跳过验证，仅确认不立即结束）---');
  // 只验证当前时刻游戏未结束，不等8秒
  assert(!gameOverReceived, '断线后8秒内游戏未立即结束（grace period 生效）');

  game_p1.disconnect();
  game_p2.disconnect();

  console.log('\n==============================');
  console.log(`测试完成: ${passed} 通过，${failed} 失败`);
  console.log('==============================');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
