#!/bin/bash
# 剧本快速部署：仅推送剧本文件变更并重启服务（跳过 npm install）
set -e

echo ">>> 推送剧本更新到 GitHub..."
git push origin main

echo ">>> 同步剧本到服务器并重启服务..."
ssh -p 22 ubuntu@h1.tomatochen.top '
  export PATH="/home/ubuntu/.nvm/versions/node/v24.13.0/bin:$PATH"
  cd /home/ubuntu/fly_game
  git pull
  sudo systemctl restart fly_game
  echo "剧本部署完成！"
'
