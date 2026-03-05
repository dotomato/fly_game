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

# Access at http://localhost:3000
# Cloud: automatically uses process.env.PORT
```

## Architecture

```
fly_game/
├── server.js          # Node.js backend: Express + Socket.io
├── package.json
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

## Frontend Navigation Flow

`index.html` (join form) → Socket `join-room` → waiting room UI → host clicks start → Socket `game-started` → redirect to `game.html?roomId=&name=&idx=`

`game.html` loads `game.js` which re-emits `join-room` on reconnect (to handle page refresh).
