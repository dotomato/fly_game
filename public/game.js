/**
 * 情侣飞行棋 - 游戏前端逻辑
 */

// ===== 从URL获取参数 =====
const params = new URLSearchParams(window.location.search);
const ROOM_ID = params.get('roomId') || '';
const MY_NAME = params.get('name') || '玩家';
const MY_IDX = parseInt(params.get('idx') || '0');
const SCRIPT_ID = params.get('script') || 'couples';

// ===== Socket.io 连接 =====
const socket = io();

// ===== 游戏状态 =====
let roomState = null;
let mySocketId = null;
let isRolling = false;
let tasksData = [];

// ===== 语音录制状态 =====
let voiceRecorder = null;
let voiceChunks = [];
let voiceStartTime = 0;
let voiceTimerHandle = null;
const MAX_VOICE_SECONDS = 60;

// 骰子数字映射
const DICE_FACES = ['', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];

// ===== 棋盘初始化 =====
async function initBoard() {
  try {
    const res = await fetch(`api/tasks?script=${encodeURIComponent(SCRIPT_ID)}`);
    tasksData = await res.json();
  } catch (e) {
    console.warn('任务数据加载失败', e);
  }

  const track = document.getElementById('boardTrack');

  for (let i = 1; i <= 40; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.id = `cell-${i}`;
    if (i >= 36) cell.classList.add('end-cell');

    const task = tasksData[i - 1];
    const titleText = task ? task.title : '';

    cell.innerHTML = `
      <div class="cell-number">${i}</div>
      <div class="cell-title">${escapeHtml(titleText)}</div>
      <div class="cell-players" id="players-${i}"></div>
    `;

    cell.title = task ? `第 ${i} 格：${task.content}` : `第 ${i} 格`;
    track.appendChild(cell);
  }
}

// ===== 渲染棋盘上的棋子 =====
function renderBoardPlayers(players) {
  for (let i = 0; i <= 40; i++) {
    const el = document.getElementById(`players-${i}`);
    if (el) el.innerHTML = '';
  }

  players.forEach(p => {
    const pos = p.position;
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
  document.querySelectorAll('.cell.active-cell').forEach(el => el.classList.remove('active-cell'));
  document.querySelectorAll('.cell.my-cell').forEach(el => el.classList.remove('my-cell'));

  if (players && players[currentTurnIndex]) {
    const currentPlayer = players[currentTurnIndex];
    const cellEl = document.getElementById(`cell-${currentPlayer.position}`);
    if (cellEl) cellEl.classList.add('active-cell');
  }

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

// ===== 更新掷骰子按钮（悬浮 FAB） =====
function updateRollBtn(players, currentTurnIndex, status) {
  const fab = document.getElementById('rollFab');
  if (status !== 'playing' || isRolling) {
    fab.disabled = true;
    return;
  }
  if (!players || !players[currentTurnIndex]) {
    fab.disabled = true;
    return;
  }
  const currentPlayer = players[currentTurnIndex];
  fab.disabled = currentPlayer.socketId !== mySocketId || currentPlayer.isFinished;
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

  scrollToPlayer(toPos, true);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const fromRect = fromCell.getBoundingClientRect();
      const toRect = toCell.getBoundingClientRect();

      const clone = document.createElement('span');
      clone.className = 'flying-emoji';
      clone.textContent = playerEmoji;
      const startX = fromRect.left + fromRect.width / 2 - 13;
      const startY = fromRect.top + fromRect.height / 2 - 13;
      clone.style.left = startX + 'px';
      clone.style.top = startY + 'px';
      document.body.appendChild(clone);

      requestAnimationFrame(() => {
        const dx = (toRect.left + toRect.width / 2 - 13) - startX;
        const dy = (toRect.top + toRect.height / 2 - 13) - startY;
        clone.style.transform = `translate(${dx}px, ${dy}px)`;
      });

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
  const fab = document.getElementById('rollFab');
  if (fab.disabled) return;

  isRolling = true;
  fab.disabled = true;
  fab.classList.add('rolling');

  socket.emit('roll-dice', { roomId: ROOM_ID });
}

// ===== 任务详情（标题栏下方）=====
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
  appendChatMessage({ system: true, message: '聊天室已开启，说点什么吧～' });
  initVoiceBtn();
}

function initVoiceBtn() {
  const btn = document.getElementById('voiceBtn');
  if (!btn) return;
  btn.addEventListener('mousedown', startVoiceRecord);
  btn.addEventListener('mouseup', stopVoiceRecord);
  btn.addEventListener('mouseleave', cancelVoiceRecord);
  btn.addEventListener('touchstart', e => { e.preventDefault(); startVoiceRecord(); }, { passive: false });
  btn.addEventListener('touchend', e => { e.preventDefault(); stopVoiceRecord(); }, { passive: false });
  btn.addEventListener('touchcancel', cancelVoiceRecord);
}

async function startVoiceRecord() {
  if (voiceRecorder) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    appendChatMessage({ system: true, message: '无法访问麦克风，请检查浏览器权限' });
    return;
  }
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/wav']
    .find(t => MediaRecorder.isTypeSupported(t)) || '';
  voiceChunks = [];
  voiceStartTime = Date.now();
  voiceRecorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: 16000
  });
  voiceRecorder.ondataavailable = e => { if (e.data.size > 0) voiceChunks.push(e.data); };
  voiceRecorder.start(100);
  const btn = document.getElementById('voiceBtn');
  btn.classList.add('recording');
  btn.title = '松开发送';
  voiceTimerHandle = setTimeout(() => stopVoiceRecord(), MAX_VOICE_SECONDS * 1000);
}

