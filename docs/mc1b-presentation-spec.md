# MC1B Presentation Specification

状态：`frozen`。用户已于 2026-07-26 确认可操作原型的视觉与交互。该文档冻结 Web 原型与未来 MC2 Host 窗口之间的职责边界，不代表 Host API 1.2 已实现。

## 窗口状态

| 状态 | 建议逻辑尺寸 | Host 行为 | Web 内容 |
| --- | --- | --- | --- |
| `closed` | 无 | 销毁前台 Web/service session；不隐式保留后台任务 | 无运行页面 |
| `compact` | 默认 `390×700`；最小 `360×620`；最大 `440×820` | 非模态独立窗口，允许与主 Chat 并行 | 单内容列；主页和群聊纵向切换 |
| `expanded` | 默认 `760×720`；最小 `680×620`；最大 `960×860` | 非模态独立窗口，沿用同一 session | 左侧应用导航 + 右侧内容；不复制第二套业务页面 |

当前 `1180×820` modal 只用于兼容预览。它不是最终窗口尺寸，也不能证明 MC2 原生窗口能力已经完成。

## 视觉连续性

- 默认 `midnight` 主题延续旧 WebUI 的深蓝黑玻璃手机、蓝色主强调色（`#4f83e8` / `#3d72dc`）和柔和蓝边框；`mist` 只作为浅色适配预览。
- compact 保留手机状态栏、设备 header、时间/运势/天气 hero、四列应用桌面与底部常驻导航。
- compact 的底部导航和 expanded 的左侧导航是同一个 `app-navigation` DOM，只由 CSS 重排；不得复制第二套导航状态。
- 群聊保留深色消息区、角色灰蓝气泡、用户蓝色渐变气泡和底部 composer 的交互识别。
- 不迁移旧 FastAPI、运行时 DOM 注入、私有数据、旧主题素材或 400 个旧表情文件；这里只迁移布局语言、导航结构、配色与交互感。

## 模式切换

- 用户通过标题区的“展开/收起”按钮切换；按钮使用 `aria-pressed` 暴露当前状态。
- compact 与 expanded 共用同一 DOM、screen state 和 theme state，切换不重启页面、不丢失当前 home/chat 位置。
- Web 原型只维护当前 session 内的 presentation state，不使用 `localStorage`、`sessionStorage` 或任意文件路径。
- MC2 Host 负责保存上次 mode、size、position，并在再次打开时把 presentation 传给 Web；Web 不拥有原生窗口尺寸和位置。
- Host 窗口与 Web 内容切换建议使用 `180–220ms` ease；`prefers-reduced-motion` 下取消非必要动画。

## 响应式内容规则

| Web 内容宽度 | 规则 |
| --- | --- |
| `<680px` | 单列安全回退；expanded 导航改为顶部横向导航，仅保留可用入口；不得产生页面级横向滚动 |
| `≥680px` 且 expanded | 显示 `176px` 应用导航与弹性内容区；消息最大宽度收窄，保持阅读节奏 |
| `≥1041px` 的兼容预览容器 | 可同时显示说明区和设备；说明区不属于最终手机窗口 |

Host 应遵守 expanded 的 `680px` 最小逻辑宽度。窄于该值的规则只用于工具容器、浏览器调试和异常恢复，不是日常 expanded 窗口目标。

## 入口、返回与关闭

- 全局应用入口是主要 launcher；主 Chat 可以提供快捷入口，但不得把业务绑定到 `ChatPage.qml`。
- compact 主页使用四列应用宫格，并在底部显示常用导航；expanded 把同一个常用导航重排到左侧。两种模式都只启用“手机桌面”和“口袋群聊”。
- 进入群聊后把键盘焦点移到群聊标题；返回主页后把焦点移到主页标题，避免屏幕阅读器停留在隐藏控件。
- 禁用入口保持可见并明确 disabled，不响应点击或键盘激活。
- “关闭预览”只调用可选的 `fantarealExtension.close()`；无 Host bridge 时仅显示浏览器预览提示。
- 关闭结束前台 session。没有 `background.jobs` 授权时，不允许页面关闭后继续运行定时器、模型请求或 service。

## 恢复与多屏边界（MC2）

- Host 持久化 `{ mode, width, height, x, y, screenId, dpi }`，Web 不持久化这些字段。
- 恢复时先匹配可用屏幕与 DPI，再把尺寸约束到该 mode 的 min/max，最后把窗口位置 clamp 到可见工作区。
- 原屏幕消失、DPI 差异过大或位置完全不可见时，使用该 mode 默认尺寸并在主窗口所在屏幕居中。
- 切换角色不改变窗口 mode，但必须更新 `cardUid + contextRevision + sessionId`；旧请求不得写入新角色数据域。

## MC1B 验收

- `390×700` compact、`760×720` expanded、`1180×820` 兼容容器均无裁切或不可达操作。
- home/chat、返回、模式切换、主题切换、关闭 fallback 和 disabled 入口语义明确。
- 键盘 Tab 顺序与视觉顺序一致，所有可用按钮有可见 focus ring。
- 暗浅色、`prefers-reduced-motion` 和页面级 overflow 检查通过。
- 用户已确认视觉与交互规格，MC1B 状态为 `frozen`；完成 MC1A 真实 Host GUI 验收后才允许进入 MC2。
