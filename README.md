# Fantareal Mobile Chat

Fantareal 新 PC 的“小手机”Extension。`0.9.0-rc.2` 是完成 MC1–MC9 生命周期验证，并补齐 WebUI 主要交互语义后的预发布候选版。

## 当前范围

- `fantareal-extension.json`：Host API 1.4 Web page + Python service manifest，声明模型、`storage.assets`、用户选择目录读取与安全文件保存权限。
- `web/`：可切换 compact/expanded 的群聊、轻应用与角色资源管理 UI；两个形态复用同一 DOM、router 与状态。
- `src/fantareal_mobile_chat/`：不联网的 JSON-RPC 2.0 stdio service、per-card 原子 JSON 存储与严格资源包导入。
- `src/fantareal_mobile_chat/prompts/`：随 wheel 打包的群聊与各轻应用生成契约。
- `docs/mc1b-presentation-spec.md`：窗口状态、逻辑尺寸、断点、关闭/恢复与 Host/Web 边界。
- `schemas/`：群聊、轻应用、交互应用、Prompt profile 与资源包 JSON Schema。
- `resources/empty-pack/`：不包含第三方素材的空资源包示例。
- `tests/`：manifest、schema、离线 UI、Python service 与仓库内容审计。

Service 不启动 FastAPI/HTTP，不读取主程序私有文件或 API Key，也不直接访问模型供应商。Web UI 通过 Host `character.context.read`、`llm.generate`、`storage.assets`、`files.user-selected.directory-read` 和 service RPC 组成闭环。所有模型生成只由当前窗口中的用户点击或提交操作触发；关闭窗口后不会继续生成内容。

## 本地验证

要求 Node.js 20+ 与 uv：

```powershell
npm run check
npm test
uv lock --check
uv run --locked ruff check .
uv run --locked python -X utf8 -m pytest
uv run --locked python tools/build_release.py --output-dir dist
```

最后一条命令会生成不包含测试、缓存、用户数据或第三方素材的可复现 Extension ZIP，并同时写出 SHA-256 文件。CI 还会构建 wheel，在 Python 3.11 隔离环境中运行 stdio smoke，并把三类产物作为同一 workflow artifact 上传。

## 在 Fantareal 中安装

1. 打开新 PC 客户端的插件页面。
2. 选择“从本地目录安装”。
3. 选择本仓库根目录。
4. 在插件卡片的“资源额度”中设置允许使用的 Assets quota；`0` 表示禁止新资源写入。
5. 关闭并重新打开“小手机”，让 service session 取得新的 quota。
6. 验证非模态窗口、主页/群聊/轻应用、compact/expanded、主题、关闭与二次打开。
7. 打开“资源”，选择包含 `resource-pack.json` 的目录，核对授权、用途、预览与 quota 后确认导入。
8. 创建群聊并管理成员，验证用户发送、角色续聊、停止生成、失败重试和清空消息。
9. 选择旧版小手机数据目录，先核对导入预览，再确认合并或替换。

## 安装与生命周期

- 本地目录安装选择仓库根目录或解压后的 `Fantareal-Mobile-Chat-<version>/`。
- GitHub URL 安装使用 `https://github.com/cOkieeman/Fantareal-Mobile-Chat`；Host 固定解析出的 commit，不跟随未确认的新提交。
- 同权限 update 可直接准备；新增权限必须再次确认，拒绝后保留当前 active package。
- manifest 损坏或内容校验失败的 update 不得替换当前 package。
- rollback 只切换 package 历史，保留已授权的 namespaced storage（本插件当前为 data 和 assets）。
- disable/enable 保留安装记录与持久化数据；uninstall 删除 package，但保留用户数据，后续清理必须由用户显式执行。

当前 RC 只生成 CI artifact，不会由 workflow 自动创建 GitHub Release。tag、预发布 Release 和镜像同步需要人工审批。

## 数据与素材边界

- 不在仓库中保存 API Key、角色卡、聊天记录、用户数据、模型或日志。
- `resources/empty-pack/` 只描述资源包格式，不包含旧版 400 个表情文件。
- 运行数据只写入 Host 提供的 namespaced `storage.data/cards/<cardUid>/`。
- 用户资源只写入 `storage.assets/cards/<cardUid>/resource-packs/<packId>/`；损坏资源不会阻断文本聊天。
- 资源包必须声明名称、来源与是否允许再分发；预览后内容发生变化会拒绝导入。
- 四套视觉 preset 与明暗层只改变 CSS 材质和颜色，不修改 Prompt、模型请求或 RP 世界风格；背景和表情选择也不会自动调用模型。
- 表情消息只保存 `packId + assetId + alt` 稳定引用；Prompt 仅接收 `[表情：说明]` 文本占位，不包含资源路径、二进制或 data URL。
- `avatar-decoration` 仅为旧资源包兼容导入值，已经 deprecated；当前产品不提供选择或应用入口，新资源包应只使用 `sticker` 与 `background`。
- 旧数据只允许由用户显式选择目录后导入，插件不得自动扫描旧 WebUI。

### 当前角色数据备份与重置

- 备份对象包含当前角色的群组、消息、日记、日程、动态、论坛、邮箱、电话、直播、人物辅助草稿、通知、Prompt profile、视觉 preset 和资源引用。
- 备份不包含资源图片本体、API Key、Host 私有角色卡/数据库或其他角色的数据；恢复时缺失的背景与表情会安全回退。
- 设置页可从用户授权且包含 `mobile-chat-backup.json` 的目录执行“预览 → 核对摘要 → 确认恢复”。
- “重置当前角色小手机数据”会清除上述业务数据、Prompt profile 与外观选择，但保留已导入资源包；删除资源包是独立操作。
- 设置页“导出备份”先从 service 获取当前角色的备份对象，再调用 Host `saveFile()` 打开系统保存对话框；插件不能指定任意绝对路径，成功结果也不包含用户路径。
- 导出文件固定建议名为 `mobile-chat-backup.json`，使用 UTF-8 JSON；取消保存不会产生文件，写入由 Host 原子提交。

## License 状态

License 暂未选择。需要先完成代码、字体与素材权属核对；不要根据旧实现或仓库名称推断许可证。
