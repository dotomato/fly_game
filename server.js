const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// 动态加载所有剧本（扫描 data/scripts/*.json，每个文件含 id/name/desc/tasks）
const SCRIPTS_DIR = path.join(__dirname, 'data/scripts');
const scriptsMap = new Map();   // id -> { id, name, desc, tasks }
const scriptsIndex = [];        // [{ id, name, desc, taskCount }] 供前端展示

fs.readdirSync(SCRIPTS_DIR)
  .filter(f => f.endsWith('.json'))
  .sort()
  .forEach(file => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf-8'));
      if (!raw.id || !Array.isArray(raw.tasks)) {
        console.warn(`[剧本跳过] ${file}：缺少 id 或 tasks 字段`);
        return;
      }
      scriptsMap.set(raw.id, raw);
      scriptsIndex.push({ id: raw.id, name: raw.name || raw.id, desc: raw.desc || '', taskCount: raw.tasks.length });
      console.log(`[剧本加载] ${raw.id} (${raw.name}) - ${raw.tasks.length} 个任务`);
    } catch (e) {
      console.error(`[剧本加载失败] ${file}:`, e.message);
    }
  });

if (scriptsMap.size === 0) {
  console.error('[错误] 未找到任何剧本，请检查 data/scripts/ 目录');
  process.exit(1);
}

// 默认剧本：优先取 couples，否则取第一个
const DEFAULT_SCRIPT_ID = scriptsMap.has('couples') ? 'couples' : scriptsIndex[0].id;
console.log(`[默认剧本] ${DEFAULT_SCRIPT_ID}`);

// 静态文件托管（HTML 文件禁用缓存，其他资源正常缓存）
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// 剧本列表接口
app.get('/api/scripts', (req, res) => {
  res.json(scriptsIndex);
});

// 任务数据接口（支持 ?script= 参数，返回 tasks 数组）
app.get('/api/tasks', (req, res) => {
  const scriptId = req.query.script || DEFAULT_SCRIPT_ID;
  const script = scriptsMap.get(scriptId) || scriptsMap.get(DEFAULT_SCRIPT_ID);
  res.json(script.tasks);
});

// 房间存储: Map<roomId, RoomState>
const rooms = new Map();

// 断线宽限期计时器: Map<socketId, timeoutHandle>
// 玩家断线后不立即处理，等待 REJOIN_GRACE_MS 内是否重连
const disconnectTimers = new Map();
const REJOIN_GRACE_MS = 8000; // 8秒宽限期

const EMOJIS = ['🐱', '🐶', '🐰', '🦊'];
const ALLOWED_EMOJIS = ['🐱','🐶','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐸','🐧','🐦','🦆','🦋','🐙','🦄','🐲','🌸','🌺','🌻','🌼','🌹','🍀','🌵','🍄','🎋','🍎','🍊','🍋','🍇','🍓','🍑','🍕','🍔','🍜','🍣','🍦','🧁','🍩','☕','🍅'];

/**
 * 房间结构:
 * {
 *   id: string,
 *   hostId: string,
 *   maxPlayers: number,
 *   players: [{ socketId, name, emoji, position, isFinished, finishOrder }],
 *   currentTurnIndex: number,
 *   status: 'waiting' | 'playing' | 'finished',
 *   waitingConfirm: boolean,
 *   log: string[],
 *   chatMessages: [{ playerEmoji, playerName, message, timestamp }]
 * }
 */

function getRoomPublicState(room) {
  return {
    id: room.id,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    scriptId: room.scriptId || 'couples',
    players: room.players.map(p => ({
      socketId: p.socketId,
      name: p.name,
      emoji: p.emoji,
      position: p.position,
      isFinished: p.isFinished,
      finishOrder: p.finishOrder
    })),
    currentTurnIndex: room.currentTurnIndex,
    status: room.status,
    waitingConfirm: room.waitingConfirm || false,
    log: room.log.slice(-20) // 只发最近20条日志
  };
}

function nextTurn(room) {
  const total = room.players.length;
  let tries = 0;
  do {
    room.currentTurnIndex = (room.currentTurnIndex + 1) % total;
    tries++;
  } while (room.players[room.currentTurnIndex].isFinished && tries < total);

  if (tries >= total && room.players.every(p => p.isFinished)) {
    room.status = 'finished';
  }
}

