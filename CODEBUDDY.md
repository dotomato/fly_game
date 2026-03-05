# CODEBUDDY.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

## Project Overview

Web-based multiplayer board game ("情侣飞行棋" / Couples Ludo) with real-time synchronization. 2-4 players join by sharing a custom room ID. Players take turns rolling a dice (1-6) and advance along an 80-cell linear track. Each cell displays a task from a config file. Cells with `hasEnd: true` eliminate that player; the game ends when all players have been eliminated.

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
│   └── tasks.json     # 80-cell task configuration
└── public/            # Static frontend (served by Express)
    ├── index.html     # Lobby: room join/create + waiting room
    ├── game.html      # Game board UI shell
    ├── game.js        # Frontend logic
    └── style.css      # Styles (CSS variables, responsive)
```

## Key Design Decisions

**Authoritative server**: All game logic (dice roll, position calculation, turn rotation, END detection) runs on the server. Clients only emit events and render received state.

**Room lifecycle**: `waiting` → `playing` → `finished`. Only the host (first joiner) can start. Room is stored in-memory in a `Map<roomId, RoomState>`. Rooms are not persisted across restarts.

**Player state** per player: `{ socketId, name, emoji, position, isFinished, finishOrder }`. Emojis (❤️ 💙 💚 💛) are assigned by join order.

**END mechanic**: Cells 75-80 all have `hasEnd: true`. When a player lands on such a cell, `isFinished` is set, `finishOrder` is recorded, and the turn advances. When all players are finished, `game-over` is broadcast with a rankings array.

**Disconnect handling**: During `waiting` the player is removed; during `playing` the player is marked `isFinished` and their turn is skipped.

**Chat system**: In-memory only (`room.chatMessages[]`, max 100 entries). Text messages via `chat-message` event. Voice messages via `voice-message` event — audio transmitted as binary (ArrayBuffer) through Socket.io, relayed by server without storage.

## Socket.io Event Reference

| Event | Direction | Payload |
|-------|-----------|---------|
| `join-room` | client → server | `{ roomId, playerName, maxPlayers }` |
| `joined` | server → client | `{ roomId, playerIndex }` |
| `room-update` | server → client | full `RoomPublicState` |
| `start-game` | client → server | `{ roomId }` |
| `game-started` | server → all | full `RoomPublicState` |
| `roll-dice` | client → server | `{ roomId }` |
| `dice-result` | server → all | `{ diceValue, newPosition, task, justFinished, roomState, ... }` |
| `game-over` | server → all | `{ rankings, roomState }` |
| `chat-message` | client → server | `{ roomId, message }` |
| `chat-message` | server → all | `{ playerEmoji, playerName, message, timestamp }` |
| `voice-message` | client → server | `{ roomId, audio: ArrayBuffer, duration }` |
| `voice-message` | server → all | `{ playerEmoji, playerName, audio: Buffer, duration, timestamp }` |
| `reset-game` | client → server | `{ roomId }` |
| `destroy-room` | client → server | `{ roomId }` |
| `room-destroyed` | server → all | `{ message }` |
| `error` | server → client | `{ message }` |

## Task Config Format (`data/tasks.json`)

```json
[
  { "id": 1, "content": "任务描述", "hasEnd": false },
  ...
  { "id": 80, "content": "终点任务 [END]", "hasEnd": true }
]
```

Cells 75-80 must have `"hasEnd": true`. The server reads this file at startup; restart required after editing.

## Frontend Layout (game.html)

```
game-layout (flex column, 100vh)
├── game-header          # Title + turn indicator + home button
├── task-bar             # Full-width task detail (flex column: meta row + content row)
└── game-body (flex row)
    ├── board-area (flex column)
    │   ├── board-scroll-container   # Horizontal scrolling board track
    │   ├── dice-bar                 # Centered roll button (🎲)
    │   └── chat-box                 # Always-open chat (text + voice)
    └── side-panel                   # Player list, host controls, game log (hidden on mobile)
```

## Frontend Navigation Flow

`index.html` (join form) → Socket `join-room` → waiting room UI → host clicks start → Socket `game-started` → redirect to `game.html?roomId=&name=&idx=`

`game.html` loads `game.js` which re-emits `join-room` on reconnect (to handle page refresh).

## Voice Message Implementation

- **Recording**: `MediaRecorder` API, press-and-hold the 🎤 button (max 60s). Format priority: `audio/webm;codecs=opus` → `audio/webm` → `audio/wav`.
- **Transmission**: `blob.arrayBuffer()` → emit as binary via Socket.io (no base64 overhead). Server relays without storing.
- **Playback**: `URL.createObjectURL(new Blob([audio]))` → `new Audio(url).play()`. URL revoked on end to prevent memory leaks.
- **UI**: Custom voice bubble with animated wave bars and duration label. Requires HTTPS or localhost for `getUserMedia`.

## Animation Details

- **Emoji flight**: `position:fixed` clone escapes `overflow:hidden` board container. Instant scroll (`behavior:'instant'`) before `getBoundingClientRect()` prevents race condition with smooth scroll.
- **Dice roll**: `@keyframes diceRoll` on `.roll-fab.rolling` — no `translateY` needed since button is now in normal flow (not fixed).
- **Cell highlight**: `.active-cell` (current turn player) + `.my-cell` (local player's own cell, blue gradient).
