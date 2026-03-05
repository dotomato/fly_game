/**
 * 情侣飞行棋 - 游戏前端逻辑
 */

// ===== 从URL获取参数 =====
const params = new URLSearchParams(window.location.search);
const ROOM_ID = params.get('roomId') || '';
const MY_NAME = params.get('name') || '玩家';
const MY_IDX = parseInt(params.get('idx') || '0');

// ===== Socket.io 连接 =====
const socket = io();

// ===== 游戏状态 =====
let roomState = null;
let mySocketId = null;
let isRolling = false;
let tasksData = [];
let chatUnread = 0;

// 骰子数字映射
const DICE_FACES = ['', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];

// ===== 棋盘初始化 =====
async function initBoard() {
  // 加载任务数据
  try {
    const res = await fetch('api/tasks');
    tasksData = await res.json();
  } catch (e) {
    console.warn('任务数据加载失败', e);
  }

  const track = document.getElementById('boardTrack');

  for (let i = 1; i <= 80; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.id = `cell-${i}`;
    if (i >= 75) cell.classList.add('end-cell');

    const task = tasksData[i - 1];
    const titleText = task ? task.title : '';

    cell.innerHTML = `
      <div class="cell-number">${i}</div>
      <div class="cell-title">${escapeHtml(titleText)}</div>
      <div class="cell-players" id="players-${i}"></div>
    `;

    // 鼠标悬停提示（桌面端）
    cell.title = task ? `第 ${i} 格：${task.content}` : `第 ${i} 格`;

    track.appendChild(cell);
  }
}

// ===== 渲染棋盘上的棋子 =====
function renderBoardPlayers(players) {
  // 清空所有格子的棋子
  for (let i = 0; i <= 80; i++) {
    const el = document.getElementById(`players-${i}`);
    if (el) el.innerHTML = '';
  }

  // 重新放置
  players.forEach(p => {
    const pos = p.position; // 0 = 起点
    const el = document.getElementById(`players-${pos}`);
    if (el) {
      const span = document.createElement('span');
      span.className = 'cell-player-emoji';
      span.textContent = p.emoji;
      span.title = p.name;
      el.appendChild(span);
    }
  });
}

// ===== 高亮格子：当前回合玩家 + 我自己 =====
function highlightCells(players, currentTurnIndex) {
  // 清除旧高亮
  document.querySelectorAll('.cell.active-cell').forEach(el => el.classList.remove('active-cell'));
  document.querySelectorAll('.cell.my-cell').forEach(el => el.classList.remove('my-cell'));

  // 当前回合玩家格（蓝色光晕）
  if (players && players[currentTurnIndex]) {
    const currentPlayer = players[currentTurnIndex];
    const cellEl = document.getElementById(`cell-${currentPlayer.position}`);
    if (cellEl) cellEl.classList.add('active-cell');
  }

  // 我自己所在格（蓝色背景高亮）
  if (players) {
    const myPlayer = players.find(p => p.socketId === mySocketId);
    if (myPlayer && !myPlayer.isFinished) {
      const myCellEl = document.getElementById(`cell-${myPlayer.position}`);
      if (myCellEl) myCellEl.classList.add('my-cell');
    }
  }
}

// ===== 自动滚动到当前玩家格子 =====
function scrollToPlayer(position, instant = false) {
  const cellEl = document.getElementById(`cell-${position}`);
  if (!cellEl) return;
  cellEl.scrollIntoView({ behavior: instant ? 'instant' : 'smooth', inline: 'center', block: 'nearest' });
}

// ===== 渲染侧边玩家列表 =====
function renderSidePlayerList(players, currentTurnIndex) {
  const list = document.getElementById('sidePlayerList');
  list.innerHTML = '';

  players.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'side-player-item';
    if (!p.isFinished && i === currentTurnIndex) li.classList.add('current-turn');
    if (p.isFinished) li.classList.add('finished');

    const statusText = p.isFinished
      ? `🏁 第${p.finishOrder}名`
      : (i === currentTurnIndex ? '轮到我了' : `第 ${p.position} 格`);
    const statusClass = p.isFinished ? 'status-finished' : 'status-playing';

    li.innerHTML = `
      <span class="p-emoji">${p.emoji}</span>
      <div class="p-info">
        <div class="p-name">${escapeHtml(p.name)}${p.socketId === mySocketId ? ' <span style="font-size:11px;color:var(--gray-400);font-weight:400">(我)</span>' : ''}</div>
        <div class="p-pos">位置：${p.position === 0 ? '起点' : `第 ${p.position} 格`}</div>
      </div>
      <span class="p-status ${statusClass}">${statusText}</span>
    `;
    list.appendChild(li);
  });
}

