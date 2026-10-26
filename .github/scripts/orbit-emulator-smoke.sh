#!/usr/bin/env bash
set -euo pipefail
adb install -r orbit-apk/app-debug.apk
adb shell appops set dev.orbit.files MANAGE_EXTERNAL_STORAGE allow
adb shell appops set --uid dev.orbit.files MANAGE_EXTERNAL_STORAGE allow
adb shell appops get dev.orbit.files MANAGE_EXTERNAL_STORAGE
adb shell appops get --uid dev.orbit.files MANAGE_EXTERNAL_STORAGE
adb shell mkdir -p /sdcard/Download
adb shell 'echo orbit-test > /sdcard/Download/orbit-ci-sample.txt'
adb shell am start -n dev.orbit.files/.MainActivity
sleep 6
adb shell pidof dev.orbit.files
adb shell uiautomator dump /sdcard/window.xml
adb pull /sdcard/window.xml orbit-ui.xml
adb shell screencap -p /sdcard/orbit-home.png
adb pull /sdcard/orbit-home.png orbit-home.png
grep -q 'Orbit Files' orbit-ui.xml
if ! grep -q '내부 저장소' orbit-ui.xml; then
  echo 'ERROR: all-files permission not enabled in disposable emulator'
  adb shell dumpsys package dev.orbit.files | grep -A 8 -B 3 MANAGE_EXTERNAL_STORAGE || true
  exit 1
fi
# Locate accessible root via view bounds and enter its folder.
python3 - <<'PY' > /tmp/orbit-tap
import xml.etree.ElementTree as ET,re
r=ET.parse('orbit-ui.xml').getroot()
for n in r.iter('node'):
 if '내부 저장소' in n.get('text','') and n.get('bounds'):
  a=list(map(int,re.findall(r'\d+',n.get('bounds')))); print((a[0]+a[2])//2,(a[1]+a[3])//2);break
else: raise Exception('Local storage entry not found')
PY
read -r x y < /tmp/orbit-tap
adb shell input tap "$x" "$y"
sleep 5
adb shell uiautomator dump /sdcard/window.xml
adb pull /sdcard/window.xml orbit-ui.xml
grep -q '탭 ' orbit-ui.xml
python3 - <<'PY' > /tmp/orbit-tap
import xml.etree.ElementTree as ET,re
r=ET.parse('orbit-ui.xml').getroot()
buttons=[n for n in r.iter('node') if n.get('class')=='android.widget.Button' and n.get('text')=='+']
assert buttons,'New tab button missing'
a=list(map(int,re.findall(r'\d+',buttons[-1].get('bounds')))); print((a[0]+a[2])//2,(a[1]+a[3])//2)
PY
read -r x y < /tmp/orbit-tap
adb shell input tap "$x" "$y"
sleep 4
adb shell uiautomator dump /sdcard/window.xml
adb pull /sdcard/window.xml orbit-ui.xml
grep -q '탭 3' orbit-ui.xml
adb shell screencap -p /sdcard/orbit-tabs.png
adb pull /sdcard/orbit-tabs.png orbit-tabs.png
adb shell pidof dev.orbit.files
adb logcat -d -s AndroidRuntime:E > orbit-android-errors.log
if grep -q 'FATAL EXCEPTION' orbit-android-errors.log; then
 cat orbit-android-errors.log; exit 1
fi
echo 'PASS: app launch, permission, shared storage browsing, new tab and no crash'
