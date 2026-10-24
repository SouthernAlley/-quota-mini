$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Web.Extensions
$quotaAssemblies = @(
  [System.Windows.Window].Assembly.Location,
  [System.Windows.Media.Visual].Assembly.Location,
  [System.Windows.Threading.Dispatcher].Assembly.Location,
  [System.Web.Script.Serialization.JavaScriptSerializer].Assembly.Location,
  'System.dll', 'System.Core.dll', 'System.Xaml.dll'
)
Add-Type -Path (Join-Path $PSScriptRoot '..\desktop\QuotaWindow.cs') -ReferencedAssemblies $quotaAssemblies
$quotaFlags = [Reflection.BindingFlags]'Instance,NonPublic'
$quotaRaise = New-Object System.Threading.EventWaitHandle($false, [System.Threading.EventResetMode]::AutoReset)
$quotaClose = New-Object System.Threading.EventWaitHandle($false, [System.Threading.EventResetMode]::AutoReset)
$quotaWindow = New-Object QuotaMini.QuotaWindow($quotaRaise, $quotaClose)
# Test the actual WPF view without showing a window or writing preferences.
foreach ($quotaTimerName in @('timer', 'saveTimer')) {
  $quotaWindow.GetType().GetField($quotaTimerName, $quotaFlags).GetValue($quotaWindow).Stop()
}
$quotaApply = $quotaWindow.GetType().GetMethod('Apply', $quotaFlags)
$quotaValue = $quotaWindow.GetType().GetField('compactValue', $quotaFlags).GetValue($quotaWindow)
$quotaCard = $quotaWindow.GetType().GetField('compactCard', $quotaFlags).GetValue($quotaWindow)
$quotaJson = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$quotaCases = @(
  @{minutes=15; percent=75; expected='75%'; label='15 ' + [char]20998 + [char]38047},
  @{minutes=60; percent=50; expected='50%'; label='1 ' + [char]23567 + [char]26102},
  @{minutes=300; percent=25; expected='25%'; label='5 ' + [char]23567 + [char]26102},
  @{minutes=90; percent=12.5; expected='12.5%'; label='1.5 ' + [char]23567 + [char]26102},
  @{minutes=$null; percent=80; expected='80%'; label='' + [char]30701 + [char]26102},
  @{minutes=15; percent=0; expected='0%'; label='15 ' + [char]20998 + [char]38047},
  @{minutes=60; percent=$null; expected=[string][char]8212; label=$null},
  @{minutes=60; percent=150; expected=[string][char]8212; label=$null},
  @{minutes=$null; percent=$null; expected=[string][char]8212; label=$null; noShort=$true}
)
try {
  foreach ($quotaCase in $quotaCases) {
    $quotaSnapshot = @{status='ok'; updatedAt=[DateTime]::UtcNow.ToString('o'); weekly=@{remainingPercent=90;windowMinutes=10080}}
    if (-not $quotaCase.noShort) { $quotaSnapshot.short = @{remainingPercent=$quotaCase.percent;windowMinutes=$quotaCase.minutes} }
    $quotaData = $quotaJson.DeserializeObject(($quotaSnapshot | ConvertTo-Json -Compress -Depth 4))
    $quotaApply.Invoke($quotaWindow, @($quotaData)) | Out-Null
    if ($quotaValue.Text -ne $quotaCase.expected) { throw "Compact percentage mismatch for duration $($quotaCase.minutes)" }
    if ($quotaCase.label -and -not ([string]$quotaCard.ToolTip.Content).StartsWith($quotaCase.label)) { throw 'Tooltip duration mismatch' }
    if (-not ([string]$quotaCard.ToolTip.Content).Contains($quotaCase.expected) -and $quotaCase.label) { throw 'Tooltip percentage mismatch' }
  }
  if ($quotaWindow.IsVisible) { throw 'The integration test must not show a desktop window' }
  [pscustomobject]@{CompactWindowCases=$quotaCases.Count;Result='passed';GuiShown=$false;PreferencesWritten=$false} | ConvertTo-Json
} finally {
  # Do not Close() the hidden view: its normal Closed handler saves user preferences.
  $quotaRaise.Dispose(); $quotaClose.Dispose()
}
