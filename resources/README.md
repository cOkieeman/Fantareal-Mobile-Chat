# Resource packs

Mobile Chat 的可选表情与背景素材使用独立资源包。公开源码仓库默认不分发任何旧版素材。

资源包目录：

```text
resource-pack/
├─ resource-pack.json
└─ assets/
```

`resource-pack.json` 必须符合 `schemas/resource-pack.schema.json`，并明确填写 `license.name`、`license.source` 与 `license.redistributionAllowed`。这些字段用于导入前展示来源和授权状态，不代表 Fantareal 替素材提供者确认权利。

所有 `path` 都必须位于资源包的 `assets/` 子目录。MC8 只读取用户通过 Host 显式选择的目录，拒绝路径穿越、符号链接、junction、损坏图片和超 quota 导入；资源按当前 `cardUid` 写入 namespaced `storage.assets`。

当前可消费的 `kind` 为 `sticker` 和 `background`。`avatar-decoration` 仅为了兼容已存在的旧资源包而继续允许导入，schema 已标记 deprecated，Mobile Chat 不再提供它的选择或应用 UI；新资源包不得继续使用该值。

资源目录使用分页读取，前端可持续“加载更多”，不会只展示前 96 项。表情消息与当前背景只保存稳定的 `packId + assetId + alt` 引用；删除或替换资源包后会显示安全占位或回退默认背景。

`empty-pack/` 是零素材示例，不包含也不暗示任何第三方素材许可。