// 结束游戏：设置状态、广播排名
function finishGame(room, roomId) {
  room.status = 'finished';
  room.waitingConfirm = false;
  room.log.push('🎊 所有玩家完成旅程！游戏结束！');
  const rankings = room.players
    .filter(p => p.isFinished)
    .sort((a, b) => a.finishOrder - b.finishOrder)
    .map(p => ({ name: p.name, emoji: p.emoji, order: p.finishOrder }));
  io.to(roomId).emit('game-over', { rankings, roomState: getRoomPublicState(room) });
  console.log(`[游戏结束] 房间 ${roomId}`);
}

// 清理房间内所有玩家的断线计时器
function clearRoomTimers(room) {
  room.players.forEach(p => {
    if (disconnectTimers.has(p.socketId)) {
      clearTimeout(disconnectTimers.get(p.socketId));
      disconnectTimers.delete(p.socketId);
    }
  });
}

io.on('connection', (socket) => {
  console.log(`[连接] ${socket.id}`);

  // 加入房间
  socket.on('join-room', ({ roomId, playerName, maxPlayers, scriptId, emoji }) => {
    roomId = String(roomId).trim();
    playerName = String(playerName).trim().slice(0, 12) || '匿名玩家';
    maxPlayers = Math.min(Math.max(parseInt(maxPlayers) || 4, 2), 4); // 仅在创建新房间时生效
    const validScriptId = (scriptId && scriptsMap.has(scriptId)) ? scriptId : DEFAULT_SCRIPT_ID;

    let room = rooms.get(roomId);

    if (!room) {
      // 创建新房间
      room = {
        id: roomId,
        hostId: socket.id,
        maxPlayers,
        scriptId: validScriptId,
        players: [],
        currentTurnIndex: 0,
        status: 'waiting',
        log: [],
        chatMessages: []
      };
      rooms.set(roomId, room);
      console.log(`[创建房间] ${roomId} by ${socket.id}`);
    }

    // 检查是否已在房间中（同一 socketId 重连）
    const existingById = room.players.find(p => p.socketId === socket.id);
    if (existingById) {
      socket.join(roomId);
      socket.emit('joined', { roomId, playerIndex: room.players.indexOf(existingById) });
      io.to(roomId).emit('room-update', getRoomPublicState(room));
      return;
    }

    // 游戏进行中：按名字匹配，允许玩家用新 socketId 重连
    if (room.status === 'playing' || room.status === 'finished') {
      const existingByName = room.players.find(p => p.name === playerName);
      if (existingByName) {
        // 取消该玩家挂起的断线处理（宽限期内重连）
        const oldSocketId = existingByName.socketId;
        if (disconnectTimers.has(oldSocketId)) {
          clearTimeout(disconnectTimers.get(oldSocketId));
          disconnectTimers.delete(oldSocketId);
          room.log.push(`${existingByName.emoji} ${existingByName.name} 重新连接了`);
        }
        existingByName.socketId = socket.id;
        socket.join(roomId);
        socket.emit('joined', { roomId, playerIndex: room.players.indexOf(existingByName) });
        io.to(roomId).emit('room-update', getRoomPublicState(room));
        return;
      }
      socket.emit('error', { message: '游戏已在进行中，无法加入' });
      return;
    }

    // 房间已满
    if (room.players.length >= room.maxPlayers) {
      socket.emit('error', { message: '房间已满，请换一个房间ID' });
      return;
    }

    const player = {
      socketId: socket.id,
      name: playerName,
      emoji: (() => {
        // 用玩家选择的 emoji，需在允许列表内且未被占用
        const taken = new Set(room.players.map(p => p.emoji));
        if (emoji && ALLOWED_EMOJIS.includes(emoji) && !taken.has(emoji)) return emoji;
        // 否则分配一个未占用的默认 emoji
        return ALLOWED_EMOJIS.find(e => !taken.has(e)) || EMOJIS[room.players.length % EMOJIS.length];
      })(),
      position: 0,
      isFinished: false,
      finishOrder: null
    };
    room.players.push(player);
    socket.join(roomId);

    socket.emit('joined', { roomId, playerIndex: room.players.length - 1 });
    room.log.push(`${player.emoji} ${player.name} 加入了房间`);
    io.to(roomId).emit('room-update', getRoomPublicState(room));
    console.log(`[加入房间] ${playerName} -> ${roomId}`);
  });

  // 开始游戏（仅房主）
  socket.on('start-game', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.hostId !== socket.id) {
      socket.emit('error', { message: '只有房主才能开始游戏' });
      return;
    }
    if (room.players.length < 2) {
      socket.emit('error', { message: '至少需要2名玩家才能开始' });
      return;
    }
    if (room.status !== 'waiting') return;

    room.status = 'playing';
    // 第一个掷骰子的是房主
    room.currentTurnIndex = room.players.findIndex(p => p.socketId === room.hostId);
    if (room.currentTurnIndex === -1) room.currentTurnIndex = 0;
    room.log.push('游戏开始！');
    const firstPlayer = room.players[room.currentTurnIndex];
    room.log.push(`轮到 ${firstPlayer.emoji} ${firstPlayer.name} 掷骰子`);

    io.to(roomId).emit('game-started', getRoomPublicState(room));
    console.log(`[游戏开始] 房间 ${roomId}`);
  });

  // 重置房间（仅房主，任意状态均可）
  socket.on('reset-game', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.hostId !== socket.id) {
      socket.emit('error', { message: '只有房主才能重置游戏' });
      return;
    }

    clearRoomTimers(room);

    // 重置所有玩家状态
    room.players.forEach(p => {
      p.position = 0;
      p.isFinished = false;
      p.finishOrder = null;
    });
    room.currentTurnIndex = room.players.findIndex(p => p.socketId === room.hostId);
    if (room.currentTurnIndex === -1) room.currentTurnIndex = 0;
    room.waitingConfirm = false;
    room.status = 'playing';
    room.log = ['游戏重置，再来一局！'];
    room.chatMessages = [];
    const firstPlayer = room.players[room.currentTurnIndex];
    room.log.push(`轮到 ${firstPlayer.emoji} ${firstPlayer.name} 掷骰子`);

    console.log(`[游戏重置] 房间 ${roomId}`);
    io.to(roomId).emit('game-reset', getRoomPublicState(room));
  });

  // 销毁房间（仅房主）
  socket.on('destroy-room', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.hostId !== socket.id) {
      socket.emit('error', { message: '只有房主才能销毁房间' });
      return;
    }

    clearRoomTimers(room);
    console.log(`[销毁房间] ${roomId}`);
    io.to(roomId).emit('room-destroyed', { message: '房主已解散房间' });
    rooms.delete(roomId);
  });

  // 掷骰子
  socket.on('roll-dice', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;

    const currentPlayer = room.players[room.currentTurnIndex];
    if (currentPlayer.socketId !== socket.id) {
      socket.emit('error', { message: '还没轮到你掷骰子' });
      return;
    }
    if (currentPlayer.isFinished) return;

    // 生成骰子点数 1-6
    const diceValue = Math.floor(Math.random() * 6) + 1;

    // 计算新位置（上限由剧本实际任务数决定）
    const oldPosition = currentPlayer.position;
    const scriptTasks = scriptsMap.get(room.scriptId).tasks;
    const maxPosition = scriptTasks.length;
    let newPosition = Math.min(oldPosition + diceValue, maxPosition);
    currentPlayer.position = newPosition;
    const task = scriptTasks[newPosition - 1] || null;

    // 判断是否到达终点（必须到达最后一格才算完成）
    let justFinished = false;
    if (newPosition === maxPosition && !currentPlayer.isFinished) {
      currentPlayer.finishOrder = room.players.filter(p => p.isFinished).length + 1;
      currentPlayer.isFinished = true;
      justFinished = true;
      room.log.push(`${currentPlayer.emoji} ${currentPlayer.name} 掷出 ${diceValue}，到达第 ${newPosition} 格，完成旅程！🎉`);
    } else {
      room.log.push(`${currentPlayer.emoji} ${currentPlayer.name} 掷出 ${diceValue}，${oldPosition === 0 ? '出发' : `从第 ${oldPosition} 格`}前进到第 ${newPosition} 格`);
    }

    // 等待当前玩家确认任务完成，暂不切换回合
    room.waitingConfirm = true;

    io.to(roomId).emit('dice-result', {
      playerId: socket.id,
      playerName: currentPlayer.name,
      playerEmoji: currentPlayer.emoji,
      playerIndex: room.currentTurnIndex,
      diceValue,
      oldPosition,
      newPosition,
      task: task ? { id: task.id, title: task.title, content: task.content } : null,
      justFinished,
      roomState: getRoomPublicState(room)
    });

    // 全部玩家已完成时，仍保持 waitingConfirm=true，等最后一个玩家确认后再结束
  });

  // 确认任务完成，切换到下一回合
  socket.on('confirm-done', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    if (!room.waitingConfirm) return;

    const currentPlayer = room.players[room.currentTurnIndex];
    if (currentPlayer.socketId !== socket.id) {
      socket.emit('error', { message: '不是你的回合' });
      return;
    }

    room.waitingConfirm = false;

    // 如果所有玩家均已完成，确认后直接结束游戏
    if (room.players.every(p => p.isFinished)) {
      finishGame(room, roomId);
      return;
    }

    nextTurn(room);
    if (room.status !== 'finished') {
      const nextPlayer = room.players[room.currentTurnIndex];
      room.log.push(`轮到 ${nextPlayer.emoji} ${nextPlayer.name} 掷骰子`);
    }
    io.to(roomId).emit('room-update', getRoomPublicState(room));
  });

  // 聊天消息
  socket.on('chat-message', ({ roomId, message }) => {
    const room = rooms.get(roomId);
    if (!room || room.status === 'waiting') return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    message = String(message).trim().slice(0, 200);
    if (!message) return;

    const chatMsg = {
      playerEmoji: player.emoji,
      playerName: player.name,
      message,
      timestamp: new Date().toISOString()
    };

    room.chatMessages.push(chatMsg);
    if (room.chatMessages.length > 100) room.chatMessages.shift();

    io.to(roomId).emit('chat-message', chatMsg);
  });

  // 语音消息（仅中转广播，不存储）
  socket.on('voice-message', ({ roomId, audio, duration }) => {
    const room = rooms.get(roomId);
    if (!room || room.status === 'waiting') return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;
    duration = Math.max(1, Math.min(60, parseInt(duration) || 1));
    io.to(roomId).emit('voice-message', {
      playerEmoji: player.emoji,
      playerName: player.name,
      audio,
      duration,
      timestamp: new Date().toISOString()
    });
  });

  // 断线处理（带宽限期，防止页面跳转时的竞态）
  socket.on('disconnect', () => {
    console.log(`[断线] ${socket.id}`);
    for (const [roomId, room] of rooms.entries()) {
      const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex === -1) continue;

      const player = room.players[playerIndex];

      if (room.status === 'waiting') {
        // 等待中直接移除，无需宽限期
        room.log.push(`${player.emoji} ${player.name} 离开了`);
        room.players.splice(playerIndex, 1);
        room.players.forEach((p, i) => { p.emoji = EMOJIS[i]; });
        if (room.hostId === socket.id && room.players.length > 0) {
          room.hostId = room.players[0].socketId;
        }
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          io.to(roomId).emit('room-update', getRoomPublicState(room));
        }
      } else if (room.status === 'playing') {
        // 游戏中：延迟处理，给重连留宽限期
        room.log.push(`${player.emoji} ${player.name} 断线了，等待重连...`);
        io.to(roomId).emit('room-update', getRoomPublicState(room));

        const timer = setTimeout(() => {
          disconnectTimers.delete(socket.id);
          // 宽限期结束，检查玩家是否已用新 socket 重连（socketId 已变）
          if (player.socketId !== socket.id) return;

          console.log(`[超时断线] ${player.name}`);
          const idx = room.players.findIndex(p => p.socketId === socket.id);
          if (idx === -1 || room.status !== 'playing') return;

          player.finishOrder = room.players.filter(p => p.isFinished).length + 1;
          player.isFinished = true;
          room.log[room.log.length - 1] = `${player.emoji} ${player.name} 断线，已退出游戏`;

          if (room.players.every(p => p.isFinished)) {
            finishGame(room, roomId);
          } else {
            if (room.currentTurnIndex === idx) nextTurn(room);
            if (room.status === 'finished') {
              finishGame(room, roomId);
            } else {
              io.to(roomId).emit('room-update', getRoomPublicState(room));
            }
          }
        }, REJOIN_GRACE_MS);

        disconnectTimers.set(socket.id, timer);
      }
      break;
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`情侣飞行棋服务器启动 -> http://0.0.0.0:${PORT}`);
});