// ===== 更新顶部回合指示器 =====
function updateTurnIndicator(players, currentTurnIndex, status) {
  const indicator = document.getElementById('turnIndicator');

  if (status === 'finished') {
    indicator.textContent = '🎊 游戏结束！';
    indicator.classList.remove('my-turn');
    return;
  }

  if (!players || !players[currentTurnIndex]) return;
  const currentPlayer = players[currentTurnIndex];
  const isMyTurn = currentPlayer.socketId === mySocketId;

  if (isMyTurn) {
    indicator.textContent = '🎲 轮到你了！';
    indicator.classList.add('my-turn');
  } else {
    indicator.textContent = `⏳ 等待 ${currentPlayer.emoji} ${currentPlayer.name}`;
    indicator.classList.remove('my-turn');
  }
}

// ===== 更新掷骰子按钮 =====
function updateRollBtn(players, currentTurnIndex, status) {
  const btn = document.getElementById('rollBtn');
  const mobileBtn = document.getElementById('mobileRollBtn');
  if (status !== 'playing' || isRolling) {
    btn.disabled = true;
    mobileBtn.disabled = true;
    return;
  }
  if (!players || !players[currentTurnIndex]) {
    btn.disabled = true;
    mobileBtn.disabled = true;
    return;
  }
  const currentPlayer = players[currentTurnIndex];
  const disabled = currentPlayer.socketId !== mySocketId || currentPlayer.isFinished;
  btn.disabled = disabled;
  mobileBtn.disabled = disabled;
}

// ===== 渲染游戏日志 =====
function renderGameLog(logs) {
  const logEl = document.getElementById('gameLog');
  logEl.innerHTML = '';
  logs.forEach(msg => {
    const div = document.createElement('div');
    div.className = 'log-item';
    div.textContent = msg;
    logEl.appendChild(div);
  });
  logEl.scrollTop = logEl.scrollHeight;
}

// ===== 全量渲染 =====
function renderAll(state) {
  if (!state) return;
  roomState = state;

  renderBoardPlayers(state.players);
  highlightCells(state.players, state.currentTurnIndex);
  renderSidePlayerList(state.players, state.currentTurnIndex);
  updateTurnIndicator(state.players, state.currentTurnIndex, state.status);
  updateRollBtn(state.players, state.currentTurnIndex, state.status);
  renderGameLog(state.log || []);
  updateHostSection(state);
}

// ===== 房主操作区显隐 =====
function updateHostSection(state) {
  const section = document.getElementById('hostSection');
  const isHost = state.hostId === mySocketId;
  section.style.display = isHost ? 'block' : 'none';

  // 重置按钮：随时可用
  const resetBtn = document.getElementById('sideResetBtn');
  resetBtn.disabled = false;
  resetBtn.textContent = '↺ 重置游戏';
}

// ===== 玩家移动动画 =====
function animatePlayerMove(playerEmoji, fromPos, toPos, callback) {
  const fromCell = document.getElementById(`cell-${fromPos}`);
  const toCell = document.getElementById(`cell-${toPos}`);
  if (!fromCell || !toCell || fromPos === toPos) {
    callback();
    return;
  }

  // 立即滚动（instant），确保目标格子已在视口内，位置稳定
  scrollToPlayer(toPos, true);

  // 等两帧让布局稳定后，再取两端坐标
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const fromRect = fromCell.getBoundingClientRect();
      const toRect = toCell.getBoundingClientRect();

      // 创建飞行克隆，起点精确对准源格子中心
      const clone = document.createElement('span');
      clone.className = 'flying-emoji';
      clone.textContent = playerEmoji;
      const startX = fromRect.left + fromRect.width / 2 - 13;
      const startY = fromRect.top + fromRect.height / 2 - 13;
      clone.style.left = startX + 'px';
      clone.style.top = startY + 'px';
      document.body.appendChild(clone);

      // 下一帧触发过渡，translate 到目标中心
      requestAnimationFrame(() => {
        const dx = (toRect.left + toRect.width / 2 - 13) - startX;
        const dy = (toRect.top + toRect.height / 2 - 13) - startY;
        clone.style.transform = `translate(${dx}px, ${dy}px)`;
      });

      // 动画结束后执行回调
      setTimeout(() => {
        clone.remove();
        callback();
      }, 680);
    });
  });
}

