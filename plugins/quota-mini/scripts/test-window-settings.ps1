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
function Assert-Setting($Value, $Expected, $Label) {
  if ([Math]::Abs($Value - $Expected) -gt 0.000001) { throw "Failed: $Label" }
}
$quotaLegacy = [QuotaMini.WindowPreferences]::Parse('{"left":120,"top":80}')
Assert-Setting $quotaLegacy.Scale 1 'legacy scale'
Assert-Setting $quotaLegacy.Transparency 0 'legacy transparency'
Assert-Setting $quotaLegacy.Left 120 'legacy position'
Assert-Setting ([int]$quotaLegacy.Compact) 0 'legacy starts expanded'
$quotaSaved = [QuotaMini.WindowPreferences]::Parse('{"left":120,"top":80,"scale":1.4,"transparency":40}')
Assert-Setting $quotaSaved.Opacity 0.6 'transparency converts to opacity'
$quotaRestored = [QuotaMini.WindowPreferences]::Parse($quotaSaved.Serialize())
Assert-Setting $quotaRestored.Scale 1.4 'roundtrip scale'
Assert-Setting $quotaRestored.Transparency 40 'roundtrip transparency'
$quotaSaved.Compact = $true
Assert-Setting ([int]([QuotaMini.WindowPreferences]::Parse($quotaSaved.Serialize())).Compact) 1 'roundtrip compact mode'
Assert-Setting ([int]([QuotaMini.WindowPreferences]::Parse('{"compact":2}')).Compact) 0 'invalid compact mode fallback'
$quotaSaved.SetCompactScale(1.3)
Assert-Setting ([QuotaMini.WindowPreferences]::Parse($quotaSaved.Serialize())).CompactScale 1.3 'roundtrip independent compact scale'
Assert-Setting $quotaSaved.Scale 1.4 'compact scale does not alter full window scale'
$quotaSaved.SetCompactScale(100)
Assert-Setting $quotaSaved.CompactScale 2 'compact upper bound'
$quotaSaved.SetCompactScale(-1)
Assert-Setting $quotaSaved.CompactScale 0.6 'compact lower bound'
$quotaSaved.SetAppearance(20, 100)
Assert-Setting $quotaSaved.Scale 1.6 'maximum size'
Assert-Setting $quotaSaved.Opacity 0.3 'minimum visible opacity'
$quotaSaved.SetAppearance(-1, -1)
Assert-Setting $quotaSaved.Scale 0.75 'minimum size'
Assert-Setting $quotaSaved.Opacity 1 'maximum opacity'
$quotaSaved.SetAppearance([double]::NaN, [double]::PositiveInfinity)
Assert-Setting $quotaSaved.Scale 1 'nonfinite scale fallback'
Assert-Setting $quotaSaved.Transparency 0 'nonfinite transparency fallback'
$quotaBroken = [QuotaMini.WindowPreferences]::Parse('invalid json')
Assert-Setting $quotaBroken.Scale 1 'corrupt settings fallback'
if ([QuotaMini.QuotaDisplay]::ShortLabel(15) -ne ('15 ' + [char]20998 + [char]38047)) { throw '15-minute window mislabeled' }
if ([QuotaMini.QuotaDisplay]::ShortLabel(300) -ne ('5 ' + [char]23567 + [char]26102)) { throw 'five-hour label regression' }
if ([QuotaMini.QuotaDisplay]::ShortLabel(90) -ne ('1.5 ' + [char]23567 + [char]26102)) { throw 'fractional-hour label regression' }
if ([QuotaMini.QuotaDisplay]::ShortLabel([double]::NaN) -ne ('' + [char]30701 + [char]26102)) { throw 'missing duration mislabeled' }
[pscustomobject]@{WindowSettingsChecks='passed';Checks=24;GuiOpened=$false} | ConvertTo-Json
