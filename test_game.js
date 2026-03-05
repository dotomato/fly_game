/**
 * 情侣飞行棋 - 自动化功能测试
 * 模拟：2个玩家加入房间 → 开始游戏 → 轮流掷骰子直到结束
 */

const { io } = require('socket.io-client');

const SERVER = 'http://localhost:3000';
const ROOM_ID = 'test-room-' + Date.now();

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('=== 情侣飞行棋功能测试 ===\n');
  console.log(`房间ID: ${ROOM_ID}`);

  // ---- 创建两个客户端 ----
  const p1 = io(SERVER, { transports: ['websocket'] });
  const p2 = io(SERVER, { transports: ['websocket'] });

  const p1State = { joined: false, roomState: null, diceResults: [], errors: [] };
  const p2State = { joined: false, roomState: null, diceResults: [], errors: [] };

  // ---- 绑定事件 ----
  p1.on('joined', ({ roomId, playerIndex }) => {
    p1State.joined = true;
    p1State.roomId = roomId;
    p1State.playerIndex = playerIndex;
  });
  p2.on('joined', ({ roomId, playerIndex }) => {
    p2State.joined = true;
    p2State.roomId = roomId;
    p2State.playerIndex = playerIndex;
  });

  p1.on('room-update', s => { p1State.roomState = s; });
  p2.on('room-update', s => { p2State.roomState = s; });

  p1.on('game-started', s => { p1State.gameStarted = true; p1State.roomState = s; });
  p2.on('game-started', s => { p2State.gameStarted = true; p2State.roomState = s; });

  p1.on('dice-result', d => { p1State.diceResults.push(d); p1State.roomState = d.roomState; });
  p2.on('dice-result', d => { p2State.diceResults.push(d); p2State.roomState = d.roomState; });

  p1.on('game-over', d => { p1State.gameOver = d; });
  p2.on('game-over', d => { p2State.gameOver = d; });

  p1.on('error', e => { p1State.errors.push(e.message); });
  p2.on('error', e => { p2State.errors.push(e.message); });

  // ---- 等待连接 ----
  await delay(500);

  console.log('\n--- [1] 连接测试 ---');
  assert(p1.connected, 'P1 已连接');
  assert(p2.connected, 'P2 已连接');

  // ---- 加入房间 ----
  console.log('\n--- [2] 加入房间 ---');
  p1.emit('join-room', { roomId: ROOM_ID, playerName: '小红', maxPlayers: 2 });
  await delay(300);
  assert(p1State.joined, 'P1 成功加入房间');
  assert(p1State.playerIndex === 0, 'P1 是第0号玩家（房主）');
  assert(p1State.roomState?.players?.length === 1, '房间内有1名玩家');

  p2.emit('join-room', { roomId: ROOM_ID, playerName: '小蓝', maxPlayers: 2 });
  await delay(300);
  assert(p2State.joined, 'P2 成功加入房间');
  assert(p2State.playerIndex === 1, 'P2 是第1号玩家');
  assert(p1State.roomState?.players?.length === 2, 'P1 收到房间更新：2名玩家');

  const players = p1State.roomState.players;
  assert(players[0].name === '小红', 'P1 名字正确');
  assert(players[1].name === '小蓝', 'P2 名字正确');
  assert(players[0].emoji === '❤️', 'P1 emoji 为 ❤️');
  assert(players[1].emoji === '💙', 'P2 emoji 为 💙');
  assert(players[0].position === 0, 'P1 起始位置为0');
  assert(players[1].position === 0, 'P2 起始位置为0');

  // ---- 权限测试：非房主不能开始 ----
  console.log('\n--- [3] 权限测试 ---');
  p2.emit('start-game', { roomId: ROOM_ID });
  await delay(200);
  assert(p2State.errors.length > 0, 'P2（非房主）开始游戏被拒绝');
  assert(!p1State.gameStarted, '游戏未被非法开始');

  // ---- 开始游戏 ----
  console.log('\n--- [4] 开始游戏 ---');
  p1.emit('start-game', { roomId: ROOM_ID });
  await delay(300);
  assert(p1State.gameStarted, 'P1 收到 game-started');
  assert(p2State.gameStarted, 'P2 收到 game-started');
  assert(p1State.roomState.status === 'playing', '游戏状态为 playing');
  assert(p1State.roomState.currentTurnIndex === 0, '第一回合是P1');

  // ---- 回合权限测试 ----
  console.log('\n--- [5] 回合权限测试 ---');
  const p2ErrsBefore = p2State.errors.length;
  p2.emit('roll-dice', { roomId: ROOM_ID });
  await delay(200);
  assert(p2State.errors.length > p2ErrsBefore, 'P2在P1回合掷骰子被拒绝');
  assert(p1State.diceResults.length === 0, 'P1未收到非法骰子结果');

  // ---- 模拟完整游戏：轮流掷骰子直到结束 ----
  console.log('\n--- [6] 游戏对局模拟 ---');

  let round = 0;
  const MAX_ROUNDS = 200; // 防止死循环

  while (!p1State.gameOver && round < MAX_ROUNDS) {
    round++;
    const state = p1State.roomState;
    if (!state || state.status !== 'playing') break;

    const currentIdx = state.currentTurnIndex;
    const currentPlayer = state.players[currentIdx];
    const socket = currentPlayer.name === '小红' ? p1 : p2;

    socket.emit('roll-dice', { roomId: ROOM_ID });
    await delay(150);
  }

  console.log(`  （共进行 ${round} 轮）`);
  assert(round < MAX_ROUNDS, '游戏在合理轮数内结束');

  // ---- 游戏结束验证 ----
  console.log('\n--- [7] 游戏结束验证 ---');
  await delay(300);
  assert(!!p1State.gameOver, 'P1 收到 game-over 事件');
  assert(!!p2State.gameOver, 'P2 收到 game-over 事件');

  const finalState = p1State.roomState;
  assert(finalState.status === 'finished', '房间状态为 finished');
  assert(finalState.players.every(p => p.isFinished), '所有玩家均已标记 isFinished');
  assert(finalState.players.every(p => p.finishOrder !== null), '所有玩家均有 finishOrder');

  const rankings = p1State.gameOver.rankings;
  assert(Array.isArray(rankings) && rankings.length === 2, '排行榜包含2名玩家');
  assert(rankings[0].order === 1, '第1名 order=1');
  assert(rankings[1].order === 2, '第2名 order=2');
  console.log(`  排行榜: ${rankings.map(r => `${r.emoji}${r.name}(第${r.order}名)`).join(', ')}`);

  // ---- 所有玩家最终位置在 75-80 ----
  console.log('\n--- [8] 终止位置验证 ---');
  finalState.players.forEach(p => {
    assert(p.position >= 75 && p.position <= 80, `${p.name} 终止位置 ${p.position} 在75-80之间`);
  });

  // ---- 断线测试 ----
  console.log('\n--- [9] 断线处理测试 ---');
  const p3 = io(SERVER, { transports: ['websocket'] });
  const p4 = io(SERVER, { transports: ['websocket'] });
  const room2 = 'test-disconnect-' + Date.now();
  let p3RoomState = null;

  p3.on('room-update', s => { p3RoomState = s; });
  p3.on('game-started', s => { p3RoomState = s; });
  p4.on('room-update', s => { p3RoomState = s; });

  p3.emit('join-room', { roomId: room2, playerName: '玩家3', maxPlayers: 2 });
  await delay(200);
  p4.emit('join-room', { roomId: room2, playerName: '玩家4', maxPlayers: 2 });
  await delay(200);
  p3.emit('start-game', { roomId: room2 });
  await delay(200);
  assert(p3RoomState?.status === 'playing', '第二房间游戏开始');

  p4.disconnect();
  await delay(400);
  assert(p3RoomState?.players?.find(p => p.name === '玩家4')?.isFinished === true, '断线玩家被标记为已完成');

  // ---- 清理 ----
  p1.disconnect();
  p2.disconnect();
  p3.disconnect();

  // ---- 汇总 ----
  console.log('\n==============================');
  console.log(`测试完成: ${passed} 通过，${failed} 失败`);
  console.log('==============================');

  process.exit(failed > 0 ? 1 : 0);
}

runTest().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
