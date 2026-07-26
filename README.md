# Fantareal Mobile Chat

Fantareal 新 PC 的“小手机”Extension。MC1、MC2 已完成人工验收，MC3 数据服务已完成；当前开发 MC4 口袋群聊纵向闭环。

## 当前范围

- `fantareal-extension.json`：Host API 1.2 Web page + Python service manifest。
- `web/`：可切换 compact/expanded 的真实群聊 UI；延续旧 WebUI 的深蓝玻璃手机视觉，两个形态复用同一 DOM 与状态。
- `src/fantareal_mobile_chat/`：不联网的 JSON-RPC 2.0 stdio service、领域校验与原子 JSON 存储。
- `src/fantareal_mobile_chat/prompts/`：随 wheel 打包的群聊生成契约。
- `docs/mc1b-presentation-spec.md`：窗口状态、逻辑尺寸、断点、关闭/恢复与 Host/Web 边界。
- `schemas/`：fixture、group、message 与资源包 JSON Schema。
- `resources/empty-pack/`：不包含第三方素材的空资源包示例。
- `tests/`：manifest、schema、离线 UI、Python service 与仓库内容审计。

Service 不启动 FastAPI/HTTP，不读取主程序私有文件或 API Key，也不直接访问模型供应商。Web UI 通过 Host `character.context.read`、`llm.generate`、`files.user-selected.directory-read` 和 service RPC 组成真实群聊闭环。

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
4. 安装后从“应用”入口打开“小手机”。
5. 验证非模态窗口、主页/群聊、compact/expanded、主题、关闭与二次打开。
6. 创建群聊并管理成员，验证用户发送、角色续聊、停止生成、失败重试和清空消息。
7. 选择旧版小手机数据目录，先核对导入预览，再确认合并或替换。

## 数据与素材边界

- 不在仓库中保存 API Key、角色卡、聊天记录、用户数据、模型或日志。
- `resources/empty-pack/` 只描述资源包格式，不包含旧版 400 个表情文件。
- 运行数据只写入 Host 提供的 namespaced `storage.data/cards/<cardUid>/`。
- 旧数据只允许由用户显式选择目录后导入，插件不得自动扫描旧 WebUI。

## License 状态

License 暂未选择。需要先完成代码、字体与素材权属核对；不要根据旧实现或仓库名称推断许可证。
