#!/bin/bash
# 剧本快速部署：自动提交 data/scripts/ 下的所有变更并重启服务（跳过 npm install）
set -e

echo ">>> 检查剧本变更..."
git add data/scripts/

# 如果没有变更则退出
if git diff --cached --quiet; then
  echo "没有剧本变更，无需部署。"
  exit 0
fi

# 列出变更文件
echo "变更文件："
git diff --cached --name-only

git commit -m "update: 更新剧本内容"

echo ">>> 推送到 GitHub..."
git push origin main

echo ">>> 同步到服务器并重启服务..."
ssh -p 22 ubuntu@h1.tomatochen.top '
  export PATH="/home/ubuntu/.nvm/versions/node/v24.13.0/bin:$PATH"
  cd /home/ubuntu/fly_game
  git pull
  sudo systemctl restart fly_game
  echo "剧本部署完成！"
'
