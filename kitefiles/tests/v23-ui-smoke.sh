#!/usr/bin/env bash
set -euo pipefail
DIR="${RUNNER_TEMP:-/tmp}"
adb shell uiautomator dump /sdcard/kf-v23.xml >/dev/null 2>&1
adb pull /sdcard/kf-v23.xml "$DIR/kf-v23.xml" >/dev/null 2>&1
python3 - "$DIR/kf-v23.xml" <<'PY'
import sys,xml.etree.ElementTree as ET
root=ET.parse(sys.argv[1]).getroot()
texts=[n.attrib.get('text','') for n in root.iter('node')]
descriptions=[n.attrib.get('content-desc','') for n in root.iter('node')]
required='/storage/emulated/0/A_KiteFilesProbe'
assert any(required in t for t in texts), 'Actual folder path absent; found: '+str(texts)
assert not any(t == '내부 저장소' for t in texts), 'Old storage tab badge visible'
assert not any(t == '내 파일' for t in texts), 'Old breadcrumb badge visible'
assert 'probe.txt' in texts, 'Folder content absent'
assert any('탐색 창' in d for d in descriptions), 'Accessible tab descriptions missing'
print('KITEFILES V2.3 UI RESULT: real path, no storage badge, file list and tabs PASS')
PY
adb exec-out screencap -p > "$PWD/kitefiles-v23-compact-path.png"
