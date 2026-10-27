# Quota Mini · 额度小窗

Windows 桌面额度小窗，显示 **Codex / ChatGPT Work 对应额度池的剩余百分比**。

当前版本：**0.2.5 Preview**。非 OpenAI 官方产品；MIT 许可证，维护者 SouthernAlley。

[下载 v0.2.5 源码预览版与 SHA-256 校验文件](https://github.com/SouthernAlley/-quota-mini/releases/tag/v0.2.5)。安装前请按 [安装说明](INSTALL.md) 校验下载包。

## 功能

- ChatGPT 内嵌卡片和桌面全局置顶窗，短时与本周额度每分钟刷新。
- 深色设置、窗口缩放与透明度，偏好自动保存在本机。
- 「—」缩成小方块，仅显示实际短时剩余百分比；悬停显示额度周期。
- 小方块可拖动、双击展开、滚轮独立缩放。没有短时数据时显示「—」，不拿周额度替代。
- 不请求 API 密钥、不读取聊天、不调用模型、不消耗额度重置机会。

## 使用前确认

这不是所有 ChatGPT 模型的消息/token 统计器，也不显示 API 账单。只显示官方本机组件实际返回的 Codex 额度池；套餐名称不用于推算额度。

需要 Windows、Windows PowerShell 5.1/.NET WPF、Node.js 20+、支持 `codex plugin` 的 Codex CLI 和已登录的 Codex 本机组件。首次安装需要命令行配置，尚未提供一键安装器。请参见 [安装、更新和卸载](INSTALL.md)。

## 开发与检查

    node --test plugins/quota-mini/tests/core.test.mjs plugins/quota-mini/tests/desktop.test.mjs
    node plugins/quota-mini/scripts/check-mcp.mjs
    node scripts/check-release.mjs source

在 Windows PowerShell STA 模式执行 scripts/test-window-settings.ps1 与 scripts/test-compact-windows.ps1（相对插件目录）可检查偏好和短时视图数据，不显示测试窗口。

GitHub Actions 在 Linux、Windows 与 Node.js 20、24 的四种组合执行核心、MCP 和版本一致性检查，Windows 另外执行 WPF 检查。实际通过情况以仓库 Actions 为准。

main 分支检查通过后，工作流为新版本创建 Preview 源码 Release。已有版本会核对标签提交、资产 SHA-256 与 ZIP 中每个文件，而不是直接跳过。文档和 CI 可以继续更新；已发布的插件代码如需修改，应先同步增加产品版本。v0.2.5 的提交和资产摘要保存在 `scripts/published-releases.json`，原标签和下载包保持不变。

## 验证进展

- 2026-10-27：维护者反馈，已在另一台电脑下载并正常运行，增加了一次跨机器实际使用记录。
- 该电脑的 Windows、Node.js 和客户端具体版本尚未记录；更新/卸载、多屏和混合 DPI 仍需单独验证。详细范围见 [验证说明](AUDIT.md)。

## 限制与隐私

这是预览版。更多环境的安装、更新/卸载、多显示器与混合 DPI 的完整验证仍在进行。窗口目前可能在重开或调整尺寸后回到主屏。详见 [已知限制](AUDIT.md)。

桌面窗有 Node 与 PowerShell/WPF 进程，关闭 ChatGPT 不会自动关闭小窗；没有注册开机启动。官方组件需要联网读取额度，无作者收集数据的后端。详见 [数据处理说明](PRIVACY.md)。

安装故障或显示问题可在仓库 Issues 反馈；请先去掉身份信息、密钥和真实聊天内容。

## 许可证

Copyright (c) 2026 SouthernAlley. 本仓库源码以 [MIT](LICENSE) 许可发布；OpenAI 客户端、Windows 和其他外部运行组件不包含在此源码许可证内。

