# 情侣飞行棋 💕

Web-based multiplayer board game with real-time synchronization. 2–4 players share a room ID and take turns rolling a dice to advance along an 80-cell track, completing tasks along the way.

## Features

- **Real-time multiplayer** — 2–4 players per room via Socket.io
- **Custom rooms** — create or join by room ID; host controls start/reset/destroy
- **80-cell task board** — each cell has a task loaded from `data/tasks.json`
- **Smooth animations** — emoji pieces fly between cells with spring easing
- **Real-time chat** — text messages with bubble UI
- **Voice messages** — press-and-hold 🎤 to record (up to 60s), tap ▶ to play
- **Responsive** — works on desktop and mobile

## Quick Start

```bash
npm install
npm start
# Open http://localhost:3000
```

## Deploy

```bash
bash deploy.sh
```

Pushes to GitHub, then SSHes into the production server to pull, install, and restart the service.

## Architecture

```
fly_game/
├── server.js          # Express + Socket.io backend (all game logic)
├── deploy.sh          # One-click deploy script
├── data/
│   └── tasks.json     # 80-cell task definitions
└── public/
    ├── index.html     # Lobby (join / create room)
    ├── game.html      # Game board
    ├── game.js        # Frontend logic
    └── style.css      # Styles
```

All game logic (dice, positions, turn order, END detection) runs on the server. Clients only send events and render received state.

## Game Rules

1. Join or create a room (2–4 players)
2. Host clicks **Start**
3. On your turn, tap 🎲 to roll (1–6) and advance
4. Land on a cell → complete the displayed task
5. Cells 75–80 are END cells — landing on one eliminates that player
6. Last player eliminated loses; rankings are shown when all finish

## Task Configuration

Edit `data/tasks.json` to customize the 80 cells. Restart the server after editing.

```json
[
  { "id": 1, "content": "任务描述", "hasEnd": false },
  { "id": 80, "content": "终点任务", "hasEnd": true }
]
```

Cells 75–80 must have `"hasEnd": true`.

## Tech Stack

- **Backend**: Node.js, Express, Socket.io
- **Frontend**: Vanilla JS, CSS custom properties, Socket.io client
- **Audio**: Web MediaRecorder API (webm/opus → webm → wav fallback)
