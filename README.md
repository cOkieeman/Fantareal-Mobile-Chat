# Fantareal Mobile Chat

Fantareal 新 PC 的“小手机”Extension。MC1–MC6 已合并；MC7–MC8 接入 Host 受管低频自动活动与用户自有资源包。

## 当前范围

- `fantareal-extension.json`：Host API 1.3 Web page + Python service manifest，声明通用 `background.jobs`、`storage.assets` 与用户选择目录权限。
- `web/`：可切换 compact/expanded 的群聊、轻应用、自动活动与角色资源管理 UI；两个形态复用同一 DOM、router 与状态。
- `src/fantareal_mobile_chat/`：不联网的 JSON-RPC 2.0 stdio service、Host 后台 execution 适配、per-card 原子 JSON 存储与严格资源包导入。
- `src/fantareal_mobile_chat/prompts/`：随 wheel 打包的群聊与各轻应用生成契约。
- `docs/mc1b-presentation-spec.md`：窗口状态、逻辑尺寸、断点、关闭/恢复与 Host/Web 边界。
- `schemas/`：群聊、轻应用、交互应用、Prompt profile 与资源包 JSON Schema。
- `resources/empty-pack/`：不包含第三方素材的空资源包示例。
- `tests/`：manifest、schema、离线 UI、Python service 与仓库内容审计。

Service 不启动 FastAPI/HTTP，不读取主程序私有文件或 API Key，也不直接访问模型供应商。Web UI 通过 Host `character.context.read`、`llm.generate`、`background.jobs`、`storage.assets`、`files.user-selected.directory-read` 和 service RPC 组成闭环。后台任务默认关闭，只在 Fantareal Host 进程运行期间执行；角色 Context 变化后旧绑定会暂停。

## 本地验证

要求 Node.js 20+ 与 uv：

```powershell
npm run check
npm test
uv lock --check
uv run --locked ruff check .
uv run --locked python -X utf8 -m pytest
```

## 在 Fantareal 中安装

1. 打开新 PC 客户端的插件页面。
2. 选择“从本地目录安装”。
3. 选择本仓库根目录。
4. 在插件卡片的“资源额度”中设置允许使用的 Assets quota；`0` 表示禁止新资源写入。
5. 关闭并重新打开“小手机”，让 service session 取得新的 quota。
6. 验证非模态窗口、主页/群聊/轻应用、compact/expanded、主题、关闭与二次打开。
7. 打开“资源”，选择包含 `resource-pack.json` 的目录，核对授权、用途、预览与 quota 后确认导入。
8. 创建群聊并管理成员，验证用户发送、角色续聊、停止生成、失败重试和清空消息。
9. 打开“自动活动”，验证默认关闭、启用/暂停、间隔、立即运行、取消与角色切换后重新绑定。
10. 选择旧版小手机数据目录，先核对导入预览，再确认合并或替换。

## 数据与素材边界

- 不在仓库中保存 API Key、角色卡、聊天记录、用户数据、模型或日志。
- `resources/empty-pack/` 只描述资源包格式，不包含旧版 400 个表情文件。
- 运行数据只写入 Host 提供的 namespaced `storage.data/cards/<cardUid>/`。
- 用户资源只写入 `storage.assets/cards/<cardUid>/resource-packs/<packId>/`；损坏资源不会阻断文本聊天。
- 资源包必须声明名称、来源与是否允许再分发；预览后内容发生变化会拒绝导入。
- 旧数据只允许由用户显式选择目录后导入，插件不得自动扫描旧 WebUI。

## License 状态

License 暂未选择。需要先完成代码、字体与素材权属核对；不要根据旧实现或仓库名称推断许可证。
