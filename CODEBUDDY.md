# CODEBUDDY.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

## Project Overview

Web-based multiplayer board game ("情侣飞行棋" / Couples Ludo) with real-time synchronization. 2-4 players join by sharing a room link. Players take turns rolling a dice (1-6) and advance along an 80-cell linear track. Each cell displays a task from a script config file. Cells with `hasEnd: true` eliminate that player; the game ends when all players have been eliminated.

## Commands

```bash
# Install dependencies
npm install

# Start server
node server.js
# or
npm start

# Deploy to production server
bash deploy.sh

# Access at http://localhost:3000
# Cloud: automatically uses process.env.PORT
```

## Architecture

```
fly_game/
├── server.js          # Node.js backend: Express + Socket.io
├── package.json
├── deploy.sh          # One-click deploy: git push + SSH pull + systemctl restart
├── data/
│   ├── scripts/       # Script task configs (JSON, one file per script)
│   │   ├── couples.json
│   │   ├── couples_ntr.json
│   │   └── ntr_extreme.json
│   └── chat_logs/     # Per-game chat logs saved on game-over (auto-created)
└── public/            # Static frontend (served by Express)
    ├── index.html     # Lobby: room create/join form + waiting room
    ├── game.html      # Game board UI shell
    ├── game.js        # Frontend logic
    └── style.css      # Styles (CSS variables, responsive)
```

## Key Design Decisions

**Authoritative server**: All game logic (dice roll, position calculation, turn rotation, END detection) runs on the server. Clients only emit events and render received state.

**Room lifecycle**: `waiting` → `playing` → `finished`. Only the host (first joiner) can start. Room is stored in-memory in a `Map<roomId, RoomState>`. Rooms are not persisted across restarts.

**Room ID**: Auto-generated 6-char uppercase random ID on the lobby. Shared via a `?room=xxx` URL param. When a player opens a share link, the room ID is pre-filled and script selection is hidden.

**Player state** per player: `{ socketId, name, emoji, position, isFinished, finishOrder }`. Emoji is chosen by the player from an allowlist of 40+ options (animals, plants, food). Duplicate emojis are rejected; server falls back to first unused emoji.

**Host always goes first**: `currentTurnIndex` is set to the host's index at game start and reset.

**END mechanic**: Cells 75-80 all have `hasEnd: true`. When a player lands on such a cell and clicks confirm, `isFinished` is set, `finishOrder` is recorded, and the turn advances. When all players are finished, `game-over` is broadcast. No score popup — game simply ends in place.

**Disconnect handling**:
- Both `waiting` and `playing` states use a **5-minute grace period** (`REJOIN_GRACE_MS = 5 * 60 * 1000`) before removing/eliminating the player.
- Reconnection is matched by **player name**. On reconnect, `socketId` and `hostId` (if applicable) are updated atomically.
- `index.html`: On Socket.io `connect` event, if `myRoomId` and `joinSent` are set, automatically re-emits `join-room` (handles mobile background → foreground switch).
- `game.js`: On Socket.io `connect` event, always re-emits `join-room` with URL params.

**Chat system**: In-memory only (`room.chatMessages[]`, max 200 entries). Text messages via `chat-message` event. Voice messages via `voice-message` event — audio transmitted as binary (ArrayBuffer) through Socket.io, relayed by server without storage. System messages (game start, dice results, game end) are also pushed to `chatMessages`.

**Chat log persistence**: On `finishGame()`, the full `chatMessages` array plus player list and metadata is written to `data/chat_logs/{ISO_timestamp}_{roomId}.json`.

**Socket.io config**: `pingTimeout: 2 * 60 * 1000`, `pingInterval: 25000` — extended to reduce spurious disconnects on mobile.

## Socket.io Event Reference

