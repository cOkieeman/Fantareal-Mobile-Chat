(() => {
  "use strict";

  const root = document.documentElement;
  const host = window.fantarealExtension;
  const byId = (id) => document.getElementById(id);
  const screens = Array.from(document.querySelectorAll("[data-screen]"));
  const navigation = byId("app-navigation");
  const elements = {
    status: byId("fixture-status"),
    clock: byId("clock"),
    homeClock: byId("home-clock"),
    identitySubtitle: byId("identity-subtitle"),
    homeBoundary: byId("home-boundary"),
    presentationToggle: byId("presentation-toggle"),
    presentationLabel: byId("presentation-label"),
    themeToggle: byId("theme-toggle"),
    groupCount: byId("group-count"),
    groupList: byId("group-list"),
    groupEmpty: byId("group-empty"),
    chatTitle: byId("chat-title"),
    chatMembers: byId("chat-members"),
    messageList: byId("message-list"),
    messageEmpty: byId("message-empty"),
    generationState: byId("generation-state"),
    generationLabel: byId("generation-label"),
    retryGeneration: byId("retry-generation"),
    composerForm: byId("composer-form"),
    messageInput: byId("message-input"),
    continueChat: byId("continue-chat"),
    sendMessage: byId("send-message"),
    stopGeneration: byId("stop-generation"),
    createGroup: byId("create-group"),
    createFirstGroup: byId("create-first-group"),
    importGroups: byId("import-groups"),
    editGroup: byId("edit-group"),
    clearMessages: byId("clear-messages"),
    groupDialog: byId("group-dialog"),
    groupForm: byId("group-form"),
    groupDialogTitle: byId("group-dialog-title"),
    groupTitleInput: byId("group-title-input"),
    groupDescriptionInput: byId("group-description-input"),
    memberOptions: byId("member-options"),
    replyCountInput: byId("reply-count-input"),
    roleReplyInput: byId("role-reply-input"),
    groupFormError: byId("group-form-error"),
    deleteGroup: byId("delete-group"),
    importDialog: byId("import-dialog"),
    importForm: byId("import-form"),
    importSummary: byId("import-summary"),
    importFormError: byId("import-form-error"),
    confirmDialog: byId("confirm-dialog"),
    confirmTitle: byId("confirm-title"),
    confirmMessage: byId("confirm-message"),
  };

  const state = {
    presentation: root.dataset.presentation || "compact",
    screen: screens.find((screen) => !screen.hidden)?.dataset.screen || "home",
    chatView: root.dataset.chatView || "groups",
    hostContext: null,
    characterContext: null,
    context: null,
    groups: [],
    messages: [],
    activeGroupId: null,
    ready: false,
    syncing: false,
    busy: false,
    cancelRequested: false,
    editingGroupId: null,
    importPreview: null,
    retry: null,
    notice: "正在连接 Fantareal Host…",
    noticeTone: "neutral",
  };

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function activeGroup() {
    return state.groups.find((group) => group.groupId === state.activeGroupId) || null;
  }

  function sameContext(left, right) {
    return Boolean(
      left
      && right
      && left.cardUid === right.cardUid
      && left.contextRevision === right.contextRevision
      && left.sessionId === right.sessionId,
    );
  }

  function errorCode(error) {
    return typeof error?.code === "string" ? error.code : "unknown_error";
  }

  function errorMessage(error) {
    const code = errorCode(error);
    const known = {
      llm_provider_unconfigured: "请先在 Fantareal 设置中配置聊天模型。",
      llm_cancelled: "本次生成已取消。",
      llm_timeout: "模型生成超时，请重试。",
      llm_network_error: "模型服务连接失败，请检查设置后重试。",
      llm_http_error: "模型服务返回错误，请检查模型配置。",
      llm_response_invalid: "模型响应格式无效，请重试。",
      service_parse_failed: "模型返回内容无法解析，请重试。",
      service_generation_busy: "该群聊已有生成请求。",
      service_context_stale: "当前角色已变化，正在重新载入。",
      chat_context_changed: "当前角色或主会话已变化，正在重新载入。",
      permission_denied: "小手机缺少所需权限，请重新安装并确认授权。",
      service_permission_denied: "小手机数据服务缺少所需权限。",
    };
    return known[code] || String(error?.message || error || "操作失败");
  }

  function isContextFailure(error) {
    return ["service_context_stale", "chat_context_changed", "session_invalid"].includes(errorCode(error));
  }

  function setNotice(message, tone = "neutral") {
    state.notice = message;
    state.noticeTone = tone;
    renderStatus();
  }

  function renderStatus() {
    elements.status.textContent = state.notice;
    elements.status.dataset.tone = state.noticeTone;
  }

  function setPresentation(presentation) {
    state.presentation = presentation === "expanded" ? "expanded" : "compact";
    root.dataset.presentation = state.presentation;
    const expanded = state.presentation === "expanded";
    elements.presentationToggle.setAttribute("aria-pressed", String(expanded));
    elements.presentationLabel.textContent = expanded ? "收起" : "展开";
  }

  async function requestPresentation(presentation) {
    if (!host || typeof host.setPresentationMode !== "function") {
      setPresentation(presentation);
      return;
    }
    try {
      const result = await host.setPresentationMode(presentation);
      setPresentation(result.mode || presentation);
    } catch (error) {
      setNotice(`窗口模式切换失败：${errorMessage(error)}`, "error");
    }
  }

  async function restoreHostPresentation() {
    if (!host || typeof host.getPresentation !== "function") return;
    try {
      const result = await host.getPresentation();
      if (result.mode) setPresentation(result.mode);
    } catch (error) {
      setNotice(`窗口状态读取失败：${errorMessage(error)}`, "error");
    }
  }

  function setTheme(theme) {
    const normalized = theme === "mist" ? "mist" : "midnight";
    const light = normalized === "mist";
    root.dataset.theme = normalized;
    elements.themeToggle.setAttribute("aria-pressed", String(light));
    elements.themeToggle.setAttribute("aria-label", light ? "切换为深色主题" : "切换为浅色主题");
  }

  function updateClock() {
    const time = new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
    elements.clock.textContent = time;
    elements.homeClock.textContent = time;
  }

  function showScreen(screenId, moveFocus = true) {
    state.screen = screenId;
    for (const screen of screens) {
      const active = screen.dataset.screen === screenId;
      screen.hidden = !active;
      screen.classList.toggle("is-active", active);
      if (active && moveFocus) screen.querySelector("h2")?.focus({ preventScroll: true });
    }
    for (const trigger of navigation.querySelectorAll("[data-open-screen]")) {
      if (trigger.dataset.openScreen === screenId) {
        trigger.setAttribute("aria-current", "page");
      } else {
        trigger.removeAttribute("aria-current");
      }
    }
  }

  function setChatView(view) {
    state.chatView = view === "conversation" ? "conversation" : "groups";
    root.dataset.chatView = state.chatView;
  }

  function formatMessageTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function groupMemberNames(group) {
    return group.members
      .filter((member) => member.kind === "character")
      .map((member) => member.displayName);
  }

  function renderHomeBoundary() {
    elements.homeBoundary.replaceChildren();
    elements.homeBoundary.append(makeElement("span", "", state.ready ? "✓" : "i"));
    const copy = makeElement("p");
    const strong = makeElement(
      "strong",
      "",
      state.ready ? "角色数据已隔离" : "尚未连接",
    );
    const detail = state.ready
      ? ` 当前角色：${state.characterContext?.activeCharacter?.name || "未命名角色"}。群聊由 Host 受管模型生成。`
      : ` ${state.notice}`;
    copy.append(strong, document.createTextNode(detail));
    elements.homeBoundary.append(copy);
  }

  function renderGroups() {
    elements.groupList.replaceChildren();
    for (const group of state.groups) {
      const item = makeElement("li", "group-list-item");
      const button = makeElement("button", "", "");
      button.type = "button";
      button.dataset.groupId = group.groupId;
      if (group.groupId === state.activeGroupId) button.setAttribute("aria-current", "true");

      const avatar = makeElement("span", "group-avatar", group.title.trim().charAt(0) || "聊");
      const copy = makeElement("span", "group-copy");
      const top = makeElement("span", "group-title-row");
      top.append(
        makeElement("strong", "", group.title),
        makeElement("time", "", formatMessageTime(group.lastMessage?.createdAt || group.updatedAt)),
      );
      const preview = group.lastMessage
        ? `${group.lastMessage.speakerName}：${group.lastMessage.content}`
        : `${groupMemberNames(group).join("、") || "角色成员"} · 暂无消息`;
      copy.append(top, makeElement("small", "", preview));
      button.append(avatar, copy);
      item.append(button);
      elements.groupList.append(item);
    }

    elements.groupCount.textContent = state.ready
      ? `${state.groups.length} 个群聊 · ${state.characterContext?.activeCharacter?.name || "当前角色"}`
      : "正在载入群聊…";
    elements.groupEmpty.hidden = !state.ready || state.groups.length > 0;
    elements.groupList.hidden = state.groups.length === 0;
  }

  function renderMessages() {
    elements.messageList.replaceChildren();
    for (const message of state.messages) {
      const outgoing = message.source === "user";
      const item = makeElement(
        "li",
        `message ${outgoing ? "outgoing" : "incoming"}${message.type === "error" ? " error" : ""}`,
      );
      const meta = makeElement("div", "message-meta");
      meta.append(
        makeElement("span", "", outgoing ? "你" : message.speakerName),
        makeElement("time", "", formatMessageTime(message.createdAt)),
      );
      item.append(meta, makeElement("p", "", message.content));
      if (outgoing) item.append(makeElement("small", "", "✓✓"));
      elements.messageList.append(item);
    }
    elements.messageEmpty.hidden = !state.ready || !state.activeGroupId || state.messages.length > 0;
    elements.messageList.hidden = state.messages.length === 0;
    requestAnimationFrame(() => {
      elements.messageList.lastElementChild?.scrollIntoView({ block: "end" });
    });
  }

  function renderConversation() {
    const group = activeGroup();
    elements.chatTitle.textContent = group?.title || "选择一个群聊";
    const names = group ? groupMemberNames(group) : [];
    elements.chatMembers.lastChild.textContent = group
      ? `${names.length} 位角色 · ${names.join("、") || "无可用角色"}`
      : "等待群聊";
    const hasGroup = Boolean(group);
    elements.editGroup.disabled = !state.ready || state.busy || !hasGroup;
    elements.clearMessages.disabled = !state.ready || state.busy || !hasGroup || state.messages.length === 0;
    elements.messageInput.disabled = !state.ready || state.busy || !hasGroup;
    elements.continueChat.disabled = !state.ready || state.busy || !hasGroup;
    elements.sendMessage.disabled = !state.ready || state.busy || !hasGroup || !elements.messageInput.value.trim();
    elements.stopGeneration.hidden = !state.busy;
    elements.sendMessage.hidden = state.busy;
    renderMessages();
  }

  function renderGeneration() {
    if (state.busy) {
      elements.generationState.hidden = false;
      elements.generationLabel.textContent = state.cancelRequested ? "正在停止生成…" : "角色正在回复…";
      elements.retryGeneration.hidden = true;
      return;
    }
    if (state.retry && state.retry.groupId === state.activeGroupId) {
      elements.generationState.hidden = false;
      elements.generationLabel.textContent = "上次生成未完成";
      elements.retryGeneration.hidden = false;
      return;
    }
    elements.generationState.hidden = true;
    elements.retryGeneration.hidden = true;
  }

  function render() {
    const activeName = state.characterContext?.activeCharacter?.name;
    elements.identitySubtitle.textContent = state.ready
      ? `${activeName || "当前角色"} · 口袋群聊`
      : "正在连接当前角色…";
    elements.createGroup.disabled = !state.ready || state.busy;
    elements.createFirstGroup.disabled = !state.ready || state.busy;
    elements.importGroups.disabled = !state.ready || state.busy;
    renderHomeBoundary();
    renderGroups();
    renderConversation();
    renderGeneration();
    renderStatus();
  }

  async function invokeService(method, params = {}) {
    if (!host || typeof host.invoke !== "function") {
      const error = new Error("Fantareal Host service bridge 不可用");
      error.code = "host_bridge_unavailable";
      throw error;
    }
    return host.invoke(method, params);
  }

  async function loadMessages(groupId = state.activeGroupId) {
    if (!groupId || !state.context) {
      state.messages = [];
      state.retry = null;
      return;
    }
    const result = await invokeService("mobile.messages.list", {
      context: state.context,
      groupId,
    });
    if (groupId === state.activeGroupId) {
      state.messages = result.messages || [];
      const lastMessage = state.messages.at(-1);
      state.retry = lastMessage?.type === "error"
        ? { groupId, mode: "continue", content: "" }
        : null;
    }
  }

  async function refreshGroups(preferredGroupId = state.activeGroupId) {
    const result = await invokeService("mobile.groups.list", { context: state.context });
    state.groups = result.groups || [];
    const nextId = state.groups.some((group) => group.groupId === preferredGroupId)
      ? preferredGroupId
      : state.groups[0]?.groupId || null;
    state.activeGroupId = nextId;
    await loadMessages(nextId);
  }

  function normalizedCharacterContext(hostContext, characterContext) {
    const characters = Array.isArray(characterContext?.characters)
      ? characterContext.characters.filter((character) => character?.cardUid)
      : [];
    const activeCardUid = String(characterContext?.activeCardUid || "");
    const activeCharacter = characters.find((character) => character.cardUid === activeCardUid);
    const revision = String(characterContext?.revision || "");
    const sessionId = String(hostContext?.sessionId || "");
    if (!activeCharacter || !revision || !sessionId) {
      const error = new Error("当前没有可供小手机使用的角色，请先在主程序载入角色卡。");
      error.code = "character_context_unavailable";
      throw error;
    }
    return {
      characters,
      activeCharacter,
      context: {
        cardUid: activeCardUid,
        contextRevision: revision,
        sessionId,
      },
    };
  }

  async function syncContext({ quiet = false } = {}) {
    if (state.syncing || state.busy) return;
    if (
      !host
      || typeof host.getContext !== "function"
      || typeof host.getCharacterContext !== "function"
    ) {
      state.ready = false;
      setNotice("无法连接 Fantareal Host；请从主程序的应用入口打开小手机。", "error");
      render();
      return;
    }

    state.syncing = true;
    if (!quiet) setNotice("正在连接当前角色与数据服务…");
    try {
      const [hostContext, rawCharacterContext] = await Promise.all([
        host.getContext(),
        host.getCharacterContext(),
      ]);
      const resolved = normalizedCharacterContext(hostContext, rawCharacterContext);
      const contextChanged = !sameContext(state.context, resolved.context);
      const bound = await invokeService("mobile.context.bind", {
        context: resolved.context,
        characters: resolved.characters,
        activeCharacter: resolved.activeCharacter,
      });
      state.hostContext = hostContext;
      state.characterContext = resolved;
      state.context = bound.context;
      state.groups = bound.groups || [];
      state.ready = true;
      if (contextChanged || !state.groups.some((group) => group.groupId === state.activeGroupId)) {
        state.retry = null;
        state.activeGroupId = state.groups[0]?.groupId || null;
        setChatView(state.activeGroupId && state.presentation === "expanded" ? "conversation" : "groups");
      }
      await loadMessages();
      setNotice(`已连接 ${resolved.activeCharacter.name || "当前角色"} · ${state.groups.length} 个群聊`, "success");
    } catch (error) {
      state.ready = false;
      state.groups = [];
      state.messages = [];
      state.activeGroupId = null;
      setNotice(errorMessage(error), "error");
    } finally {
      state.syncing = false;
      render();
    }
  }

  async function openGroup(groupId, moveFocus = false) {
    if (!state.ready || state.busy) return;
    state.activeGroupId = groupId;
    state.retry = null;
    setChatView("conversation");
    try {
      await loadMessages(groupId);
      setNotice(`${activeGroup()?.title || "群聊"} · ${state.messages.length} 条消息`);
    } catch (error) {
      setNotice(errorMessage(error), "error");
      if (isContextFailure(error)) await syncContext();
    }
    render();
    if (moveFocus) elements.chatTitle.focus({ preventScroll: true });
  }

  function resizeComposer() {
    elements.messageInput.style.height = "auto";
    elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 96)}px`;
    elements.sendMessage.disabled = state.busy || !state.activeGroupId || !elements.messageInput.value.trim();
  }

  function characterOptionsForGroup(group) {
    const byRoleId = new Map(
      (state.characterContext?.characters || []).map((character) => [
        character.cardUid,
        {
          roleId: character.cardUid,
          displayName: character.name || "未命名角色",
          summary: character.description || character.personality || "",
          available: true,
        },
      ]),
    );
    for (const member of group?.members || []) {
      if (member.kind === "character" && !byRoleId.has(member.roleId)) {
        byRoleId.set(member.roleId, { ...member, available: false });
      }
    }
    return Array.from(byRoleId.values());
  }

  function openGroupDialog(groupId = null) {
    const group = state.groups.find((item) => item.groupId === groupId) || null;
    state.editingGroupId = group?.groupId || null;
    elements.groupDialogTitle.textContent = group ? "编辑群聊" : "新建群聊";
    elements.groupTitleInput.value = group?.title || "";
    elements.groupDescriptionInput.value = group?.description || "";
    elements.replyCountInput.value = String(group?.replyCount || 2);
    elements.roleReplyInput.checked = group?.allowRoleToRoleReply ?? true;
    elements.deleteGroup.hidden = !group;
    elements.groupFormError.hidden = true;
    elements.memberOptions.replaceChildren();

    const selected = new Set(
      (group?.members || [])
        .filter((member) => member.kind === "character")
        .map((member) => member.roleId),
    );
    for (const [index, character] of characterOptionsForGroup(group).entries()) {
      const label = makeElement("label", `member-option${character.available ? "" : " unavailable"}`);
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = character.roleId;
      input.dataset.characterId = character.roleId;
      input.checked = group ? selected.has(character.roleId) : index === 0;
      if (!character.available) input.disabled = true;
      const avatar = makeElement("span", "member-avatar", character.displayName.charAt(0) || "角");
      const copy = makeElement("span");
      copy.append(
        makeElement("strong", "", character.displayName),
        makeElement("small", "", character.available
          ? character.summary || "当前 Host 角色"
          : "当前 Host 不再提供；保存时保留"),
      );
      label.append(input, avatar, copy);
      elements.memberOptions.append(label);
    }
    elements.groupDialog.showModal();
    elements.groupTitleInput.focus();
  }

  function selectedGroupMembers() {
    const options = characterOptionsForGroup(activeGroup());
    const byIdMap = new Map(options.map((item) => [item.roleId, item]));
    const selected = Array.from(
      elements.memberOptions.querySelectorAll("input[data-character-id]:checked"),
    ).map((input) => byIdMap.get(input.value)).filter(Boolean);
    return [
      { roleId: "user", displayName: "我", kind: "user", summary: "" },
      ...selected.map((character) => ({
        roleId: character.roleId,
        displayName: character.displayName,
        kind: "character",
        summary: character.summary || "",
      })),
    ];
  }

  async function saveGroup(event) {
    event.preventDefault();
    elements.groupFormError.hidden = true;
    const title = elements.groupTitleInput.value.trim();
    const members = selectedGroupMembers();
    if (!title) {
      elements.groupFormError.textContent = "请填写群聊名称。";
      elements.groupFormError.hidden = false;
      return;
    }
    if (!members.some((member) => member.kind === "character")) {
      elements.groupFormError.textContent = "至少选择一名角色成员。";
      elements.groupFormError.hidden = false;
      return;
    }

    const group = {
      title,
      description: elements.groupDescriptionInput.value.trim(),
      members,
      replyCount: Number(elements.replyCountInput.value),
      allowRoleToRoleReply: elements.roleReplyInput.checked,
    };
    const method = state.editingGroupId ? "mobile.groups.update" : "mobile.groups.create";
    const params = { context: state.context, group };
    if (state.editingGroupId) params.groupId = state.editingGroupId;

    try {
      const result = await invokeService(method, params);
      elements.groupDialog.close();
      await refreshGroups(result.group.groupId);
      state.activeGroupId = result.group.groupId;
      setChatView("conversation");
      setNotice(state.editingGroupId ? "群聊资料已保存" : "群聊已创建", "success");
      render();
    } catch (error) {
      elements.groupFormError.textContent = errorMessage(error);
      elements.groupFormError.hidden = false;
      if (isContextFailure(error)) {
        elements.groupDialog.close();
        await syncContext();
      }
    }
  }

  function askForConfirmation(title, message, actionLabel) {
    elements.confirmTitle.textContent = title;
    elements.confirmMessage.textContent = message;
    byId("confirm-accept").textContent = actionLabel;
    elements.confirmDialog.returnValue = "cancel";
    elements.confirmDialog.showModal();
    return new Promise((resolve) => {
      elements.confirmDialog.addEventListener(
        "close",
        () => resolve(elements.confirmDialog.returnValue === "confirm"),
        { once: true },
      );
    });
  }

  async function deleteCurrentGroup() {
    const group = state.groups.find((item) => item.groupId === state.editingGroupId);
    if (!group) return;
    const confirmed = await askForConfirmation(
      "删除这个群聊？",
      `“${group.title}”及其全部消息会从当前角色的数据中删除，无法撤销。`,
      "删除群聊",
    );
    if (!confirmed) return;
    try {
      await invokeService("mobile.groups.delete", {
        context: state.context,
        groupId: group.groupId,
      });
      elements.groupDialog.close();
      await refreshGroups();
      setChatView("groups");
      setNotice("群聊已删除", "success");
      render();
    } catch (error) {
      setNotice(errorMessage(error), "error");
      if (isContextFailure(error)) await syncContext();
    }
  }

  async function clearCurrentMessages() {
    const group = activeGroup();
    if (!group || state.messages.length === 0) return;
    const confirmed = await askForConfirmation(
      "清空群聊消息？",
      `“${group.title}”的群聊资料和成员会保留，但全部消息会被删除。`,
      "清空消息",
    );
    if (!confirmed) return;
    try {
      await invokeService("mobile.messages.clear", {
        context: state.context,
        groupId: group.groupId,
      });
      state.messages = [];
      state.retry = null;
      await refreshGroups(group.groupId);
      setNotice("群聊消息已清空", "success");
      render();
    } catch (error) {
      setNotice(errorMessage(error), "error");
      if (isContextFailure(error)) await syncContext();
    }
  }

  async function chooseImportDirectory() {
    if (!host || typeof host.pickDirectory !== "function") {
      setNotice("当前 Host 不支持目录选择。", "error");
      return;
    }
    try {
      setNotice("请选择旧版小手机数据目录…");
      const picked = await host.pickDirectory();
      const directoryToken = String(picked?.directoryToken || "");
      if (!directoryToken) throw new Error("Host 未返回有效目录授权");
      const preview = await invokeService("mobile.import.preview", {
        context: state.context,
        directoryToken,
      });
      state.importPreview = { ...preview, directoryToken };
      elements.importSummary.replaceChildren(
        makeElement("strong", "", `发现 ${preview.groupCount} 个群聊、${preview.messageCount} 条消息`),
        makeElement(
          "p",
          "",
          (preview.groups || []).slice(0, 5).map((group) => `${group.title}（${group.messageCount}）`).join(" · ")
            || "所选目录没有可显示的群聊摘要。",
        ),
      );
      elements.importFormError.hidden = true;
      elements.importDialog.showModal();
      setNotice("已完成导入预览，请确认导入方式");
    } catch (error) {
      if (["file_selection_cancelled", "directory_selection_cancelled"].includes(errorCode(error))) {
        setNotice("已取消目录选择");
      } else {
        setNotice(`无法预览旧数据：${errorMessage(error)}`, "error");
      }
      if (isContextFailure(error)) await syncContext();
    }
  }

  async function applyImport(event) {
    event.preventDefault();
    if (!state.importPreview) return;
    const mode = new FormData(elements.importForm).get("importMode") || "merge";
    elements.importFormError.hidden = true;
    try {
      const result = await invokeService("mobile.import.apply", {
        context: state.context,
        directoryToken: state.importPreview.directoryToken,
        mode,
      });
      elements.importDialog.close();
      state.importPreview = null;
      await refreshGroups();
      setChatView("groups");
      setNotice(`已导入 ${result.groupCount} 个群聊、${result.messageCount} 条消息`, "success");
      render();
    } catch (error) {
      elements.importFormError.textContent = errorMessage(error);
      elements.importFormError.hidden = false;
      if (isContextFailure(error)) {
        elements.importDialog.close();
        await syncContext();
      }
    }
  }

  async function runGeneration(mode, content = "") {
    const group = activeGroup();
    if (!state.ready || state.busy || !group || !state.context) return;
    if (mode === "user_message" && !content.trim()) return;

    const operation = {
      groupId: group.groupId,
      mode,
      content: content.trim(),
      context: { ...state.context },
    };
    state.busy = true;
    state.cancelRequested = false;
    state.retry = null;
    render();

    let operationId = null;
    let resyncAfter = false;
    try {
      const prepared = await invokeService("mobile.chat.prepare", {
        context: operation.context,
        groupId: operation.groupId,
        mode: operation.mode,
        content: operation.content,
      });
      operationId = prepared.operationId;
      if (sameContext(state.context, operation.context) && state.activeGroupId === operation.groupId) {
        state.messages = [...state.messages, ...(prepared.optimisticMessages || [])];
        renderMessages();
      }

      const generated = await host.generate(prepared.request);
      await invokeService("mobile.chat.commit", {
        context: operation.context,
        operationId,
        content: generated.content,
      });
      if (sameContext(state.context, operation.context)) {
        await refreshGroups(operation.groupId);
        setNotice("角色回复已保存", "success");
      }
    } catch (error) {
      const reason = state.cancelRequested || errorCode(error) === "llm_cancelled"
        ? "cancelled"
        : errorCode(error) === "llm_timeout"
          ? "timeout"
          : "error";
      if (operationId) {
        try {
          await invokeService("mobile.chat.abort", {
            context: operation.context,
            operationId,
            reason,
            message: errorMessage(error),
          });
        } catch (abortError) {
          if (!isContextFailure(abortError)) {
            setNotice(`生成失败，且无法保存失败状态：${errorMessage(abortError)}`, "error");
          }
        }
      }
      if (sameContext(state.context, operation.context)) {
        await refreshGroups(operation.groupId).catch(() => {});
        state.retry = { groupId: operation.groupId, mode: "continue", content: "" };
        setNotice(errorMessage(error), reason === "cancelled" ? "neutral" : "error");
      }
      resyncAfter = isContextFailure(error);
    } finally {
      state.busy = false;
      state.cancelRequested = false;
      render();
      if (resyncAfter) await syncContext();
    }
  }

  async function stopGeneration() {
    if (!state.busy || state.cancelRequested) return;
    state.cancelRequested = true;
    renderGeneration();
    try {
      await host.cancelGenerate();
    } catch (error) {
      state.cancelRequested = false;
      setNotice(`停止生成失败：${errorMessage(error)}`, "error");
      renderGeneration();
    }
  }

  for (const trigger of document.querySelectorAll("[data-open-screen]")) {
    trigger.addEventListener("click", () => showScreen(trigger.dataset.openScreen));
  }
  for (const trigger of document.querySelectorAll("[data-close-dialog]")) {
    trigger.addEventListener("click", () => byId(trigger.dataset.closeDialog)?.close());
  }

  elements.presentationToggle.addEventListener("click", () => {
    void requestPresentation(state.presentation === "compact" ? "expanded" : "compact");
  });
  elements.themeToggle.addEventListener("click", () => {
    setTheme(root.dataset.theme === "mist" ? "midnight" : "mist");
  });
  byId("close-extension").addEventListener("click", async () => {
    if (state.busy && typeof host?.cancelGenerate === "function") {
      await host.cancelGenerate().catch(() => {});
    }
    if (host && typeof host.close === "function") {
      setNotice("正在关闭 Extension session…");
      await host.close();
    } else {
      setNotice("浏览器预览模式：请直接关闭窗口");
    }
  });

  elements.groupList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-group-id]");
    if (button) void openGroup(button.dataset.groupId, event.detail === 0);
  });
  byId("back-to-groups").addEventListener("click", () => setChatView("groups"));
  elements.createGroup.addEventListener("click", () => openGroupDialog());
  elements.createFirstGroup.addEventListener("click", () => openGroupDialog());
  elements.editGroup.addEventListener("click", () => openGroupDialog(state.activeGroupId));
  elements.groupForm.addEventListener("submit", (event) => void saveGroup(event));
  elements.deleteGroup.addEventListener("click", () => void deleteCurrentGroup());
  elements.clearMessages.addEventListener("click", () => void clearCurrentMessages());
  elements.importGroups.addEventListener("click", () => void chooseImportDirectory());
  elements.importForm.addEventListener("submit", (event) => void applyImport(event));

  elements.messageInput.addEventListener("input", resizeComposer);
  elements.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      elements.composerForm.requestSubmit();
    }
  });
  elements.composerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const content = elements.messageInput.value.trim();
    if (!content) return;
    elements.messageInput.value = "";
    resizeComposer();
    void runGeneration("user_message", content);
  });
  elements.continueChat.addEventListener("click", () => void runGeneration("continue"));
  elements.stopGeneration.addEventListener("click", () => void stopGeneration());
  elements.retryGeneration.addEventListener("click", () => {
    if (state.retry) void runGeneration(state.retry.mode, state.retry.content);
  });

  window.addEventListener("focus", () => {
    if (!state.busy) void syncContext({ quiet: true });
  });

  updateClock();
  window.setInterval(updateClock, 30_000);
  showScreen(state.screen, false);
  setPresentation(state.presentation);
  setTheme(root.dataset.theme);
  render();
  void restoreHostPresentation();
  void syncContext();
})();
