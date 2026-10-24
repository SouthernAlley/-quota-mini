# Quota Mini · 额度小窗

Windows 桌面额度小窗，显示 **Codex / ChatGPT Work 对应额度池的剩余百分比**。

当前版本：**0.2.5 Preview**。非 OpenAI 官方产品；MIT 许可证，维护者 SouthernAlley。

## 功能

- ChatGPT 内嵌卡片和桌面全局置顶窗，短时与本周额度每分钟刷新。
- 深色设置、窗口缩放与透明度，偏好自动保存在本机。
- 「—」缩成小方块，仅显示实际短时剩余百分比；悬停显示额度周期。
- 小方块可拖动、双击展开、滚轮独立缩放。没有短时数据时显示「—」，不拿周额度替代。
- 不请求 API 密钥、不读取聊天、不调用模型、不消耗额度重置机会。

## 使用前确认

这不是所有 ChatGPT 模型的消息/token 统计器，也不显示 API 账单。只显示官方本机组件实际返回的 Codex 额度池；套餐名称不用于推算额度。

需要 Windows、Windows PowerShell 5.1/.NET WPF、Node.js 20+ 和已登录的 Codex 本机组件。首次安装需要命令行配置，尚未提供一键安装器。请参见 [安装、更新和卸载](INSTALL.md)。

## 开发与检查

    node --test plugins/quota-mini/tests/*.test.mjs
    node plugins/quota-mini/scripts/check-mcp.mjs

在 Windows PowerShell STA 模式执行 scripts/test-window-settings.ps1 与 scripts/test-compact-windows.ps1（相对插件目录）可检查偏好和短时视图数据，不显示测试窗口。

GitHub Actions 会在 Linux 和 Windows 执行检查；main 分支检查通过后创建标记为 Preview 的源码 Release。工作流准备不等于检查已经在 GitHub 通过，实际结果以 Actions 为准。

## 限制与隐私

这是预览版。跨机器干净安装、更新/卸载、多显示器与混合 DPI 的完整验证仍在进行。窗口目前可能在重开或调整尺寸后回到主屏。详见 [已知限制](AUDIT.md)。

桌面窗有 Node 与 PowerShell/WPF 进程，关闭 ChatGPT 不会自动关闭小窗；没有注册开机启动。官方组件需要联网读取额度，无作者收集数据的后端。详见 [数据处理说明](PRIVACY.md)。

安装故障或显示问题可在仓库 Issues 反馈；请先去掉身份信息、密钥和真实聊天内容。

## 许可证

Copyright (c) 2026 SouthernAlley. 本仓库源码以 [MIT](LICENSE) 许可发布；OpenAI 客户端、Windows 和其他外部运行组件不包含在此源码许可证内。
