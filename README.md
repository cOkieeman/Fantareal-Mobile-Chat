# Fantareal Mobile Chat

Fantareal 新 PC 的“小手机”Extension。当前仓库处于 **MC1**：只提供可安装的 Host API 1.1 静态页面、数据契约、空资源包示例和验证脚本。

## 当前范围

- `fantareal-extension.json`：page-only Extension manifest。
- `web/`：完全离线的静态手机 UI fixture。
- `schemas/`：MC1 fixture 与未来 per-card 数据边界的 JSON Schema。
- `resources/empty-pack/`：不包含第三方素材的空资源包示例。
- `tests/`：manifest、schema、离线 UI 与仓库内容审计。

MC1 不包含 Python service、FastAPI、真实聊天生成、后台任务、旧 WebUI 数据导入或旧表情素材。以上能力将在 MC2–MC9 按 Host 契约分阶段实现。

## 本地验证

要求 Node.js 20 或更高版本：

```powershell
npm test
```

额外执行 JavaScript syntax check：

```powershell
npm run check
```

## 在 Fantareal 中安装

1. 打开新 PC 客户端的插件页面。
2. 选择“从本地目录安装”。
3. 选择本仓库根目录。
4. 安装后打开“小手机（MC1 预览）”。
5. 验证打开、关闭和二次打开；页面不需要网络或任何权限。

## 数据与素材边界

- 不在仓库中保存 API Key、角色卡、聊天记录、用户数据、模型或日志。
- `resources/empty-pack/` 只描述资源包格式，不包含旧版 400 个表情文件。
- 未来运行数据必须写入 Host 提供的 namespaced storage，并按 `cardUid` 分域。
- 旧数据只允许由用户显式选择目录后导入，插件不得自动扫描旧 WebUI。

## License 状态

License 暂未选择。需要先完成代码、字体与素材权属核对；不要根据旧实现或仓库名称推断许可证。