| Event | Direction | Payload |
|-------|-----------|---------|
| `join-room` | client → server | `{ roomId, playerName, maxPlayers, scriptId, emoji, joinOnly }` |
| `joined` | server → client | `{ roomId, playerIndex }` |
| `room-update` | server → client | full `RoomPublicState` |
| `start-game` | client → server | `{ roomId }` |
| `game-started` | server → all | full `RoomPublicState` |
| `roll-dice` | client → server | `{ roomId }` |
| `dice-result` | server → all | `{ diceValue, newPosition, task, justFinished, roomState, ... }` |
| `confirm-done` | client → server | `{ roomId }` |
| `game-over` | server → all | `{ rankings, roomState }` |
| `chat-message` | client → server | `{ roomId, message }` |
| `chat-message` | server → all | `{ playerEmoji, playerName, message, timestamp }` |
| `voice-message` | client → server | `{ roomId, audio: ArrayBuffer, duration }` |
| `voice-message` | server → all | `{ playerEmoji, playerName, audio: Buffer, duration, timestamp }` |
| `reset-game` | client → server | `{ roomId }` |
| `destroy-room` | client → server | `{ roomId }` |
| `room-destroyed` | server → all | `{ message }` |
| `error` | server → client | `{ message }` |

## Script Config Format (`data/scripts/*.json`)

```json
[
  { "id": 1, "content": "任务描述", "hasEnd": false },
  ...
  { "id": 80, "content": "终点任务", "hasEnd": true }
]
```

Cells 75-80 must have `"hasEnd": true`. Server reads all script files at startup from the `SCRIPTS` array; restart required after editing. To add a new script, register it in the `SCRIPTS` array at the top of `server.js`.

## Frontend Layout (game.html)

```
game-layout (flex column, 100vh)
├── game-header          # 💕 emoji + turn indicator + ⟳ reconnect + ← home buttons
│                        # Mobile: title text hidden, only emoji shown
└── game-body (flex row)
    ├── board-area (flex column)
    │   ├── board-scroll-container   # Horizontal scrolling board track
    │   ├── action-bar               # Roll button (🎲) + task detail bar
    │   └── chat-box                 # Always-open chat (text + voice + save button)
    └── side-panel                   # Player list, host controls, game log (hidden on mobile)
```

## Frontend Navigation Flow

`index.html` (join form) → Socket `join-room` → waiting room UI → host clicks start → Socket `game-started` → redirect to `game.html?roomId=&name=&idx=`

`game.html` loads `game.js` which re-emits `join-room` on every `connect` event (handles page refresh and mobile reconnect).

Share link flow: `?room=xxx` param → script selector hidden, room ID pre-filled, button shows "加入房间" → on `joined`, cookie `lastRoomId` saved for potential reconnect.

## Reconnect Flow

- **In game (`game.html`)**: `connect` event → auto re-emit `join-room` with URL params. Server matches by name, cancels grace period timer, updates socketId + hostId.
- **In waiting room (`index.html`)**: `connect` event → if `myRoomId` set and `joinSent=true`, auto re-emit `join-room`. Handles mobile background/foreground switch.
- **Grace period**: 5 minutes for both `waiting` and `playing` states. After timeout, player is removed (waiting) or marked finished (playing).

## Voice Message Implementation

- **Recording**: `MediaRecorder` API, press-and-hold the 🎤 button (max 60s). Format priority: `audio/webm;codecs=opus` → `audio/webm` → `audio/wav`.
- **Transmission**: `blob.arrayBuffer()` → emit as binary via Socket.io (no base64 overhead). Server relays without storing.
- **Playback**: `URL.createObjectURL(new Blob([audio]))` → `new Audio(url).play()`. URL revoked on end to prevent memory leaks.
- **UI**: Custom voice bubble with animated wave bars and duration label. Requires HTTPS or localhost for `getUserMedia`.

## Animation Details

- **Emoji flight**: `position:fixed` clone escapes `overflow:hidden` board container. Instant scroll (`behavior:'instant'`) before `getBoundingClientRect()` prevents race condition with smooth scroll.
- **Dice roll**: `@keyframes diceRoll` on `.roll-fab.rolling`.
- **Cell highlight**: `.active-cell` (current turn player) + `.my-cell` (local player's own cell, blue gradient).
- **Turn indicator**: `.turn-indicator.my-turn` uses `@keyframes myTurnPulse` — scale + box-shadow ripple, 1.2s loop.

## Server Logging

Format: `[事件类型] socketId  玩家=emoji名字  房间=roomId  状态=status`

Key log tags: `[连接]`, `[断线]`, `[加入房间]`, `[重连]`, `[重新加入等待室]`, `[超时断线]`, `[创建房间]`, `[游戏开始]`

View logs on server: `journalctl -u fly_game -f`
