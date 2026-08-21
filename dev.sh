#!/usr/bin/env bash
# dev.sh - DeepSeek Harness 本地开发脚本
# 用法:
#   sh dev.sh -i    安装依赖(pnpm install)
#   sh dev.sh -b    构建(pnpm run build)
#   sh dev.sh -r    运行(默认:先杀掉 3080 端口进程,再 pnpm dsh --profile web)
#   sh dev.sh -i -b -r   组合使用,按顺序执行
set -euo pipefail

# dsh web 默认端口(与 web-app bundle 的 webserver 配置一致)
PORT=3080

install_deps() {
  echo "==> pnpm install"
  pnpm install
}

build() {
  echo "==> pnpm run build"
  pnpm run build
}

run() {
  # 先杀掉占用端口的进程(忽略未占用的情形)
  local pids
  pids=$(lsof -ti :"$PORT" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "==> 杀掉占用 ${PORT} 端口的进程: $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    # 仍未退出的强制杀
    pids=$(lsof -ti :"$PORT" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
      sleep 1
    fi
  else
    echo "==> 端口 ${PORT} 空闲"
  fi
  echo "==> pnpm dsh --profile web"
  exec pnpm dsh --profile web
}

# 无参数时默认运行
if [ $# -eq 0 ]; then
  run
  exit 0
fi

while getopts ":ibr" opt; do
  case "$opt" in
    i) install_deps ;;
    b) build ;;
    r) run ;;
    \?) echo "未知选项: -$OPTARG(可用: -i 安装 / -b 构建 / -r 运行)" >&2; exit 1 ;;
  esac
done
