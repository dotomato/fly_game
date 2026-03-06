/**
 * game-logic.js
 * 游戏核心纯函数 —— 不依赖 Socket.io / 文件系统，可直接单元测试。
 *
 * server.js 通过 require('./game-logic') 引入这些函数，
 * 避免重复实现同一段逻辑。
 */

'use strict';

const EMOJIS = ['❤️', '💙', '💚', '💛'];

// ─────────────────────────────────────────────
// 工厂函数
// ─────────────────────────────────────────────

/**
 * 创建一个新房间对象（尚未存入 Map，方便测试直接构造）
 */
function createRoom({ roomId, hostId, maxPlayers = 4, scriptId = 'couples' }) {
  return {
    id: roomId,
    hostId,
    maxPlayers: Math.min(Math.max(parseInt(maxPlayers) || 4, 2), 4),
    scriptId,
    players: [],
    currentTurnIndex: 0,
    status: 'waiting',
    waitingConfirm: false,
    log: [],
    chatMessages: []
  };
}

/**
 * 向房间添加一名玩家，返回玩家对象。
 * 若房间已满或状态不对则返回 null（并在 reason 字段说明原因）。
 */
function addPlayer(room, { socketId, playerName }) {
  if (room.status !== 'waiting') {
    return { player: null, reason: '游戏已在进行中，无法加入' };
  }
  if (room.players.length >= room.maxPlayers) {
    return { player: null, reason: '房间已满，请换一个房间ID' };
  }
  const player = {
    socketId,
    name: playerName,
    emoji: EMOJIS[room.players.length],
    position: 0,
    isFinished: false,
    finishOrder: null
  };
  room.players.push(player);
  room.log.push(`${player.emoji} ${player.name} 加入了房间`);
  return { player, reason: null };
}

// ─────────────────────────────────────────────
// 状态序列化
// ─────────────────────────────────────────────

/**
 * 返回可安全广播给客户端的房间公开状态（隐去内部字段）
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
    log: room.log.slice(-20)
  };
}

// ─────────────────────────────────────────────
// 回合管理
// ─────────────────────────────────────────────

/**
 * 将 currentTurnIndex 推进到下一个"未完成"的玩家。
 * 若所有玩家均已完成，则将 room.status 设为 'finished'。
 */
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

// ─────────────────────────────────────────────
// 骰子 & 位置计算
// ─────────────────────────────────────────────

/**
 * 计算掷骰子后的新位置（上限 = maxPosition）
 */
function calcNewPosition(oldPosition, diceValue, maxPosition) {
  return Math.min(oldPosition + diceValue, maxPosition);
}

/**
 * 对当前玩家执行掷骰子逻辑（纯状态更新，不广播）。
 *
 * @param {object} room          房间对象（会被修改）
 * @param {number} diceValue     骰子点数 1-6
 * @param {number} maxPosition   剧本总格数
 * @param {object} task          当前格任务对象（可为 null）
 * @returns {{ newPosition, oldPosition, justFinished, allFinished }}
 */
function applyDiceRoll(room, diceValue, maxPosition, task) {
  const currentPlayer = room.players[room.currentTurnIndex];
  const oldPosition = currentPlayer.position;
  const newPosition = calcNewPosition(oldPosition, diceValue, maxPosition);

  currentPlayer.position = newPosition;

  let justFinished = false;
  if (newPosition === maxPosition && !currentPlayer.isFinished) {
    currentPlayer.finishOrder = room.players.filter(p => p.isFinished).length + 1;
    currentPlayer.isFinished = true;
    justFinished = true;
    room.log.push(
      `${currentPlayer.emoji} ${currentPlayer.name} 掷出 ${diceValue}，到达第 ${newPosition} 格，完成旅程！🎉`
    );
  } else {
    room.log.push(
      `${currentPlayer.emoji} ${currentPlayer.name} 掷出 ${diceValue}，` +
      `${oldPosition === 0 ? '出发' : `从第 ${oldPosition} 格`}前进到第 ${newPosition} 格`
    );
  }

  room.waitingConfirm = true;

  const allFinished = room.players.every(p => p.isFinished);
  return { newPosition, oldPosition, justFinished, allFinished };
}

// ─────────────────────────────────────────────
// 游戏结束
// ─────────────────────────────────────────────

/**
 * 将房间置为 finished 状态并生成排名数组（纯状态更新，不广播）。
 * 调用方负责向客户端广播 'game-over' 事件。
 *
 * @returns {Array} rankings  [{name, emoji, order}, ...]
 */
function buildGameOver(room) {
  room.status = 'finished';
  room.waitingConfirm = false;
  room.log.push('🎊 所有玩家完成旅程！游戏结束！');
  return room.players
    .filter(p => p.isFinished)
    .sort((a, b) => a.finishOrder - b.finishOrder)
    .map(p => ({ name: p.name, emoji: p.emoji, order: p.finishOrder }));
}

// ─────────────────────────────────────────────
// 重置
// ─────────────────────────────────────────────

/**
 * 将所有玩家和房间状态恢复到游戏开始前（保留玩家列表）
 */
function resetRoom(room) {
  room.players.forEach(p => {
    p.position = 0;
    p.isFinished = false;
    p.finishOrder = null;
  });
  room.currentTurnIndex = 0;
  room.waitingConfirm = false;
  room.status = 'playing';
  room.log = ['游戏重置，再来一局！'];
  room.chatMessages = [];
}

// ─────────────────────────────────────────────
// 断线处理辅助
// ─────────────────────────────────────────────

/**
 * 将指定玩家标记为已退出（断线超时后调用）。
 * 返回是否所有玩家均已完成。
 */
function markPlayerDisconnected(room, player) {
  player.finishOrder = room.players.filter(p => p.isFinished).length + 1;
  player.isFinished = true;
  return room.players.every(p => p.isFinished);
}

module.exports = {
  EMOJIS,
  createRoom,
  addPlayer,
  getRoomPublicState,
  nextTurn,
  calcNewPosition,
  applyDiceRoll,
  buildGameOver,
  resetRoom,
  markPlayerDisconnected
};
