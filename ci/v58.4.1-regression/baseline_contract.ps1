$ErrorActionPreference='Stop'
$contract = Get-Content 'ci/v58.4.1-regression/baseline-contract.json' -Raw | ConvertFrom-Json
if($contract.harnessVersion -ne '58.4.1'){ throw 'version mismatch' }
if($contract.productRuntimeChanged){ throw 'validation-only revision must not change product runtime' }
if(@($contract.caseIds).Count -ne 8){ throw 'expected eight regression cases' }
foreach($id in @('UNITY_BUILD','NATIVE_CONTROLS','BROWSER_COMPAT','MULTI_WEBVIEW','INPUT_IME','LIFECYCLE','REAL_MEDIA','RELEASE_GA')){
  if(@($contract.caseIds) -notcontains $id){ throw "missing case $id" }
}
function Assert-Browser($x){
  return [bool]$x.technicalPass -and [bool]$x.persistentCookieLocalStoragePass -and [bool]$x.rendererTerminationRecoveryPass -and [bool]$x.privateProfileIsolationPass -and [bool]$x.profileStressPass
}
function Assert-Input($x){
  return [bool]$x.passed -and [bool]$x.koreanCommitPass -and [bool]$x.compositionPass -and [bool]$x.editingKeysPass
}
function Assert-Lifecycle($x){
  return [bool]$x.passed -and [bool]$x.resourceGrowthPass -and [bool]$x.concurrentPass -and [int]$x.orphanCount -eq 0
}
function Assert-Release($x){
  return [bool]$x.releaseReady -and $x.readiness -eq 'READY_FOR_GA_PACKAGING' -and @('READY_GA_UNSIGNED_CANDIDATE','READY_GA') -contains [string]$x.shipping
}
$goodBrowser=[pscustomobject]@{technicalPass=$true;persistentCookieLocalStoragePass=$true;rendererTerminationRecoveryPass=$true;privateProfileIsolationPass=$true;profileStressPass=$true}
if(-not (Assert-Browser $goodBrowser)){ throw 'known-good browser contract failed' }
$badBrowser=$goodBrowser.PSObject.Copy();$badBrowser.persistentCookieLocalStoragePass=$false
if(Assert-Browser $badBrowser){ throw 'browser storage regression was not caught' }
$goodInput=[pscustomobject]@{passed=$true;koreanCommitPass=$true;compositionPass=$true;editingKeysPass=$true}
if(-not (Assert-Input $goodInput)){throw 'known-good input contract failed'}
$badInput=$goodInput.PSObject.Copy();$badInput.koreanCommitPass=$false
if(Assert-Input $badInput){throw 'Korean input regression was not caught'}
$goodLife=[pscustomobject]@{passed=$true;resourceGrowthPass=$true;concurrentPass=$true;orphanCount=0}
if(-not (Assert-Lifecycle $goodLife)){throw 'known-good lifecycle contract failed'}
$badLife=$goodLife.PSObject.Copy();$badLife.resourceGrowthPass=$false
if(Assert-Lifecycle $badLife){throw 'resource growth regression was not caught'}
foreach($shipping in @('READY_GA_UNSIGNED_CANDIDATE','READY_GA')){
  if(-not (Assert-Release ([pscustomobject]@{releaseReady=$true;readiness='READY_FOR_GA_PACKAGING';shipping=$shipping}))){throw "release contract rejected $shipping"}
}
if(Assert-Release ([pscustomobject]@{releaseReady=$true;readiness='READY_FOR_GA_PACKAGING';shipping='READY_GA_FAKE'})){throw 'invalid GA label regression was not caught'}
Write-Host 'VALIDATED_BASELINE_CONTRACT=PASS cases=8 negativeMutations=4'
