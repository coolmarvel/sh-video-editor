#!/usr/bin/env bash
# PostToolUse(Edit|Write) 훅: 방금 편집한 파일을 포맷한다. ts/js/json/css/html/md 는 Prettier, rs 는 rustfmt.
# 실패해도 작업을 막지 않는다. 이식한 엔진(packages/engine/vendor)은 손대지 않는다(상류 diff 보존).
set -u
file=$(python3 -c "import json,os,sys; d=json.load(sys.stdin) if not sys.stdin.isatty() else {}; print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null)
[ -z "${file:-}" ] && exit 0
[ -f "$file" ] || exit 0
case "$file" in
  */packages/engine/vendor/*) exit 0 ;;
esac
root="$(cd "$(dirname "$0")/../.." && pwd)"
case "$file" in
  *.rs)
    command -v rustfmt >/dev/null 2>&1 && rustfmt --edition 2024 "$file" >/dev/null 2>&1 || true ;;
  *.ts|*.tsx|*.js|*.mjs|*.cjs|*.json|*.css|*.html|*.md)
    [ -x "$root/node_modules/.bin/prettier" ] && "$root/node_modules/.bin/prettier" --write --log-level warn "$file" >/dev/null 2>&1 || true ;;
esac
exit 0
