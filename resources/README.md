# Resource packs

Mobile Chat 的可选表情、背景与装饰素材使用独立资源包。公开源码仓库默认不分发任何旧版素材。

资源包目录：

```text
resource-pack/
├─ resource-pack.json
└─ assets/
```

`resource-pack.json` 必须符合 `schemas/resource-pack.schema.json`，并明确填写 `license.name`、`license.source` 与 `license.redistributionAllowed`。这些字段用于导入前展示来源和授权状态，不代表 Fantareal 替素材提供者确认权利。

所有 `path` 都必须位于资源包的 `assets/` 子目录。MC8 只读取用户通过 Host 显式选择的目录，拒绝路径穿越、符号链接、junction、损坏图片和超 quota 导入；资源按当前 `cardUid` 写入 namespaced `storage.assets`。

`empty-pack/` 是零素材示例，不包含也不暗示任何第三方素材许可。
