#!/usr/bin/env bash
# T13 多项目共存只读预演（复制真实工作区到临时目录再跑，不动真实工作区）
set -u
cd "$(dirname "$0")/.." || exit 1
node scripts/rehearse-t13.mjs "$@"