function stopVoiceRecord() {
  if (!voiceRecorder || voiceRecorder.state === 'inactive') return;
  clearTimeout(voiceTimerHandle);
  const recorderRef = voiceRecorder;
  const chunksRef = voiceChunks.slice();
  const startRef = voiceStartTime;
  recorderRef.onstop = () => {
    const duration = Math.max(1, Math.round((Date.now() - startRef) / 1000));
    if (duration < 1) {
      appendChatMessage({ system: true, message: '录音太短，未发送' });
      return;
    }
    const mimeType = recorderRef.mimeType || 'audio/webm';
    const blob = new Blob(chunksRef, { type: mimeType });
    blob.arrayBuffer().then(buf => {
      socket.emit('voice-message', { roomId: ROOM_ID, audio: buf, duration });
    });
  };
  recorderRef.stream.getTracks().forEach(t => t.stop());
  recorderRef.stop();
  resetVoiceState();
}

function cancelVoiceRecord() {
  if (!voiceRecorder || voiceRecorder.state === 'inactive') return;
  clearTimeout(voiceTimerHandle);
  voiceRecorder.stream.getTracks().forEach(t => t.stop());
  voiceRecorder.stop();
  resetVoiceState();
}

function resetVoiceState() {
  voiceRecorder = null;
  voiceChunks = [];
  voiceStartTime = 0;
  const btn = document.getElementById('voiceBtn');
  if (btn) { btn.classList.remove('recording'); btn.title = '按住说话'; }
}

