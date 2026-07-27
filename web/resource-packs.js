(() => {
  "use strict";

  const KIND_LABELS = Object.freeze({
    sticker: "表情",
    background: "背景",
    "avatar-decoration": "头像装饰",
  });

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
    } = dependencies;
    const byId = (id) => document.getElementById(id);
    const nodes = {
      count: byId("resource-pack-count"),
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
    };
    const state = {
      context: null,
      packs: [],
      usageBytes: 0,
      quotaBytes: 0,
      preview: null,
      loading: false,
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
      item.className = "background-job-card resource-pack-card";
      item.dataset.status = pack.status === "damaged" ? "damaged" : "ready";

      const heading = document.createElement("div");
      heading.className = "background-job-heading resource-pack-heading";
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
      meta.className = "background-job-meta";
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

    function render() {
      nodes.list.replaceChildren(...state.packs.map(renderPack));
      nodes.count.textContent = state.context
        ? `${state.packs.length} 个资源包`
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
        const result = await invokeService("mobile.resources.list", {
          context: state.context,
        });
        state.packs = Array.isArray(result.packs) ? result.packs : [];
        state.usageBytes = Number(result.usageBytes) || 0;
        state.quotaBytes = Number(result.quotaBytes) || 0;
        if (!quiet) setNotice("已刷新当前角色的资源包。", "success");
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
        state.usageBytes = 0;
        state.quotaBytes = 0;
        state.preview = null;
        if (nodes.dialog.open) nodes.dialog.close();
      }
      if (state.context) await refresh({ quiet: true });
      else render();
    }

    nodes.refresh.addEventListener("click", () => void refresh());
    nodes.importPack.addEventListener("click", () => void chooseDirectory());
    nodes.importFirst.addEventListener("click", () => void chooseDirectory());
    nodes.clear.addEventListener("click", () => void clearPacks());
    nodes.form.addEventListener("submit", (event) => void importPack(event));
    nodes.dialog.addEventListener("close", () => {
      if (!state.loading) state.preview = null;
    });

    render();
    return {
      bindContext,
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
