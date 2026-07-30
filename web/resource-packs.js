(() => {
  "use strict";

  const KIND_LABELS = Object.freeze({
    sticker: "表情",
    background: "背景",
    "avatar-decoration": "头像装饰（已停用）",
  });
  const ASSET_PAGE_SIZE = 48;

  function createController(dependencies) {
    const {
      host,
      invokeService,
      setNotice,
      errorMessage,
      errorCode,
      isContextFailure,
      syncContext,
      confirmAction,
      sendSticker,
      setTheme,
    } = dependencies;
    const byId = (id) => document.getElementById(id);
    const nodes = {
      count: byId("resource-pack-count"),
      tabs: document.querySelectorAll(".resource-tabs [data-resource-tab]"),
      tabTriggers: document.querySelectorAll("[data-resource-tab]"),
      stickerPanel: byId("sticker-library-panel"),
      stickerList: byId("sticker-library-list"),
      stickerEmpty: byId("sticker-library-empty"),
      stickerCount: byId("sticker-library-count"),
      loadMoreStickers: byId("load-more-stickers"),
      backgroundPanel: byId("background-library-panel"),
      backgroundList: byId("background-library-list"),
      backgroundEmpty: byId("background-library-empty"),
      backgroundCount: byId("background-library-count"),
      loadMoreBackgrounds: byId("load-more-backgrounds"),
      managementPanel: byId("resource-management-panel"),
      list: byId("resource-pack-list"),
      empty: byId("resource-pack-empty"),
      refresh: byId("refresh-resource-packs"),
      importPack: byId("import-resource-pack"),
      importFirst: byId("import-first-resource-pack"),
      clear: byId("clear-resource-packs"),
      quotaCopy: byId("resource-quota-copy"),
      quotaProgress: byId("resource-quota-progress"),
      boundary: byId("resource-boundary"),
      dialog: byId("resource-import-dialog"),
      form: byId("resource-import-form"),
      importName: byId("resource-import-name"),
      importVersion: byId("resource-import-version"),
      importDescription: byId("resource-import-description"),
      importDirectory: byId("resource-import-directory"),
      importKinds: byId("resource-import-kinds"),
      licenseName: byId("resource-license-name"),
      licenseSource: byId("resource-license-source"),
      licenseRedistribution: byId("resource-license-redistribution"),
      licenseAttribution: byId("resource-license-attribution"),
      licenseUrl: byId("resource-license-url"),
      importQuotaCopy: byId("resource-import-quota-copy"),
      importQuotaProgress: byId("resource-import-quota-progress"),
      importQuotaNote: byId("resource-import-quota-note"),
      previewCount: byId("resource-preview-count"),
      previewGrid: byId("resource-preview-grid"),
      importError: byId("resource-import-error"),
      confirmImport: byId("confirm-resource-import"),
      presetButtons: document.querySelectorAll("[data-appearance-preset]"),
      backgroundName: byId("appearance-background-name"),
      clearBackground: byId("clear-appearance-background"),
      stickerPicker: byId("sticker-picker-dialog"),
      stickerPickerList: byId("sticker-picker-list"),
      stickerPickerEmpty: byId("sticker-picker-empty"),
      loadMorePickerStickers: byId("load-more-picker-stickers"),
    };
    const state = {
      context: null,
      packs: [],
      stickerAssets: [],
      stickerTotal: 0,
      backgroundAssets: [],
      backgroundTotal: 0,
      appearance: {
        schemaVersion: 1,
        preset: "modern",
        tone: "midnight",
        background: null,
      },
      usageBytes: 0,
      quotaBytes: 0,
      preview: null,
      activeTab: "stickers",
      loading: false,
      assetCache: new Map(),
    };

    function sameContext(left, right) {
      if (window.MobileChatGeneratedApp?.sameContext) {
        return window.MobileChatGeneratedApp.sameContext(left, right);
      }
      return Boolean(
        left
        && right
        && left.cardUid === right.cardUid
        && left.contextRevision === right.contextRevision
        && left.sessionId === right.sessionId,
      );
    }

    function formatBytes(value) {
      const bytes = Math.max(0, Number(value) || 0);
      const units = ["B", "KiB", "MiB", "GiB", "TiB"];
      let amount = bytes;
      let unit = 0;
      while (amount >= 1024 && unit < units.length - 1) {
        amount /= 1024;
        unit += 1;
      }
      const digits = unit === 0 || amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
      return `${amount.toFixed(digits)} ${units[unit]}`;
    }

    function resourceError(error) {
      const messages = {
        assets_quota_unconfigured: "Host 尚未设置资源额度。请在主程序的插件管理页设置后，关闭并重新打开小手机。",
        assets_quota_exceeded: "导入后会超过资源额度，请提高 quota 或删除不再使用的资源包。",
        resource_pack_invalid: "resource-pack.json 格式无效或缺少必填字段。",
        resource_pack_unsafe: "资源包包含不安全路径、符号链接或 junction。",
        resource_pack_corrupt: "资源包中存在损坏或类型不符的媒体文件。",
        resource_pack_changed: "资源包在预览后发生变化，请重新选择目录。",
        resource_pack_not_found: "资源包已不存在，请刷新列表。",
        resource_asset_not_found: "资源已不存在或用途不匹配。",
        storage_unavailable: "Host 的资源存储当前不可用。",
        storage_unsafe: "Host 的资源存储包含不安全路径。",
        storage_write_failed: "资源包无法原子写入，请检查磁盘状态后重试。",
      };
      return messages[errorCode(error)] || errorMessage(error);
    }

    function kindSummary(kindCounts) {
      return Object.entries(kindCounts || {})
        .filter(([, count]) => Number(count) > 0)
        .map(([kind, count]) => `${KIND_LABELS[kind] || kind} ${count}`)
        .join(" · ");
    }

    function makeButton(label, action, className = "") {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.className = className;
      button.disabled = state.loading || !state.context;
      button.addEventListener("click", () => void action());
      return button;
    }

    function makePreview(asset) {
      const figure = document.createElement("figure");
      figure.className = "resource-preview";
      if (asset?.dataUrl) {
        const image = document.createElement("img");
        image.src = asset.dataUrl;
        image.alt = String(asset.alt || asset.id || "资源预览");
        image.loading = "lazy";
        image.decoding = "async";
        figure.append(image);
      } else {
        const placeholder = document.createElement("span");
        placeholder.className = "resource-preview-placeholder";
        placeholder.textContent = KIND_LABELS[asset?.kind] || "资源";
        figure.append(placeholder);
      }
      const caption = document.createElement("figcaption");
      caption.textContent = String(asset?.alt || asset?.id || "未命名资源");
      figure.append(caption);
      return figure;
    }

    function assetKey(asset) {
      return `${asset?.packId || ""}\u0000${asset?.assetId || asset?.id || ""}`;
    }

    function assetRef(asset) {
      return {
        packId: String(asset.packId || ""),
        assetId: String(asset.assetId || asset.id || ""),
        alt: String(asset.alt || asset.id || "未命名"),
      };
    }

    function rememberAsset(asset) {
      if (asset?.dataUrl) state.assetCache.set(assetKey(asset), asset);
      return asset;
    }

    async function resolveAsset(reference, kind = "sticker") {
      const key = assetKey(reference);
      const cached = state.assetCache.get(key);
      if (cached?.dataUrl) return cached;
      const result = await invokeService("mobile.resources.asset.get", {
        context: state.context,
        packId: reference.packId,
        assetId: reference.assetId || reference.id,
        kind,
      });
      return rememberAsset(result.asset);
    }

    function applyAppearance(payload) {
      const appearance = payload?.appearance || state.appearance;
      state.appearance = appearance;
      document.documentElement.dataset.preset = appearance.preset || "modern";
      setTheme(appearance.tone || "midnight");
      const backgroundAsset = payload?.backgroundAsset || null;
      if (backgroundAsset?.dataUrl) {
        rememberAsset(backgroundAsset);
        document.documentElement.style.setProperty(
          "--user-background-image",
          `url("${backgroundAsset.dataUrl}")`,
        );
        document.documentElement.dataset.customBackground = "true";
      } else {
        document.documentElement.style.removeProperty("--user-background-image");
        delete document.documentElement.dataset.customBackground;
      }
      for (const button of nodes.presetButtons) {
        const active = button.dataset.appearancePreset === appearance.preset;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      }
      nodes.backgroundName.textContent = appearance.background?.alt || "默认背景";
      nodes.clearBackground.disabled = state.loading || !appearance.background;
      if (payload?.fallback === "background_missing") {
        setNotice("原背景资源已不存在，已恢复默认背景。", "error");
      }
    }

    async function updateAppearance(patch) {
      if (!state.context || state.loading) return false;
      state.loading = true;
      render();
      try {
        const result = await invokeService("mobile.appearance.update", {
          context: state.context,
          appearance: patch,
        });
        applyAppearance(result);
        setNotice("外观已保存到当前角色。", "success");
        return true;
      } catch (error) {
        setNotice(resourceError(error), "error");
        if (isContextFailure(error)) await syncContext();
        return false;
      } finally {
        state.loading = false;
        render();
      }
    }

    async function hydrateSticker(message, target) {
      const reference = message?.sticker;
      if (!reference || !state.context) return;
      try {
        const asset = await resolveAsset(reference, "sticker");
        if (!target.isConnected) return;
        const image = document.createElement("img");
        image.src = asset.dataUrl;
        image.alt = String(reference.alt || asset.alt || "表情");
        image.decoding = "async";
        target.replaceChildren(image);
        target.classList.remove("is-missing");
      } catch {
        if (!target.isConnected) return;
        target.textContent = `${message.content}（资源已移除）`;
        target.classList.add("is-missing");
      }
    }

    function renderBoundary() {
      nodes.boundary.replaceChildren();
      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = state.quotaBytes > 0 ? "i" : "!";
      const copy = document.createElement("p");
      const title = document.createElement("strong");
      if (!state.context) {
        title.textContent = "等待角色 Context";
        copy.append(title, document.createTextNode(" 请先在主程序载入角色卡。"));
      } else if (state.quotaBytes <= 0) {
        title.textContent = "资源额度尚未配置";
        copy.append(
          title,
          document.createTextNode(
            " 请在主程序“插件管理 → 小手机 → 资源额度”中设置，随后关闭并重新打开小手机。",
          ),
        );
      } else if (state.packs.some((pack) => pack.status === "damaged")) {
        title.textContent = "发现损坏资源包";
        copy.append(title, document.createTextNode(" 可以单独删除；文本聊天与其他轻应用不会受影响。"));
      } else {
        title.textContent = "用户自有资源";
        copy.append(title, document.createTextNode(" 资源按当前角色隔离；导入前会再次校验授权、内容与 quota。"));
      }
      nodes.boundary.append(icon, copy);
    }

    function renderPack(pack) {
      const item = document.createElement("li");
      item.className = "resource-pack-card";
      item.dataset.status = pack.status === "damaged" ? "damaged" : "ready";

      const heading = document.createElement("div");
      heading.className = "resource-pack-heading";
      const copy = document.createElement("div");
      const titleRow = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = String(pack.name || pack.id || "未命名资源包");
      const status = document.createElement("span");
      status.className = "resource-status";
      status.textContent = pack.status === "damaged" ? "损坏" : `v${pack.version || "—"}`;
      titleRow.append(title, status);
      const description = document.createElement("p");
      description.textContent = pack.status === "damaged"
        ? String(pack.error || "资源包无法读取")
        : String(pack.description || "未提供说明");
      copy.append(titleRow, description);
      heading.append(
        copy,
        makeButton("删除", () => deletePack(pack), "danger"),
      );

      const previews = document.createElement("div");
      previews.className = "resource-card-previews";
      for (const asset of (pack.previewAssets || []).slice(0, 5)) {
        previews.append(makePreview(asset));
      }
      if (previews.childElementCount === 0) {
        const noPreview = document.createElement("span");
        noPreview.className = "resource-no-preview";
        noPreview.textContent = pack.status === "damaged" ? "无法生成预览" : "资源较大，未内嵌缩略图";
        previews.append(noPreview);
      }

      const meta = document.createElement("div");
      meta.className = "resource-pack-meta";
      const counts = kindSummary(pack.kindCounts);
      const usage = document.createElement("span");
      usage.textContent = `${pack.assetCount || 0} 项 · ${formatBytes(pack.totalSizeBytes)}`;
      meta.append(usage);
      if (counts) {
        const kinds = document.createElement("span");
        kinds.textContent = counts;
        meta.append(kinds);
      }
      if (pack.status !== "damaged" && pack.license?.name) {
        const license = document.createElement("span");
        license.textContent = `授权：${pack.license.name}`;
        meta.append(license);
      }

      item.append(heading, previews, meta);
      return item;
    }

    function stickerAssets() {
      return state.stickerAssets.filter((asset) => asset.kind === "sticker");
    }

    function renderSticker(asset) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "sticker-library-card";
      card.append(makePreview(asset));
      const pack = document.createElement("small");
      pack.textContent = String(asset.packName || "表情包");
      card.append(pack);
      card.disabled = state.loading || !state.context;
      card.addEventListener("click", async () => {
        const sent = await sendSticker(assetRef(asset));
        if (sent && nodes.stickerPicker.open) nodes.stickerPicker.close();
      });
      return card;
    }

    function renderBackground(asset) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "background-library-card";
      const selected = (
        state.appearance.background?.packId === asset.packId
        && state.appearance.background?.assetId === asset.id
      );
      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-pressed", String(selected));
      card.append(makePreview(asset));
      const copy = document.createElement("span");
      copy.append(
        document.createElement("strong"),
        document.createElement("small"),
      );
      copy.firstElementChild.textContent = String(asset.alt || asset.id || "背景");
      copy.lastElementChild.textContent = String(asset.packName || "背景包");
      card.append(copy);
      card.disabled = state.loading || !state.context;
      card.addEventListener("click", () => void updateAppearance({
        background: assetRef(asset),
      }));
      return card;
    }

    function renderStickerPicker() {
      nodes.stickerPickerList.replaceChildren(...state.stickerAssets.map(renderSticker));
      nodes.stickerPickerList.hidden = state.stickerAssets.length === 0;
      nodes.stickerPickerEmpty.hidden = state.stickerAssets.length > 0;
      nodes.loadMorePickerStickers.hidden = (
        state.stickerAssets.length >= state.stickerTotal
        || state.stickerAssets.length === 0
      );
      nodes.loadMorePickerStickers.disabled = state.loading || !state.context;
    }

    function openStickerPicker() {
      if (!state.context) return;
      renderStickerPicker();
      nodes.stickerPicker.showModal();
      nodes.stickerPicker.querySelector("button")?.focus();
    }

    function selectTab(tab) {
      state.activeTab = ["stickers", "backgrounds", "manage"].includes(tab)
        ? tab
        : "stickers";
      render();
    }

    function render() {
      const stickers = stickerAssets();
      const backgrounds = state.backgroundAssets;
      nodes.stickerList.replaceChildren(...stickers.map(renderSticker));
      nodes.stickerCount.textContent = state.stickerTotal > stickers.length
        ? `已加载 ${stickers.length} / ${state.stickerTotal} 个表情`
        : `${stickers.length} 个可发送表情`;
      nodes.stickerEmpty.hidden = stickers.length > 0 || !state.context;
      nodes.stickerList.hidden = stickers.length === 0;
      nodes.loadMoreStickers.hidden = (
        stickers.length >= state.stickerTotal
        || stickers.length === 0
      );
      nodes.backgroundList.replaceChildren(...backgrounds.map(renderBackground));
      nodes.backgroundCount.textContent = state.backgroundTotal > backgrounds.length
        ? `已加载 ${backgrounds.length} / ${state.backgroundTotal} 个背景`
        : `${backgrounds.length} 个可用背景`;
      nodes.backgroundEmpty.hidden = backgrounds.length > 0 || !state.context;
      nodes.backgroundList.hidden = backgrounds.length === 0;
      nodes.loadMoreBackgrounds.hidden = (
        backgrounds.length >= state.backgroundTotal
        || backgrounds.length === 0
      );
      nodes.stickerPanel.hidden = state.activeTab !== "stickers";
      nodes.backgroundPanel.hidden = state.activeTab !== "backgrounds";
      nodes.managementPanel.hidden = state.activeTab !== "manage";
      for (const tab of nodes.tabs) {
        const active = tab.dataset.resourceTab === state.activeTab;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
      }
      nodes.list.replaceChildren(...state.packs.map(renderPack));
      nodes.count.textContent = state.context
        ? `${stickers.length} 个表情 · ${backgrounds.length} 个背景 · ${state.packs.length} 个资源包`
        : "等待角色 Context";
      nodes.empty.hidden = state.packs.length > 0 || !state.context;
      nodes.list.hidden = state.packs.length === 0;

      const quotaMax = Math.max(1, state.quotaBytes);
      nodes.quotaProgress.max = quotaMax;
      nodes.quotaProgress.value = Math.min(state.usageBytes, quotaMax);
      nodes.quotaCopy.textContent = state.quotaBytes > 0
        ? `${formatBytes(state.usageBytes)} / ${formatBytes(state.quotaBytes)}`
        : `${formatBytes(state.usageBytes)} / 未配置`;

      const disabled = state.loading || !state.context;
      nodes.refresh.disabled = disabled;
      nodes.importPack.disabled = disabled;
      nodes.importFirst.disabled = disabled;
      nodes.clear.disabled = disabled || state.packs.length === 0;
      nodes.clearBackground.disabled = disabled || !state.appearance.background;
      nodes.loadMoreStickers.disabled = disabled;
      nodes.loadMoreBackgrounds.disabled = disabled;
      renderStickerPicker();
      renderBoundary();
    }

    function renderImportPreview() {
      const preview = state.preview;
      if (!preview) return;
      nodes.importName.textContent = String(preview.name || preview.id || "未命名资源包");
      nodes.importVersion.textContent = `v${preview.version || "—"} · ${preview.assetCount || 0} 项 · ${formatBytes(preview.totalSizeBytes)}`;
      nodes.importDescription.textContent = String(preview.description || "未提供资源包说明。");
      nodes.importDirectory.textContent = `所选目录：${preview.directoryName || "未命名目录"}`;

      nodes.importKinds.replaceChildren();
      for (const [kind, count] of Object.entries(preview.kindCounts || {})) {
        const tag = document.createElement("span");
        tag.textContent = `${KIND_LABELS[kind] || kind} ${count}`;
        nodes.importKinds.append(tag);
      }

      const license = preview.license || {};
      nodes.licenseName.textContent = String(license.name || "未声明");
      nodes.licenseSource.textContent = String(license.source || "未声明");
      nodes.licenseRedistribution.textContent = license.redistributionAllowed
        ? "允许"
        : "不允许";
      nodes.licenseAttribution.textContent = String(license.attribution || "无");
      nodes.licenseUrl.textContent = String(license.url || "无");

      const quotaMax = Math.max(1, Number(preview.quotaBytes) || 0);
      nodes.importQuotaProgress.max = quotaMax;
      nodes.importQuotaProgress.value = Math.min(Number(preview.finalUsageBytes) || 0, quotaMax);
      nodes.importQuotaCopy.textContent = Number(preview.quotaBytes) > 0
        ? `${formatBytes(preview.finalUsageBytes)} / ${formatBytes(preview.quotaBytes)}`
        : `${formatBytes(preview.finalUsageBytes)} / 未配置`;
      if (Number(preview.quotaBytes) <= 0) {
        nodes.importQuotaNote.textContent = "请先在主程序插件管理页设置资源额度，然后关闭并重新打开小手机。";
      } else if (!preview.fitsQuota) {
        nodes.importQuotaNote.textContent = "导入后会超过当前 quota，请提高额度或删除不再使用的资源包。";
      } else if (Number(preview.replacedBytes) > 0) {
        nodes.importQuotaNote.textContent = `将原子替换同 ID 资源包，并释放旧版本的 ${formatBytes(preview.replacedBytes)}。`;
      } else {
        nodes.importQuotaNote.textContent = "额度充足；确认后会原子安装到当前角色的资源目录。";
      }

      nodes.previewGrid.replaceChildren(
        ...(preview.previewAssets || []).map(makePreview),
      );
      if (nodes.previewGrid.childElementCount === 0) {
        const empty = document.createElement("p");
        empty.className = "resource-no-preview";
        empty.textContent = "资源超过内嵌预览限制，但仍会在确认导入时完整校验。";
        nodes.previewGrid.append(empty);
      }
      nodes.previewCount.textContent = `显示 ${(preview.previewAssets || []).length} / ${preview.assetCount || 0}`;
      nodes.confirmImport.disabled = state.loading || !preview.fitsQuota;
    }

    async function refresh({ quiet = false } = {}) {
      if (!state.context || state.loading) return;
      state.loading = true;
      render();
      try {
        const [result, stickers, backgrounds, appearance] = await Promise.all([
          invokeService("mobile.resources.list", {
            context: state.context,
          }),
          invokeService("mobile.resources.assets.list", {
            context: state.context,
            kind: "sticker",
            offset: 0,
            limit: ASSET_PAGE_SIZE,
          }),
          invokeService("mobile.resources.assets.list", {
            context: state.context,
            kind: "background",
            offset: 0,
            limit: ASSET_PAGE_SIZE,
          }),
          invokeService("mobile.appearance.get", {
            context: state.context,
          }),
        ]);
        state.packs = Array.isArray(result.packs) ? result.packs : [];
        state.stickerAssets = Array.isArray(stickers.assets)
          ? stickers.assets.map(rememberAsset)
          : [];
        state.stickerTotal = Math.max(state.stickerAssets.length, Number(stickers.total) || 0);
        state.backgroundAssets = Array.isArray(backgrounds.assets)
          ? backgrounds.assets.map(rememberAsset)
          : [];
        state.backgroundTotal = Math.max(
          state.backgroundAssets.length,
          Number(backgrounds.total) || 0,
        );
        state.usageBytes = Number(result.usageBytes) || 0;
        state.quotaBytes = Number(result.quotaBytes) || 0;
        applyAppearance(appearance);
        if (!quiet) setNotice("已刷新当前角色的资源包。", "success");
      } catch (error) {
        setNotice(resourceError(error), "error");
        if (isContextFailure(error)) await syncContext();
      } finally {
        state.loading = false;
        render();
      }
    }

    async function loadMoreAssets(kind) {
      if (!state.context || state.loading) return;
      const isSticker = kind === "sticker";
      const current = isSticker ? state.stickerAssets : state.backgroundAssets;
      const total = isSticker ? state.stickerTotal : state.backgroundTotal;
      if (current.length >= total) return;
      const bound = { ...state.context };
      state.loading = true;
      render();
      try {
        const result = await invokeService("mobile.resources.assets.list", {
          context: bound,
          kind,
          offset: current.length,
          limit: ASSET_PAGE_SIZE,
        });
        if (!sameContext(state.context, bound)) return;
        const page = Array.isArray(result.assets)
          ? result.assets.map(rememberAsset)
          : [];
        if (isSticker) {
          state.stickerAssets.push(...page);
          state.stickerTotal = Math.max(
            state.stickerAssets.length,
            Number(result.total) || 0,
          );
        } else {
          state.backgroundAssets.push(...page);
          state.backgroundTotal = Math.max(
            state.backgroundAssets.length,
            Number(result.total) || 0,
          );
        }
      } catch (error) {
        setNotice(resourceError(error), "error");
        if (isContextFailure(error)) await syncContext();
      } finally {
        state.loading = false;
        render();
      }
    }

    async function chooseDirectory() {
      if (!state.context || state.loading) return;
      if (!host || typeof host.pickDirectory !== "function") {
        setNotice("当前 Host 不支持目录选择。", "error");
        return;
      }
      try {
        setNotice("请选择包含 resource-pack.json 的资源包目录…");
        const picked = await host.pickDirectory();
        const directoryToken = String(picked?.directoryToken || "");
        if (!directoryToken) throw new Error("Host 未返回有效目录授权");
        const preview = await invokeService("mobile.resources.preview", {
          context: state.context,
          directoryToken,
        });
        state.preview = { ...preview, directoryToken };
        nodes.importError.hidden = true;
        renderImportPreview();
        nodes.dialog.showModal();
        nodes.dialog.querySelector(".dialog-close")?.focus();
        setNotice("资源包预览完成，请核对授权与 quota。");
      } catch (error) {
        if (["file_selection_cancelled", "directory_selection_cancelled"].includes(errorCode(error))) {
          setNotice("已取消目录选择。");
        } else {
          setNotice(`无法预览资源包：${resourceError(error)}`, "error");
        }
        if (isContextFailure(error)) await syncContext();
      }
    }

    async function importPack(event) {
      event.preventDefault();
      const preview = state.preview;
      if (!preview || state.loading || !preview.fitsQuota) return;
      state.loading = true;
      nodes.confirmImport.disabled = true;
      nodes.importError.hidden = true;
      try {
        const result = await invokeService("mobile.resources.import", {
          context: state.context,
          directoryToken: preview.directoryToken,
          contentDigest: preview.contentDigest,
        });
        nodes.dialog.close();
        state.preview = null;
        state.loading = false;
        await refresh({ quiet: true });
        setNotice(`已导入资源包“${result.pack?.name || preview.name}”。`, "success");
      } catch (error) {
        state.loading = false;
        nodes.importError.textContent = resourceError(error);
        nodes.importError.hidden = false;
        renderImportPreview();
        if (isContextFailure(error)) {
          nodes.dialog.close();
          await syncContext();
        }
      }
    }

    async function deletePack(pack) {
      if (!state.context || state.loading) return;
      const confirmed = await confirmAction(
        "删除资源包？",
        `“${pack.name || pack.id}”会从当前角色的资源目录删除，无法撤销。`,
        "删除资源包",
      );
      if (!confirmed) return;
      state.loading = true;
      render();
      try {
        await invokeService("mobile.resources.delete", {
          context: state.context,
          packId: pack.id,
        });
        state.loading = false;
        await refresh({ quiet: true });
        setNotice(`已删除资源包“${pack.name || pack.id}”。`, "success");
      } catch (error) {
        state.loading = false;
        setNotice(resourceError(error), "error");
        if (isContextFailure(error)) await syncContext();
        render();
      }
    }

    async function clearPacks() {
      if (!state.context || state.loading || state.packs.length === 0) return;
      const confirmed = await confirmAction(
        "清空当前角色资源？",
        `将删除当前角色的 ${state.packs.length} 个资源包；群聊、轻应用数据和其他角色资源都会保留。`,
        "清空资源",
      );
      if (!confirmed) return;
      state.loading = true;
      render();
      try {
        await invokeService("mobile.resources.clear", { context: state.context });
        state.packs = [];
        state.usageBytes = 0;
        setNotice("已清空当前角色的资源包。", "success");
      } catch (error) {
        setNotice(resourceError(error), "error");
        if (isContextFailure(error)) await syncContext();
      } finally {
        state.loading = false;
        await refresh({ quiet: true });
      }
    }

    async function bindContext(context) {
      const changed = !sameContext(state.context, context);
      state.context = context ? { ...context } : null;
      if (changed) {
        state.packs = [];
        state.stickerAssets = [];
        state.stickerTotal = 0;
        state.backgroundAssets = [];
        state.backgroundTotal = 0;
        state.usageBytes = 0;
        state.quotaBytes = 0;
        state.preview = null;
        state.assetCache.clear();
        if (nodes.dialog.open) nodes.dialog.close();
        if (nodes.stickerPicker.open) nodes.stickerPicker.close();
      }
      if (state.context) await refresh({ quiet: true });
      else render();
    }

    nodes.refresh.addEventListener("click", () => void refresh());
    nodes.loadMoreStickers.addEventListener("click", () => void loadMoreAssets("sticker"));
    nodes.loadMorePickerStickers.addEventListener("click", () => void loadMoreAssets("sticker"));
    nodes.loadMoreBackgrounds.addEventListener(
      "click",
      () => void loadMoreAssets("background"),
    );
    nodes.importPack.addEventListener("click", () => void chooseDirectory());
    nodes.importFirst.addEventListener("click", () => void chooseDirectory());
    nodes.clear.addEventListener("click", () => void clearPacks());
    nodes.clearBackground.addEventListener("click", () => void updateAppearance({
      background: null,
    }));
    for (const button of nodes.presetButtons) {
      button.addEventListener("click", () => void updateAppearance({
        preset: button.dataset.appearancePreset,
      }));
    }
    nodes.form.addEventListener("submit", (event) => void importPack(event));
    for (const tab of nodes.tabTriggers) {
      tab.addEventListener("click", () => selectTab(tab.dataset.resourceTab));
    }
    nodes.dialog.addEventListener("close", () => {
      if (!state.loading) state.preview = null;
    });

    render();
    return {
      isResourceController: true,
      bindContext,
      hydrateSticker,
      openStickerPicker,
      updateAppearance,
      renderGeneration() {
        render();
      },
      open(screenId) {
        if (screenId === "resources") void refresh({ quiet: true });
      },
    };
  }

  window.MobileChatResourcePacks = Object.freeze({ createController });
})();
