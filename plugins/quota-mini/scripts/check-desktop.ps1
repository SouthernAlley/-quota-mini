param([ValidateSet('inspect', 'move', 'refresh', 'close', 'settings', 'size', 'transparency', 'defaults', 'done', 'settings-close', 'minimize', 'restore', 'restore-double-click', 'wheel', 'drag-compact')][string]$Action = 'inspect', [string]$ImagePath = '', [double]$Value = 0)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase, System.Web.Extensions, System.Drawing
$quotaProbeAssemblies = @(
  [System.Windows.Automation.AutomationElement].Assembly.Location,
  [System.Windows.Automation.AutomationProperty].Assembly.Location,
  [System.Windows.Rect].Assembly.Location,
  [System.Web.Script.Serialization.JavaScriptSerializer].Assembly.Location,
  [System.Drawing.Bitmap].Assembly.Location,
  'System.dll', 'System.Core.dll'
)
Add-Type -Path (Join-Path $PSScriptRoot 'DesktopProbe.cs') -ReferencedAssemblies $quotaProbeAssemblies
[QuotaMini.DesktopProbe]::Run($Action, $ImagePath, $Value)
