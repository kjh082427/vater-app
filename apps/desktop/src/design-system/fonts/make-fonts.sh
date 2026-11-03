#!/usr/bin/env bash
# 디자인 시스템 글꼴을 다시 만드는 방법. 빌드 때 실행하지 않는다(결과 woff2를 커밋해 둔다).
# 필요: Node(npm).
#
# 1) Pretendard 1.3.9: 저작자가 배포한 공식 서브셋 woff2(한글 2,780자)를 그대로 쓴다.
#    Pretendard는 OFL의 "예약 글꼴 이름(Reserved Font Name)"이 있어서, 우리가 직접 서브셋하면
#    이름을 바꿔야 한다. 공식 서브셋은 수정본이 아니므로 이름을 그대로 쓸 수 있다.
# (예전에 쓰던 명조 Hahmlet은 대시보드 개편 때 뺐다. 다시 필요하면 git 기록의 이 파일을 본다.)
set -euo pipefail

OUT="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PRETENDARD_VERSION=1.3.9

# Pretendard
(cd "$WORK" && npm pack "pretendard@${PRETENDARD_VERSION}" --silent >/dev/null && tar xzf "pretendard-${PRETENDARD_VERSION}.tgz")
for w in Regular Medium SemiBold Bold; do
  cp "$WORK/package/dist/web/static/woff2-subset/Pretendard-${w}.subset.woff2" "$OUT/"
done
cp "$WORK/package/dist/LICENSE.txt" "$OUT/LICENSE-Pretendard.txt"

ls -l "$OUT"/*.woff2
