# 安装、更新和卸载（Windows 预览版）

## 前提

Windows PowerShell 5.1/.NET WPF、Node.js 20+、支持 `codex plugin` 的 Codex CLI，以及本机官方客户端已经完成的登录。本地核验环境为 Node.js 24.22.1、Codex CLI **0.164.0-alpha.11.1**、桌面客户端 **26.1021.3705.0**；CLI 与桌面客户端是不同版本号。CI 覆盖 Node.js 20、24，具体结果以 Actions 为准。企业策略可能禁止本地 MCP 或 PowerShell 动态编译。

配置生成、CLI 安装和桌面客户端须使用同一个 Codex 数据目录。使用自定义 `CODEX_HOME` 时，应先把它设置为绝对路径，并让三个环节使用相同设置；改变 Node 路径或 Codex 数据目录后，需要重新生成配置并安装。

## 下载与校验

从 [v0.2.5 发布页](https://github.com/SouthernAlley/-quota-mini/releases/tag/v0.2.5) 下载 `quota-mini-0.2.5-source.zip` 和 `SHA256SUMS.txt`，放在同一目录。在该目录打开 PowerShell，先执行：

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $checksum = (Get-Content -LiteralPath '.\SHA256SUMS.txt' -Raw).Trim()
    if ($checksum -notmatch '^([a-fA-F0-9]{64})\s+\*?quota-mini-0\.2\.5-source\.zip$') {
        throw '校验文件格式或文件名不符合预期'
    }
    $expectedHash = $Matches[1]
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath '.\quota-mini-0.2.5-source.zip').Hash
    if ($actualHash -ine $expectedHash) { throw '源码包 SHA-256 不匹配，请停止安装' }
    Write-Host 'SHA-256 校验通过'
}
```

v0.2.5 源码包 SHA-256：`8ef13702a469bdfbca38faffa865aa156335d6dd24650fd87b97cbc5c011bb8b`。

校验通过后解压到固定目录，并进入顶层 `quota-mini-0.2.5` 文件夹。应能看到 `INSTALL.md`、`plugins` 和隐藏目录 `.agents`。安装源目录请保留。

## 安装

在解压后的仓库根目录运行以下完整代码块。任一步失败都会停止，解决错误后再重试：

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Get-Command node,codex,powershell.exe -ErrorAction Stop | Out-Null
    node --version
    if ($LASTEXITCODE -ne 0) { throw 'Node 不可用' }
    node -e "if (Number(process.versions.node.split('.')[0]) < 20) process.exit(1)"
    if ($LASTEXITCODE -ne 0) { throw '需要 Node.js 20 或更高版本' }
    codex --version
    if ($LASTEXITCODE -ne 0) { throw 'Codex CLI 不可用' }
    codex plugin add --help
    if ($LASTEXITCODE -ne 0) { throw '当前 CLI 不支持插件安装' }

    node plugins/quota-mini/scripts/configure-local.mjs
    if ($LASTEXITCODE -ne 0) { throw '生成配置失败' }
    codex plugin marketplace add . --json
    if ($LASTEXITCODE -ne 0) { throw '添加市场失败' }
    $installedText = codex plugin add quota-mini@quota-mini-preview --json
    if ($LASTEXITCODE -ne 0) { throw '安装插件失败' }
    $installed = ($installedText -join [Environment]::NewLine) | ConvertFrom-Json
    if (-not $installed.installedPath) { throw '安装结果缺少 installedPath' }
    $manifest = Get-Content -LiteralPath 'plugins/quota-mini/.codex-plugin/plugin.json' -Raw | ConvertFrom-Json
    if ($installed.version -ne $manifest.version) { throw '安装版本与源码版本不一致' }
    $configFile = Join-Path $installed.installedPath '.mcp.json'
    $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
    $server = $config.mcpServers.'quota-mini'
    if (-not $server -or $server.cwd -ine $installed.installedPath) { throw '额度服务目录与实际安装目录不一致' }
    if (-not (Test-Path -LiteralPath $server.command -PathType Leaf)) { throw 'Node 路径不存在' }
    if (-not $server.args -or -not (Test-Path -LiteralPath $server.args[0] -PathType Leaf)) { throw '服务文件不存在' }
    $expectedService = Join-Path $installed.installedPath 'server.mjs'
    if ($server.args[0] -ine $expectedService) { throw '服务文件指向其他安装目录' }
    Write-Host "安装路径检查通过：$($installed.installedPath)"
    codex plugin list --json
    if ($LASTEXITCODE -ne 0) { throw '读取安装状态失败' }
}
```

配置生成步骤写入 `plugins/quota-mini/.mcp.json`，包含使用者自己的 Node、Codex 数据目录和安装版本路径。不要共享或提交这个生成文件，不要把别人的启动配置复制到本机。安装命令及 `installedPath` 字段见 [官方开发命令说明](https://learn.chatgpt.com/docs/developer-commands)。

重新加载插件或重启客户端，在本地执行的聊天里调用「打开桌面额度悬浮窗」。若同时装过其他同名开发版本，请先关闭旧窗口、停用旧插件，避免加载两个额度服务。

## 更新

先关闭额度小窗，再将新版源码放到原目录，重新执行以上三条配置/安装命令并重新加载客户端。已有位置、大小、缩放模式及透明度保存在本机配置中。若出现文件占用，先完全退出客户端再重试，不要强删正在使用的缓存。

## 卸载

先关闭额度窗，再执行：

    codex plugin remove quota-mini@quota-mini-preview --json
    codex plugin marketplace remove quota-mini-preview --json

这两条仅针对本项目的预览市场，不要替换成其他市场名称。确认卸载后可以删除下载的源码目录。窗口偏好保留在 `%LOCALAPPDATA%\QuotaMini\window.json`；PowerShell 写法为 `Join-Path $env:LOCALAPPDATA 'QuotaMini\window.json'`。如需完全重置，可自行删除这个文件。

## 验证范围

2026-10-27，维护者反馈已在另一台电脑下载并正常运行，已有一次跨机器实际使用成功记录。该电脑的 Windows、Node.js 和客户端具体版本尚未记录。配置生成逻辑也已在独立数据目录模拟验证。

更多系统环境、干净系统全流程安装、更新/卸载、多显示器和混合 DPI 的验证仍待补充。

## 无法获取额度时

先检查本机官方客户端的登录状态和访问 ChatGPT 的网络连接；使用代理时，确认当前节点和分流规则允许访问 ChatGPT。小窗读取额度需要联网；已有成功读取记录时，后续读取失败会保留上次结果并提示「暂未更新」，旧百分比不能视为实时额度。网络恢复后可点击小窗的刷新按钮，或等待下一次自动刷新。

请先排查登录和网络，再考虑重新安装。反馈问题时请附上插件版本、客户端版本和错误提示，并去掉身份信息、密钥和聊天内容。