function appendVoiceMessage({ playerEmoji, playerName, audio, duration, timestamp, isMine }) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + (isMine ? 'mine' : 'theirs');

  const meta = document.createElement('div');
  meta.className = 'chat-msg-meta';
  const timeStr = formatChatTime(timestamp);
  meta.textContent = isMine ? timeStr : `${playerEmoji} ${playerName}  ${timeStr}`;

  const bubble = document.createElement('div');
  bubble.className = 'chat-msg-bubble voice-bubble';

  const playBtn = document.createElement('button');
  playBtn.className = 'voice-play-btn';
  playBtn.textContent = '▶';

  const wave = document.createElement('span');
  wave.className = 'voice-wave';
  for (let i = 0; i < 5; i++) {
    const bar = document.createElement('span');
    bar.className = 'wave-bar';
    wave.appendChild(bar);
  }

  const durationSpan = document.createElement('span');
  durationSpan.className = 'voice-duration';
  durationSpan.textContent = duration + '"';

  bubble.appendChild(playBtn);
  bubble.appendChild(wave);
  bubble.appendChild(durationSpan);
  div.appendChild(meta);
  div.appendChild(bubble);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  // 用于确定 Blob 类型（服务端不传 mimeType，尝试 webm 回退 wav）
  const mimeType = ['audio/webm', 'audio/wav'].find(t => {
    try { return !!new Audio(); } catch (e) { return false; }
  }) || 'audio/webm';

  let audioObj = null;
  let playing = false;

  playBtn.onclick = () => {
    if (playing) {
      audioObj && audioObj.pause();
      playing = false;
      playBtn.textContent = '▶';
      bubble.classList.remove('playing');
      return;
    }
    const blob = new Blob([audio], { type: mimeType });
    const url = URL.createObjectURL(blob);
    audioObj = new Audio(url);
    audioObj.onended = () => {
      playing = false;
      playBtn.textContent = '▶';
      bubble.classList.remove('playing');
      URL.revokeObjectURL(url);
    };
    audioObj.play().catch(() => {
      appendChatMessage({ system: true, message: '语音播放失败，浏览器可能不支持此格式' });
      URL.revokeObjectURL(url);
    });
    playing = true;
    playBtn.textContent = '⏹';
    bubble.classList.add('playing');
  };
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
    bubble.textContent = message;

    div.appendChild(meta);
    div.appendChild(bubble);
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
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
  if (ROOM_ID && MY_NAME) {
    socket.emit('join-room', {
      roomId: ROOM_ID,
      playerName: MY_NAME,
      maxPlayers: 0
    });
  }
});

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
  const fab = document.getElementById('rollFab');
  fab.classList.remove('rolling');
  fab.textContent = DICE_FACES[diceValue] || '🎲';

  // 2秒后恢复骰子图标
  setTimeout(() => {
    if (!fab.classList.contains('rolling')) fab.textContent = '🎲';
  }, 2000);

  isRolling = false;

  // 记录移动玩家的旧位置（动画用）
  const movingPlayer = roomState?.players?.find(p => p.emoji === playerEmoji);
  const oldPosition = movingPlayer ? movingPlayer.position : newPosition;

  // 执行移动动画，动画结束后再更新棋盘
  animatePlayerMove(playerEmoji, oldPosition, newPosition, () => {
    renderAll(newState);
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
  document.getElementById('gameoverOverlay').classList.remove('show');
  clearTaskPanel();
  document.getElementById('chatMessages').innerHTML = '';
  appendChatMessage({ system: true, message: '游戏已重置，聊天记录已清除～' });
  renderAll(state);
  document.getElementById('boardScrollContainer').scrollLeft = 0;
});

socket.on('chat-message', (data) => {
  const myPlayer = roomState?.players?.find(p => p.socketId === mySocketId);
  const isMine = myPlayer && myPlayer.emoji === data.playerEmoji && myPlayer.name === data.playerName;
  appendChatMessage({ ...data, isMine });
});

socket.on('voice-message', (data) => {
  const myPlayer = roomState?.players?.find(p => p.socketId === mySocketId);
  const isMine = myPlayer && myPlayer.emoji === data.playerEmoji && myPlayer.name === data.playerName;
  appendVoiceMessage({ ...data, isMine });
});

socket.on('room-destroyed', ({ message }) => {
  document.getElementById('destroyedModal').classList.add('show');
  setTimeout(() => {
    socket.disconnect();
    window.location.href = './';
  }, 2000);
});

socket.on('error', ({ message }) => {
  isRolling = false;
  const fab = document.getElementById('rollFab');
  fab.classList.remove('rolling');
  fab.textContent = '🎲';
  if (roomState) updateRollBtn(roomState.players, roomState.currentTurnIndex, roomState.status);
  alert('错误：' + message);
});

// ===== 初始化 =====
initBoard().then(() => {
  initChat();
  if (roomState) renderAll(roomState);
});

if (!ROOM_ID) {
  window.location.href = './';
}