// ===== 掷骰子 =====
function rollDice() {
  if (isRolling) return;
  const btn = document.getElementById('rollBtn');
  const mobileBtn = document.getElementById('mobileRollBtn');
  if (btn.disabled && mobileBtn.disabled) return;

  isRolling = true;
  btn.disabled = true;
  btn.textContent = '掷出中...';
  mobileBtn.disabled = true;
  mobileBtn.textContent = '掷出中...';

  // 骰子动画
  const diceEl = document.getElementById('diceDisplay');
  const mobileDiceEl = document.getElementById('mobileDiceDisplay');
  diceEl.classList.add('rolling');
  mobileDiceEl.classList.add('rolling');

  socket.emit('roll-dice', { roomId: ROOM_ID });
}

// ===== 任务详情（棋盘底部）=====
function showTaskPanel(data) {
  const { playerEmoji, playerName, diceValue, newPosition, task, justFinished } = data;

  const bar = document.getElementById('taskBar');
  document.getElementById('taskBarCell').textContent = `第 ${newPosition} 格`;
  document.getElementById('taskBarPlayer').innerHTML =
    `${playerEmoji} <strong>${escapeHtml(playerName)}</strong> 掷出 ${DICE_FACES[diceValue]}`;
  document.getElementById('taskBarContent').textContent = task ? task.content : '（无任务）';

  if (justFinished) {
    bar.classList.add('task-bar-end');
  } else {
    bar.classList.remove('task-bar-end');
  }
}

function clearTaskPanel() {
  const bar = document.getElementById('taskBar');
  bar.classList.remove('task-bar-end');
  document.getElementById('taskBarCell').textContent = '';
  document.getElementById('taskBarPlayer').textContent = '';
  document.getElementById('taskBarContent').textContent = '落子后，任务将显示在这里 ✨';
}

// ===== 聊天 =====
function initChat() {
  // 移动端默认折叠
  if (window.innerWidth <= 768) {
    document.getElementById('chatBox').classList.add('collapsed');
  }
  appendChatMessage({ system: true, message: '聊天室已开启，说点什么吧～' });
}

function toggleChat() {
  const box = document.getElementById('chatBox');
  const badge = document.getElementById('chatUnreadBadge');
  box.classList.toggle('collapsed');
  if (!box.classList.contains('collapsed')) {
    chatUnread = 0;
    badge.style.display = 'none';
    // 展开时滚到底
    const msgs = document.getElementById('chatMessages');
    msgs.scrollTop = msgs.scrollHeight;
  }
}

