from pathlib import Path
r=Path(__file__).resolve().parent.parent
ps=(r/'Review-Stage2.ps1').read_text(encoding='utf-8-sig')
cmd=(r/'Review-Stage2.cmd').read_text(encoding='utf-8')
guide=(r/'STAGE2_MANUAL_GUIDE_KO.md').read_text(encoding='utf-8')
for n in range(1,10):
 key=f'R{n:02d}'
 assert key in ps and key in guide,key
for token in ['Run-All.ps1','PENDING_INDEPENDENT_REVIEW','manual-review.json','MANUAL_REPORTED_FAIL','MANUAL_PARTIAL','MANUAL_REPORTED_PASS_PENDING_EVIDENCE_REVIEW','Compress-Archive','180','-SelfTest']:
 assert token.replace('-SelfTest','SelfTest') in ps,token
assert 'Review-Stage2.ps1' in cmd
assert 'Send to Native Echo' in guide and '원문과 정확히 일치' in guide
assert 'Win+Shift+S' not in ps # no screenshot automation
assert 'CompanyWebView2OverlayPilot' not in ps # no product native binary changes
builder=(r/'UnityProject/Assets/Editor/WebView2OneClickBuilder.cs').read_text(encoding='utf-8')
windowed='PlayerSettings.fullScreenMode=FullScreenMode.Windowed;'
resizable='PlayerSettings.resizableWindow=true;'
assert windowed in builder, 'Stage2 Player must explicitly start windowed'
assert resizable in builder, 'Stage2 Player must enable interactive resizing'
assert builder.index(windowed)<builder.index('BuildPipeline.BuildPlayer'), 'Window mode must be set before build'
assert builder.index(resizable)<builder.index('BuildPipeline.BuildPlayer'), 'ResizableWindow must be set before build'
assert '[WV2-STAGE2] Window mode=' in builder, 'Build log must expose window mode'
assert '창 테두리' in guide and 'R05' in guide, 'Guide must tell user how to resize'
print('Stage2 Korean manual review source contract PASS')
