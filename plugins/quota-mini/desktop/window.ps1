param([ValidateSet('open', 'close')][string]$Action = 'open')
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Web.Extensions
$quotaAssemblies = @(
  [System.Windows.Window].Assembly.Location,
  [System.Windows.Media.Visual].Assembly.Location,
  [System.Windows.Threading.Dispatcher].Assembly.Location,
  [System.Web.Script.Serialization.JavaScriptSerializer].Assembly.Location,
  'System.dll', 'System.Core.dll', 'System.Xaml.dll'
)
Add-Type -Path (Join-Path $PSScriptRoot 'QuotaWindow.cs') -ReferencedAssemblies $quotaAssemblies
[QuotaMini.DesktopHost]::Run($Action)
