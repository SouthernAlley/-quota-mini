# 安装、更新和卸载（Windows 预览版）

## 前提

Windows PowerShell 5.1/.NET WPF、Node.js 20+、可从命令行启动的 Codex CLI，以及本机官方客户端已经完成的登录。本版在 Node.js 24.22.1 与桌面客户端 26.1021.3705.0 验证，其他版本仍需反馈。企业策略可能禁止本地 MCP 或 PowerShell 动态编译。

## 安装

下载源码并解压到固定目录。在仓库根目录执行：

    node plugins/quota-mini/scripts/configure-local.mjs
    codex plugin marketplace add . --json
    codex plugin add quota-mini@quota-mini-preview --json

第一步会在本机生成 .mcp.json，写入使用者自己的 Node、Codex 数据目录和安装版本路径。不要共享或提交这个生成文件，不要把别人的启动配置复制到本机。安装源目录请保留。

重新加载插件或重启客户端，在本地执行的聊天里调用「打开桌面额度悬浮窗」。若同时装过其他同名开发版本，请先关闭旧窗口、停用旧插件，避免加载两个额度服务。

## 更新

先关闭额度小窗，再将新版源码放到原目录，重新执行以上三条配置/安装命令并重新加载客户端。已有位置、大小、缩放模式及透明度保存在本机配置中。若出现文件占用，先完全退出客户端再重试，不要强删正在使用的缓存。

## 卸载

先关闭额度窗，再执行：

    codex plugin remove quota-mini@quota-mini-preview --json
    codex plugin marketplace remove quota-mini-preview --json

这两条仅针对本项目的预览市场，不要替换成其他市场名称。确认卸载后可以删除下载的源码目录。窗口偏好保留在 LOCALAPPDATA/QuotaMini/window.json；如需完全重置，可自行删除这个文件。

以上配置生成逻辑已在独立数据目录模拟验证；尚未完成另一台干净电脑的全流程安装/更新/卸载验证。
