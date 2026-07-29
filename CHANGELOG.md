# Changelog

## 0.9.0-rc.2

- 对齐日记全文详情、多日历事件与提醒、文本通话舞台和多直播间大厅。
- 修复 Prompt scope 原生下拉选项对比度，以及真实 Host 模型回包错误信息显示。
- 保持所有模型生成仅由用户显式操作触发，不恢复后台自动生成。

## 0.9.0-rc.1

首个预发布候选版本，完成 MC1–MC9 的公开仓库交付线：

- 独立 compact/expanded 小手机窗口与按角色隔离的群聊、轻应用、自动活动和资源包。
- Host API 1.3 受管 Character Context、LLM、background jobs、storage 与 directory grant。
- Python 3.11 JSON-RPC stdio service、原子 per-card storage、wheel 与隔离运行 smoke。
- 本地目录和 GitHub URL 安装，以及 update、增权拒绝、损坏更新保护、rollback、disable/enable、uninstall 生命周期验证。
- 可复现 Extension ZIP、SHA-256、wheel 与公开仓库内容审计。

这是 release candidate，不承诺与 Host API 2.x 兼容。用户数据和用户导入的资源不包含在发布资产中。
