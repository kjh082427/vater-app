#!/usr/bin/env bash
# 디자인 시스템 글꼴을 다시 만드는 방법. 빌드 때 실행하지 않는다(결과 woff2를 커밋해 둔다).
# 필요: Node(npm), uv(uvx). fonttools와 brotli는 uvx가 임시 환경에서만 받는다.
#
# 1) Pretendard 1.3.9: 저작자가 배포한 공식 서브셋 woff2(한글 2,780자)를 그대로 쓴다.
#    Pretendard는 OFL의 "예약 글꼴 이름(Reserved Font Name)"이 있어서, 우리가 직접 서브셋하면
#    이름을 바꿔야 한다. 공식 서브셋은 수정본이 아니므로 이름을 그대로 쓸 수 있다.
# 2) Hahmlet: google/fonts의 가변 TTF(3.4MB)를 굵기 400~700으로 줄이고(varLib.instancer)
#    화면에 필요한 글자만 남겨(pyftsubset) woff2로 바꾼다. Hahmlet은 예약 이름이 없다.
set -euo pipefail

OUT="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PRETENDARD_VERSION=1.3.9
HAHMLET_COMMIT=afb3b9481d0a9a6be66bd779417b48ebcfd437bc # google/fonts, ofl/hahmlet 마지막 변경
HAHMLET_TTF_SHA256=892bffe530255770a7435226154a02f519055ff6bedf64254f37f21d15a59279

# 기본 라틴, 라틴-1, 일반 문장부호(– — ‘ ’ “ ” … ·), 원 기호, 화살표, 빼기 기호(U+2212),
# 원문자 ①~⑳, ▲▼, CJK 기호, 호환 자모(입력 중 조합 글자), 한글 음절, 전각 문자
UNICODES="U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030,U+2032-2033,U+2039-203A,U+20A9,U+2190-2193,U+2212,U+2460-2473,U+25B2,U+25BC,U+3000-303F,U+3131-318E,U+AC00-D7A3,U+FF01-FF5E"

# Pretendard
(cd "$WORK" && npm pack "pretendard@${PRETENDARD_VERSION}" --silent >/dev/null && tar xzf "pretendard-${PRETENDARD_VERSION}.tgz")
for w in Regular Medium SemiBold Bold; do
  cp "$WORK/package/dist/web/static/woff2-subset/Pretendard-${w}.subset.woff2" "$OUT/"
done
cp "$WORK/package/dist/LICENSE.txt" "$OUT/LICENSE-Pretendard.txt"

# Hahmlet
base="https://raw.githubusercontent.com/google/fonts/${HAHMLET_COMMIT}/ofl/hahmlet"
curl -sSfL -o "$WORK/Hahmlet.ttf" "${base}/Hahmlet%5Bwght%5D.ttf"
echo "${HAHMLET_TTF_SHA256}  $WORK/Hahmlet.ttf" | sha256sum -c -
curl -sSfL -o "$OUT/LICENSE-Hahmlet.txt" "${base}/OFL.txt"
uvx --from fonttools --with brotli fonttools varLib.instancer "$WORK/Hahmlet.ttf" wght=400:700 -o "$WORK/Hahmlet-400-700.ttf"
uvx --from fonttools --with brotli pyftsubset "$WORK/Hahmlet-400-700.ttf" \
  --unicodes="$UNICODES" --layout-features='*' --flavor=woff2 \
  --output-file="$OUT/Hahmlet-400-700.subset.woff2"

ls -l "$OUT"/*.woff2
