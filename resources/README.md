# Resource packs

Mobile Chat 的可选表情、背景与装饰素材使用独立资源包。公开源码仓库默认不分发任何旧版素材。

资源包目录：

```text
resource-pack/
├─ resource-pack.json
└─ assets/
```

`resource-pack.json` 必须符合 `schemas/resource-pack.schema.json`。所有 `path` 都必须位于资源包的 `assets/` 子目录；未来导入流程还必须由 Host 执行用户选择、路径隔离、媒体类型检查、文件大小限制与 quota 确认。

`empty-pack/` 是零素材示例，不代表已经选择素材许可证。
