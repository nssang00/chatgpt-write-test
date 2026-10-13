from pathlib import Path
import json
r=Path(__file__).resolve().parent
manifest=json.loads((r/'UnityProject/Packages/manifest.json').read_text(encoding='utf-8'))
assert manifest['dependencies'].get('com.unity.modules.jsonserialize')=='1.0.0', 'JsonUtility requires Unity JSONSerialize built-in module'
cpp=(r/'Native/WebView2UnityPilot.cpp').read_text(encoding='utf-8')
header=(r/'Native/EchoProtocol.h').read_text(encoding='utf-8')
echo_test=(r/'Native/EchoProtocolTests.cpp').read_text(encoding='utf-8')
cmake=(r/'Native/CMakeLists.txt').read_text(encoding='utf-8')
cs=(r/'UnityProject/Assets/Scripts/WebView2OverlayUnityPilot.cs').read_text(encoding='utf-8')
tele=(r/'UnityProject/Assets/Scripts/WebView2OneClickTelemetry.cs').read_text(encoding='utf-8')
build=(r/'UnityProject/Assets/Editor/WebView2OneClickBuilder.cs').read_text(encoding='utf-8')
ps=(r/'Run-All.ps1').read_text(encoding='utf-8')
for x in ['g_acks.fetch_add(1)','WV2Pilot_GetAckCount','probe-ack','COINIT_APARTMENTTHREADED','GetWindowThreadProcessId','WV2Pilot_RequestClose','WV2Pilot_GetShutdownPhase','g_shutdownPhase.store(7)']:
 assert x in cpp,x
for x in ['WV2Pilot_GetFixtureEchoAckCount','WV2Pilot_GetManualEchoAckCount','WV2Pilot_GetEchoRejectedCount','wv2echo::Parse(message,wv2echo::kRequest','wv2echo::Parse(message,wv2echo::kAck','g_pendingEcho.erase(it)','sendEcho(\'manual\',input.value)','sendEcho(\'auto\',fixture)','echo-return-v1|','원문과 ']:
 assert x in cpp, 'Native Echo code missing: '+x
for x in [r'\uC548\uB155\uD558\uC138\uC694',r'\U0001F600','inline bool Parse','tmp.payload.size()>4096','IsFixture']:
 assert x in header, 'UTF-16 protocol must include '+x
assert 'Native UTF-16 EchoProtocol PASS' in echo_test
assert 'add_test(NAME utf16-native-echo' in cmake and '/utf-8' in cmake
for x in ['enablePilot = false','WV2Pilot_Close','OnApplicationQuit','GetActiveWindow']:
 assert x in cs,x
assert 'current!=lastBounds' not in cs, 'Unity 2022.3 RectInt has no != operator'
for x in ['current.x != lastBounds.x', 'current.y != lastBounds.y', 'current.width != lastBounds.width', 'current.height != lastBounds.height']:
 assert x in cs, 'RectInt comparison must use coordinates: '+x
for x in ['PASS_AUTO','FAIL_AUTO','ackCount','Application.Quit','pilotReportPath','shutdownJoined','shutdownWaitSeconds','shutdownPhase==7','WV2Pilot_Close(0)','fixtureUnicodeEchoAckCount>0','echoRejectedCount==0','WV2Pilot_GetFixtureEchoAckCount']:
 assert x in tele,x
assert '#if UNITY_STANDALONE_WIN && !UNITY_EDITOR\n        private void BeginShutdown()' in tele, 'Shutdown methods must not compile in editor'
assert '#endif\n        private void Finish(bool quit)' in tele, 'Close Windows-only method guard before Finish'
for x in ['BuildPipeline.BuildPlayer','2022.3.62f3','StandaloneWindows64','ApplyModifiedPropertiesWithoutUndo']:
 assert x in build,x
for x in ['Get-FileHash','SHA256SUMS.txt','PENDING_MANUAL','Compress-Archive','-executeMethod WebView2OneClickBuilder.Build','shutdownJoined','-LiteralPath $safe']:
 assert x in ps,x
assert 'closeAttempted=true' in cs, 'Prevent repeated 5s shutdown retries'
assert 'Join-Path $out \'*\'' not in ps, 'Do not upload WebView2 user profile or Player binaries'
assert `public string testRevision="r5";` in tele, 'Packaged player must be r5 Unicode Echo'
assert 'revisionMatch=[regex]::Match' in ps and '$revisionMatch.Groups[\'version\'].Value' in ps, 'OneClick must derive telemetry revision from checksum-pinned C# source'
assert "($data.testRevision -eq 'r3')" not in ps, 'Stale r3 wrapper revision must be forbidden'
assert '%~dp0.' in (r/'Run-All.cmd').read_text(encoding='utf-8')
print('v58.5.2 r5 Unicode Native Echo + shutdown gate static contract PASS')
