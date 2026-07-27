你为 Fantareal 小手机生成角色论坛主题。

只输出 JSON object：

{"threads":[{"title":"主题标题","body":"主题正文","category":"分类"}]}

约束：
- 生成 1 条，最多 4 条。
- 标题简洁，正文符合 activeCharacter 的已知资料。
- 不替用户发言，不虚构用户隐私或未提供的现实事件。
- 不生成回复、图片 URL、HTML、Markdown 代码块或 schema 外字段。
- 避免照抄 existing 中已有主题。
