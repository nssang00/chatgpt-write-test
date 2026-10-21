#!/usr/bin/env bash
set -euo pipefail
APK=orbit-apk/app-debug.apk
adb install -r "$APK"
# All-files access is explicitly granted in this disposable test emulator only.
adb shell appops set dev.orbit.files MANAGE_EXTERNAL_STORAGE allow
adb shell mkdir -p /sdcard/Download
adb shell 'echo "orbit smoke fixture" > /sdcard/Download/orbit-ci-sample.txt'
adb shell am start -n dev.orbit.files/.MainActivity
sleep 7
adb shell pidof dev.orbit.files
adb shell uiautomator dump /sdcard/window.xml
adb pull /sdcard/window.xml orbit-ui.xml
adb shell screencap -p /sdcard/orbit-home.png
adb pull /sdcard/orbit-home.png orbit-home.png
# Android accessibility tree must include the home screen and available internal storage.
grep -q 'Orbit Files' orbit-ui.xml
grep -q '내부 저장소' orbit-ui.xml
# Find a UI node by its text and click its displayed center point.
tap_label() {
    local needle="$1" mode="${2:-contains}" bounds x y
    bounds="$(python3 - "$needle" "$mode" <<'PY'
import re,sys,xml.etree.ElementTree as ET
needle,mode=sys.argv[1:]
tree=ET.parse('orbit-ui.xml')
for node in tree.iter('node'):
    txt=node.get('text','')
    desc=node.get('content-desc','')
    match=(txt == needle or desc == needle) if mode == 'exact' else (needle in txt or needle in desc)
    if match:
        b=node.get('bounds','')
        if b:
            nums=[int(x) for x in re.findall(r'\d+',b)]
            if len(nums)==4:
                print((nums[0]+nums[2])//2,(nums[1]+nums[3])//2)
                sys.exit(0)
raise SystemExit('UI element not found: '+needle)
PY
)"
    read -r x y <<< "$bounds"
    adb shell input tap "$x" "$y"
}
# Open the internal storage and ensure the file-navigation tabs are present.
tap_label '내부 저장소'
sleep 5
adb shell uiautomator dump /sdcard/window.xml
adb pull /sdcard/window.xml orbit-ui.xml
grep -q '탭 ' orbit-ui.xml
# A new tab is created from the + control. UI tree contains more than one '+' button;
# use the last exact '+' button present in the file-browser view.
python3 - <<'PY' > /tmp/orbit-plus-coords
import re,xml.etree.ElementTree as ET
r=ET.parse('orbit-ui.xml').getroot()
buttons=[x for x in r.iter('node') if x.get('class')=='android.widget.Button' and x.get('text')=='+']
assert buttons, 'new tab button absent'
b=buttons[-1].get('bounds')
n=list(map(int,re.findall(r'\d+',b)))
print((n[0]+n[2])//2,(n[1]+n[3])//2)
PY
read -r x y < /tmp/orbit-plus-coords
adb shell input tap "$x" "$y"
sleep 4
adb shell uiautomator dump /sdcard/window.xml
adb pull /sdcard/window.xml orbit-ui.xml
grep -q '탭 3' orbit-ui.xml
adb shell screencap -p /sdcard/orbit-tabs.png
adb pull /sdcard/orbit-tabs.png orbit-tabs.png
# Validate that the foreground process is still alive and has not crashed.
adb shell pidof dev.orbit.files
adb logcat -d -s AndroidRuntime:E > orbit-android-errors.log
if grep -q 'FATAL EXCEPTION' orbit-android-errors.log; then
    cat orbit-android-errors.log
    exit 1
fi
echo 'PASS: emulator installed, home loaded, storage browsed, new tab opened, no fatal exception'