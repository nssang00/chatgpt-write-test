#!/usr/bin/env bash
set -euo pipefail
adb wait-for-device
DIR="${RUNNER_TEMP:-/tmp}"
get_ui() {
  adb shell uiautomator dump /sdcard/kf-v22.xml >/dev/null 2>&1
  adb pull /sdcard/kf-v22.xml "$DIR/kf-v22.xml" >/dev/null 2>&1
}
get_xy() {
  python3 - "$DIR/kf-v22.xml" "$1" <<'PY'
import re,sys,xml.etree.ElementTree as ET
root=ET.parse(sys.argv[1]).getroot()
needle=sys.argv[2]
for node in root.iter('node'):
    if any(needle in node.attrib.get(k,'') for k in ('text','content-desc')):
        m=re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]',node.attrib.get('bounds',''))
        if m:
            a,b,c,d=map(int,m.groups())
            print((a+c)//2,(b+d)//2)
            sys.exit(0)
sys.exit(1)
PY
}
wait_for() {
  local value="$1" n coords
  for n in 1 2 3 4 5 6 7; do
    get_ui
    coords="$(get_xy "$value" || true)"
    if [[ -n "$coords" ]]; then echo "UI visible: $value ($coords)"; return 0; fi
    sleep 2
  done
  echo "MISSING UI: $value" >&2; cat "$DIR/kf-v22.xml" >&2; return 1
}
tap_label() {
  wait_for "$1"
  adb shell input tap $(get_xy "$1")
  sleep 2
}
wait_for '옵션'
tap_label '옵션'
for item in '분석' '모두 선택' '속성' '보기 옵션' '필터' '폴더 옵션' '작업'; do
  wait_for "$item"
done
adb exec-out screencap -p > "$PWD/kitefiles-options-menu.png"
tap_label '보기 옵션'
wait_for '간격:'
adb shell input keyevent KEYCODE_BACK
sleep 1
tap_label '옵션'
tap_label '폴더 옵션'
wait_for '숨김 파일 표시'
adb shell input keyevent KEYCODE_BACK
echo 'KITEFILES V2.2 UI RESULT: right-side overflow, view options, folder options PASS'
