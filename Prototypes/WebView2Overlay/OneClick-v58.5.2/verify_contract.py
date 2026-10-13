from pathlib import Path
import json
r=Path(__file__).resolve().parent
manifest=json.loads((r/'UnityProject/Packages/manifest.json').read_text(encoding='utf-8'))
assert manifest['dependencies'].get('com.unity.modules.jsonserialize')=='1.0.0', 'JsonUtility requires Unity JSONSerialize built-in module'
cpp=(r/'Native/WebView2UnityPilot.cpp').read_text(encoding='utf-8')
cs=(r/'UnityProject/Assets/Scripts/WebView2OverlayUnityPilot.cs').read_text(encoding='utf-8')
tele=(r/'UnityProject/Assets/Scripts/WebView2OneClickTelemetry.cs').read_text(encoding='utf-8')
build=(r/'UnityProject/Assets/Editor/WebView2OneClickBuilder.cs').read_text(encoding='utf-8')
ps=(r/'Run-All.ps1').read_text(encoding='utf-8')
for x in ['g_acks.fetch_add(1)','WV2Pilot_GetAckCount','probe-ack','COINIT_APARTMENTTHREADED','GetWindowThreadProcessId']:
 assert x in cpp,x
for x in ['enablePilot = false','WV2Pilot_Close','OnApplicationQuit','GetActiveWindow']:
 assert x in cs,x
assert 'current!=lastBounds' not in cs, 'Unity 2022.3 RectInt has no != operator'
for x in ['current.x != lastBounds.x', 'current.y != lastBounds.y', 'current.width != lastBounds.width', 'current.height != lastBounds.height']:
 assert x in cs, 'RectInt comparison must use coordinates: '+x
for x in ['PASS_AUTO','FAIL_AUTO','ackCount','Application.Quit','pilotReportPath']:
 assert x in tele,x
for x in ['BuildPipeline.BuildPlayer','2022.3.62f3','StandaloneWindows64','ApplyModifiedPropertiesWithoutUndo']:
 assert x in build,x
for x in ['Get-FileHash','SHA256SUMS.txt','PENDING_MANUAL','Compress-Archive','-executeMethod WebView2OneClickBuilder.Build']:
 assert x in ps,x
assert '%~dp0.' in (r/'Run-All.cmd').read_text(encoding='utf-8')
print('v58.5.2 OneClick static isolation + runtime evidence contract PASS')