function appendChatMessage({ system = false, playerEmoji, playerName, message, timestamp, isMine = false }) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');

  if (system) {
    div.className = 'chat-msg system';
    const bubble = document.createElement('span');
    bubble.className = 'chat-msg-bubble';
    bubble.textContent = message;
    div.appendChild(bubble);
  } else {
    div.className = 'chat-msg ' + (isMine ? 'mine' : 'theirs');

    const meta = document.createElement('div');
    meta.className = 'chat-msg-meta';
    const timeStr = formatChatTime(timestamp);
    meta.textContent = isMine ? timeStr : `${playerEmoji} ${playerName}  ${timeStr}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-msg-bubble';
    bubble.textContent = message; // textContent 防 XSS

    div.appendChild(meta);
    div.appendChild(bubble);
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  // 折叠时累计未读数
  if (!system && document.getElementById('chatBox').classList.contains('collapsed')) {
    chatUnread++;
    const badge = document.getElementById('chatUnreadBadge');
    badge.textContent = chatUnread > 99 ? '99+' : String(chatUnread);
    badge.style.display = 'inline';
  }
}

function formatChatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message || !ROOM_ID) return;
  socket.emit('chat-message', { roomId: ROOM_ID, message });
  input.value = '';
}

function handleChatKey(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    sendChatMessage();
  }
}

// ===== 游戏结束弹窗 =====
function showGameOver(rankings) {
  const list = document.getElementById('rankingList');
  const medals = ['🥇', '🥈', '🥉', '4️⃣'];
  list.innerHTML = '';
  rankings.forEach((r, i) => {
    const li = document.createElement('li');
    li.className = 'ranking-item';
    li.innerHTML = `
      <span class="rank-num">${medals[i] || (i + 1)}</span>
      <span class="rank-emoji">${r.emoji}</span>
      <span class="rank-name">${escapeHtml(r.name)}</span>
    `;
    list.appendChild(li);
  });

  const overlay = document.getElementById('gameoverOverlay');
  setTimeout(() => overlay.classList.add('show'), 800);
}

// ===== 重置游戏 =====
function resetGame() {
  const btn = document.getElementById('sideResetBtn');
  btn.disabled = true;
  btn.textContent = '重置中...';
  socket.emit('reset-game', { roomId: ROOM_ID });
}

// ===== 销毁房间 =====
function confirmDestroy() {
  document.getElementById('destroyModal').classList.add('show');
}

function closeDestroyModal() {
  document.getElementById('destroyModal').classList.remove('show');
}

function doDestroyRoom() {
  document.getElementById('destroyModal').classList.remove('show');
  socket.emit('destroy-room', { roomId: ROOM_ID });
}

// ===== 返回首页 =====
function confirmHome() {
  document.getElementById('homeModal').classList.add('show');
}

function closeHomeModal() {
  document.getElementById('homeModal').classList.remove('show');
}

function goHome() {
  socket.disconnect();
  window.location.href = './';
}

// ===== 工具函数 =====
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== Socket.io 事件 =====

socket.on('connect', () => {
  mySocketId = socket.id;
  // 重连/首次进入游戏页时，重新加入房间以同步状态
  // maxPlayers 传 0，服务端对已存在房间不会用此值
  if (ROOM_ID && MY_NAME) {
    socket.emit('join-room', {
      roomId: ROOM_ID,
      playerName: MY_NAME,
      maxPlayers: 0
    });
  }
});

// 重新加入房间后同步
socket.on('joined', () => {
  // 等待 room-update 或 game-started
});

socket.on('room-update', (state) => {
  renderAll(state);
});

socket.on('game-started', (state) => {
  renderAll(state);
});

// 骰子结果
socket.on('dice-result', (data) => {
  const { roomState: newState, diceValue, justFinished, task, newPosition, playerEmoji, playerName } = data;

  // 停止骰子动画
  const diceEl = document.getElementById('diceDisplay');
  const mobileDiceEl = document.getElementById('mobileDiceDisplay');
  diceEl.classList.remove('rolling');
  diceEl.textContent = DICE_FACES[diceValue] || diceValue;
  mobileDiceEl.classList.remove('rolling');
  mobileDiceEl.textContent = DICE_FACES[diceValue] || diceValue;

  isRolling = false;
  document.getElementById('rollBtn').textContent = '掷骰子';
  document.getElementById('mobileRollBtn').textContent = '掷骰子';

  // 记录移动玩家的旧位置（动画用）
  const movingPlayer = roomState?.players?.find(p => p.emoji === playerEmoji);
  const oldPosition = movingPlayer ? movingPlayer.position : newPosition;

  // 执行移动动画，动画结束后再更新棋盘
  animatePlayerMove(playerEmoji, oldPosition, newPosition, () => {
    renderAll(newState);
    // 显示任务详情
    if (task) {
      showTaskPanel({ playerEmoji, playerName, diceValue, newPosition, task, justFinished });
    }
  });
});

socket.on('game-over', ({ rankings, roomState: finalState }) => {
  renderAll(finalState);
  showGameOver(rankings);
});

socket.on('game-reset', (state) => {
  // 隐藏结束弹窗
  document.getElementById('gameoverOverlay').classList.remove('show');
  // 清除任务详情
  clearTaskPanel();
  // 清空聊天记录
  document.getElementById('chatMessages').innerHTML = '';
  chatUnread = 0;
  document.getElementById('chatUnreadBadge').style.display = 'none';
  appendChatMessage({ system: true, message: '游戏已重置，聊天记录已清除～' });
  // 重新渲染（含房主按钮状态恢复）
  renderAll(state);
  // 滚动回起点
  document.getElementById('boardScrollContainer').scrollLeft = 0;
});

socket.on('chat-message', (data) => {
  const myPlayer = roomState?.players?.find(p => p.socketId === mySocketId);
  const isMine = myPlayer && myPlayer.emoji === data.playerEmoji && myPlayer.name === data.playerName;
  appendChatMessage({ ...data, isMine });
});

socket.on('room-destroyed', ({ message }) => {
  // 显示提示弹窗后跳回首页
  document.getElementById('destroyedModal').classList.add('show');
  setTimeout(() => {
    socket.disconnect();
    window.location.href = './';
  }, 2000);
});

socket.on('error', ({ message }) => {
  isRolling = false;
  const btn = document.getElementById('rollBtn');
  btn.textContent = '掷骰子';
  document.getElementById('mobileRollBtn').textContent = '掷骰子';
  if (roomState) updateRollBtn(roomState.players, roomState.currentTurnIndex, roomState.status);
  alert('错误：' + message);
});

// ===== 初始化 =====
initBoard().then(() => {
  initChat();
  // 棋盘初始化完成后若已有状态则重新渲染
  if (roomState) renderAll(roomState);
});

// 如果页面刷新，尝试重新加入房间
if (!ROOM_ID) {
  window.location.href = './';
}
