# 情侣飞行棋

一款基于 Web 的多人实时棋盘游戏，专为情侣设计。2-4 名玩家通过共享房间 ID 加入，轮流掷骰子在 80 格赛道上前进，每个格子都有专属的互动任务。落在终点格（75-80）的玩家完成旅程，所有人完成后游戏结束并公布排名。

## 功能特性

- 实时多人联机（Socket.io）
- 2-4 人房间，自定义房间 ID
- 80 格赛道，每格直接显示任务内容
- 掷骰子后弹窗展示完整任务
- 终点格淘汰机制 + 排名结算
- 断线重连支持（8 秒宽限期）
- 房主可重置游戏或解散房间
- 响应式布局，支持移动端

## 快速开始

```bash
# 安装依赖
npm install

# 启动服务器
npm start

# 访问
open http://localhost:3000
```

云端部署时自动读取 `process.env.PORT`。

## 项目结构

```
fly_game/
├── server.js          # Node.js 后端：Express + Socket.io
├── package.json
├── data/
│   └── tasks.json     # 80 格任务配置
└── public/
    ├── index.html     # 大厅页：创建/加入房间
    ├── game.html      # 游戏页面
    ├── game.js        # 前端逻辑
    └── style.css      # 样式
```

## 任务配置

编辑 `data/tasks.json` 自定义每格任务，格式如下：

```json
[
  { "id": 1, "content": "任务描述", "hasEnd": false },
  { "id": 80, "content": "终点任务", "hasEnd": true }
]
```

第 75-80 格需设置 `"hasEnd": true`，修改后重启服务器生效。

## 技术栈

- **后端**：Node.js、Express、Socket.io
- **前端**：原生 HTML / CSS / JavaScript
- **通信**：WebSocket（Socket.io）
