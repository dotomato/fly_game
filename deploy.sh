#!/bin/bash
# 一键部署：推送代码到 GitHub，再同步到服务器并重启服务
set -e

echo ">>> 推送代码到 GitHub..."
git push origin main

echo ">>> 同步到服务器并重启服务..."
ssh -p 22 ubuntu@h1.tomatochen.top '
  export PATH="/home/ubuntu/.nvm/versions/node/v24.13.0/bin:$PATH"
  cd /home/ubuntu/fly_game
  git pull
  npm install --production
  sudo systemctl restart fly_game
  echo "部署完成！"
'
