#!/usr/bin/env bash
set -euo pipefail
ADB="${ADB:-adb}"
APK="${1:-apk/app-debug.apk}"
$ADB wait-for-device
$ADB install -r "$APK"
$ADB shell appops set --uid com.kitefiles.android MANAGE_EXTERNAL_STORAGE allow
$ADB shell run-as com.kitefiles.android mkdir -p /sdcard/A_KiteFilesProbe
$ADB shell run-as com.kitefiles.android touch /sdcard/A_KiteFilesProbe/probe.txt
$ADB shell am start -n com.kitefiles.android/.MainActivity
sleep 5
TMP_DIR="${RUNNER_TEMP:-/tmp}"
UI_XML="$TMP_DIR/kitefiles-ui.xml"
get_ui() {
  $ADB shell uiautomator dump /sdcard/kitefiles-ui.xml >/dev/null 2>&1
  $ADB pull /sdcard/kitefiles-ui.xml "$UI_XML" >/dev/null 2>&1
}
get_xy() {
  python3 - "$UI_XML" "$1" <<'PY'
import sys, re, xml.etree.ElementTree as ET
p,needle=sys.argv[1:]
root=ET.parse(p).getroot()
for n in root.iter('node'):
    if (n.attrib.get('text') or '') == needle:
        m=re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]',n.attrib.get('bounds',''))
        if m:
            x1,y1,x2,y2=map(int,m.groups())
            print((x1+x2)//2, (y1+y2)//2)
            sys.exit(0)
sys.exit(1)
PY
}
wait_for_text() {
  local needle="$1" coords i
  for i in 1 2 3 4 5 6; do
    get_ui
    coords="$(get_xy "$needle" || true)"
    if [[ -n "$coords" ]]; then echo "Visible: $needle at $coords"; return 0; fi
    sleep 2
  done
  echo "MISSING UI LABEL: $needle" >&2
  cat "$UI_XML" >&2
  return 1
}
tap_text() {
  local coords
  wait_for_text "$1"
  coords="$(get_xy "$1")"
  $ADB shell input tap $coords
  sleep 2
}
trap '$ADB exec-out screencap -p > "$PWD/kitefiles-ui-smoke.png" || true' EXIT
wait_for_text '내부 저장소'
tap_text '내부 저장소'
wait_for_text 'A_KiteFilesProbe'
tap_text 'A_KiteFilesProbe'
wait_for_text 'probe.txt'
tap_text '+ 새 창'
wait_for_text 'A_KiteFilesProbe'
read -r WIDTH HEIGHT <<< "$($ADB shell wm size | grep -o '[0-9]*x[0-9]*' | head -1 | tr x ' ')"
Y=$((HEIGHT*65/100))
$ADB shell input swipe $((WIDTH*20/100)) "$Y" $((WIDTH*80/100)) "$Y" 400
wait_for_text 'probe.txt'
echo 'ANDROID UI SMOKE RESULT: storage, folders, new tab, swipe PASS'
