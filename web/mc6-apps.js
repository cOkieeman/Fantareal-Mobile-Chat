(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function createController(dependencies) {
    const {
      invokeService,
      setNotice,
      errorMessage,
      isContextFailure,
      syncContext,
      confirmAction,
      generation,
    } = dependencies;
    const nodes = {
      phoneCount: byId("phone-count"),
      phoneContact: byId("phone-contact-input"),
      phoneHistory: byId("phone-session-list"),
      phoneHistoryEmpty: byId("phone-history-empty"),
      phoneName: byId("phone-active-name"),
      phoneState: byId("phone-active-state"),
      phoneLines: byId("phone-lines"),
      phoneLinesEmpty: byId("phone-lines-empty"),
      phoneForm: byId("phone-form"),
      phoneInput: byId("phone-line-input"),
      phoneSend: byId("send-phone-line"),
      phoneStop: byId("stop-phone-generation"),
      phoneHangup: byId("hangup-phone"),
      phoneDelete: byId("delete-phone"),
      liveCount: byId("live-count"),
      liveStart: byId("start-live"),
      liveStop: byId("stop-live-generation"),
      liveEmpty: byId("live-empty"),
      liveCurrent: byId("live-current"),
      liveBadge: byId("live-badge"),
      liveTitle: byId("live-current-title"),
      liveMeta: byId("live-current-meta"),
      liveContinue: byId("continue-live"),
      liveLike: byId("like-live"),
      liveEnd: byId("end-live"),
      liveDelete: byId("delete-live"),
      liveSegments: byId("live-segments"),
      liveMessages: byId("live-messages"),
      liveMessageForm: byId("live-message-form"),
      liveMessageInput: byId("live-message-input"),
      liveHistory: byId("live-history"),
      assistantCount: byId("assistant-count"),
      assistantList: byId("assistant-list"),
      assistantEmpty: byId("assistant-empty"),
      assistantCreate: byId("create-assistant-draft"),
      assistantCreateFirst: byId("create-first-assistant-draft"),
      assistantStop: byId("stop-assistant-generation"),
      assistantDialog: byId("assistant-dialog"),
      assistantForm: byId("assistant-form"),
      assistantDialogTitle: byId("assistant-dialog-title"),
      assistantGenerateFields: byId("assistant-generate-fields"),
      assistantEditFields: byId("assistant-edit-fields"),
      assistantMode: byId("assistant-mode-input"),
      assistantSource: byId("assistant-source-input"),
      assistantNotes: byId("assistant-notes-input"),
      assistantName: byId("assistant-name-input"),
      assistantSummary: byId("assistant-summary-input"),
      assistantPersonality: byId("assistant-personality-input"),
      assistantScenario: byId("assistant-scenario-input"),
      assistantChatStyle: byId("assistant-chat-style-input"),
      assistantTags: byId("assistant-tags-input"),
      assistantError: byId("assistant-form-error"),
      assistantSubmit: byId("assistant-submit"),
      workbenchForm: byId("workbench-form"),
      workbenchScope: byId("workbench-scope-input"),
      workbenchEnabled: byId("workbench-enabled-input"),
      workbenchInstruction: byId("workbench-instruction-input"),
      workbenchInput: byId("workbench-test-input"),
      workbenchReset: byId("reset-workbench"),
      workbenchPreviewButton: byId("preview-workbench"),
      workbenchTest: byId("test-workbench"),
      workbenchStop: byId("stop-workbench-generation"),
      workbenchPreview: byId("workbench-preview"),
      workbenchDiagnostics: byId("workbench-diagnostics"),
    };
    const state = {
      context: null,
      activeCharacter: null,
      characters: [],
      loading: new Set(),
      phoneSessions: [],
      activePhoneId: null,
      liveStreams: [],
      activeLiveId: null,
      drafts: [],
      editingDraftId: null,
      profiles: [],
      diagnostics: [],
    };
    const generated = window.MobileChatGeneratedApp.createRunner({
      ...dependencies,
      getContext: () => state.context,
      canStart: () => state.loading.size === 0,
      onCommitted: async () => {},
      successMessage: () => "生成完成",
      focusAfterCommit: () => {},
    });

    function activePhone() {
      return state.phoneSessions.find(
        (session) => session.sessionId === state.activePhoneId,
      ) || null;
    }

    function activeLive() {
      return state.liveStreams.find(
        (stream) => stream.streamId === state.activeLiveId,
      ) || null;
    }

    function activeDraft() {
      return state.drafts.find(
        (draft) => draft.draftId === state.editingDraftId,
      ) || null;
    }

    function selectedProfile() {
      return state.profiles.find(
        (profile) => profile.scope === nodes.workbenchScope.value,
      ) || null;
    }

    async function invoke(method, params, successMessage = "") {
      try {
        const result = await invokeService(method, {
          context: state.context,
          ...params,
        });
        if (successMessage) setNotice(successMessage, "success");
        return result;
      } catch (error) {
        setNotice(errorMessage(error), "error");
        if (isContextFailure(error)) await syncContext();
        return null;
      }
    }

    function setLoading(key, loading) {
      if (loading) state.loading.add(key);
      else state.loading.delete(key);
      renderGeneration();
    }

    async function loadPhone() {
      if (!state.context) return;
      const bound = { ...state.context };
      setLoading("phone", true);
      try {
        const result = await invokeService("mobile.phone.list", { context: bound });
        if (window.MobileChatGeneratedApp.sameContext(state.context, bound)) {
          state.phoneSessions = result.sessions || [];
          if (!state.phoneSessions.some(
            (session) => session.sessionId === state.activePhoneId,
          )) {
            state.activePhoneId = state.phoneSessions[0]?.sessionId || null;
          }
        }
      } catch (error) {
        setNotice(errorMessage(error), "error");
        if (isContextFailure(error)) await syncContext();
      } finally {
        setLoading("phone", false);
        renderPhone();
      }
    }

    function renderPhone() {
      const session = activePhone();
      if (session && state.characters.some(
        (character) => character.cardUid === session.contactId,
      )) {
        nodes.phoneContact.value = session.contactId;
      }
      nodes.phoneHistory.replaceChildren();
      for (const item of state.phoneSessions) {
        const row = element("li", "mc6-history-item");
        const button = element("button");
        button.type = "button";
        button.dataset.phoneSessionId = item.sessionId;
        if (item.sessionId === state.activePhoneId) {
          button.setAttribute("aria-current", "true");
        }
        button.append(
          element("strong", "", item.contactName),
          element(
            "small",
            "",
            `${item.status === "ongoing" ? "通话中" : "已结束"} · ${formatTime(item.updatedAt)}`,
          ),
        );
        row.append(button);
        nodes.phoneHistory.append(row);
      }
      nodes.phoneHistoryEmpty.hidden = state.phoneSessions.length > 0;
      nodes.phoneCount.textContent = `${state.phoneSessions.length} 次通话 · 仅前台文本`;
      nodes.phoneName.textContent = session?.contactName
        || nodes.phoneContact.selectedOptions[0]?.textContent
        || "选择联系人";
      nodes.phoneState.textContent = session
        ? `${session.status === "ongoing" ? "正在通话" : "通话已结束"} · ${session.lines.length} 句`
        : "前台文本模拟，不使用麦克风";
      nodes.phoneLines.replaceChildren();
      for (const line of session?.lines || []) {
        const item = element(
          "li",
          `phone-line ${line.direction === "sent" ? "sent" : "received"}`,
        );
        item.append(
          element("small", "", `${line.direction === "sent" ? "我" : line.authorName} · ${formatTime(line.createdAt)}`),
          element("p", "", line.content),
        );
        nodes.phoneLines.append(item);
      }
      nodes.phoneLinesEmpty.hidden = Boolean(session?.lines.length);
      nodes.phoneLines.hidden = !session?.lines.length;
      const busy = generation.isBusy();
      const ongoing = session?.status === "ongoing";
      nodes.phoneContact.disabled = !state.context || busy;
      nodes.phoneInput.disabled = !state.context || busy || !nodes.phoneContact.value;
      nodes.phoneSend.disabled = nodes.phoneInput.disabled || !nodes.phoneInput.value.trim();
      nodes.phoneHangup.disabled = !ongoing || busy;
      nodes.phoneDelete.disabled = !session || busy;
    }

    function renderPhoneContacts() {
      const selected = nodes.phoneContact.value;
      nodes.phoneContact.replaceChildren();
      for (const character of state.characters) {
        const option = document.createElement("option");
        option.value = character.cardUid;
        option.textContent = character.name || "未命名角色";
        nodes.phoneContact.append(option);
      }
      if (state.characters.some((character) => character.cardUid === selected)) {
        nodes.phoneContact.value = selected;
      }
    }

    async function sendPhoneLine(event) {
      event.preventDefault();
      const content = nodes.phoneInput.value.trim();
      if (!content) return;
      const session = activePhone();
      const matching = session?.status === "ongoing"
        && session.contactId === nodes.phoneContact.value;
      await generated.run("phone", {
        servicePrefix: "mobile.phone.call",
        prepareParams: {
          contactId: nodes.phoneContact.value,
          sessionId: matching ? session.sessionId : "",
          content,
        },
        onCommitted: async (_purpose, result) => {
          state.activePhoneId = result.session.sessionId;
          nodes.phoneInput.value = "";
          await loadPhone();
        },
        successMessage: "电话回复已保存",
        focusAfterCommit: () => nodes.phoneInput.focus({ preventScroll: true }),
      });
    }

    async function hangupPhone() {
      const session = activePhone();
      if (!session) return;
      const result = await invoke(
        "mobile.phone.hangup",
        { sessionId: session.sessionId },
        "通话已挂断",
      );
      if (result) await loadPhone();
    }

    async function deletePhone() {
      const session = activePhone();
      if (!session) return;
      const confirmed = await confirmAction(
        "删除这条通话记录？",
        `与“${session.contactName}”的全部文本台词会被删除。`,
        "删除通话",
      );
      if (!confirmed) return;
      const result = await invoke(
        "mobile.phone.delete",
        { sessionId: session.sessionId },
        "通话记录已删除",
      );
      if (result) {
        state.activePhoneId = null;
        await loadPhone();
      }
    }

    async function loadLive() {
      if (!state.context) return;
      const bound = { ...state.context };
      setLoading("live", true);
      try {
        const result = await invokeService("mobile.live.list", { context: bound });
        if (window.MobileChatGeneratedApp.sameContext(state.context, bound)) {
          state.liveStreams = result.streams || [];
          if (!state.liveStreams.some(
            (stream) => stream.streamId === state.activeLiveId,
          )) {
            state.activeLiveId = state.liveStreams[0]?.streamId || null;
          }
        }
      } catch (error) {
        setNotice(errorMessage(error), "error");
        if (isContextFailure(error)) await syncContext();
      } finally {
        setLoading("live", false);
        renderLive();
      }
    }

    function renderLive() {
      const stream = activeLive();
      nodes.liveCount.textContent = `${state.liveStreams.length} 场直播 · 手动继续片段`;
      nodes.liveEmpty.hidden = Boolean(stream);
      nodes.liveCurrent.hidden = !stream;
      nodes.liveHistory.replaceChildren();
      for (const item of state.liveStreams) {
        const row = element("li", "mc6-history-item");
        const button = element("button");
        button.type = "button";
        button.dataset.liveStreamId = item.streamId;
        if (item.streamId === state.activeLiveId) button.setAttribute("aria-current", "true");
        button.append(
          element("strong", "", item.title),
          element(
            "small",
            "",
            `${item.status === "live" ? "直播中" : "已结束"} · ${formatTime(item.updatedAt)}`,
          ),
        );
        row.append(button);
        nodes.liveHistory.append(row);
      }
      if (stream) {
        nodes.liveBadge.textContent = stream.status === "live" ? "LIVE" : "ENDED";
        nodes.liveBadge.classList.toggle("is-ended", stream.status !== "live");
        nodes.liveTitle.textContent = stream.title;
        nodes.liveMeta.textContent = `${stream.viewerCount} 人观看 · ${stream.likeCount} 赞`;
        nodes.liveLike.textContent = stream.userLiked ? "已赞" : "赞";
        nodes.liveSegments.replaceChildren();
        for (const segment of stream.segments) {
          const item = element("li");
          item.append(
            element("time", "", formatTime(segment.createdAt)),
            element("p", "", segment.content),
          );
          nodes.liveSegments.append(item);
        }
        nodes.liveMessages.replaceChildren();
        for (const message of stream.messages) {
          const item = element(
            "li",
            message.authorType === "user" ? "is-user" : "",
          );
          item.append(
            element("strong", "", message.authorType === "user" ? "我" : message.authorName),
            document.createTextNode(` ${message.content}`),
          );
          nodes.liveMessages.append(item);
        }
      }
      const busy = generation.isBusy();
      const isLive = stream?.status === "live";
      const hasOngoing = state.liveStreams.some((item) => item.status === "live");
      nodes.liveStart.disabled = !state.context || busy || hasOngoing;
      nodes.liveContinue.disabled = !isLive || busy;
      nodes.liveLike.disabled = !stream || busy;
      nodes.liveEnd.disabled = !isLive || busy;
      nodes.liveDelete.disabled = !stream || busy;
      nodes.liveMessageInput.disabled = !isLive || busy;
    }

    async function startLive() {
      await generated.run("live", {
        onCommitted: async (_purpose, result) => {
          state.activeLiveId = result.stream.streamId;
          await loadLive();
        },
        successMessage: "模拟直播已开始",
        focusAfterCommit: () => byId("live-title").focus({ preventScroll: true }),
      });
    }

    async function continueLive() {
      const stream = activeLive();
      if (!stream) return;
      await generated.run("live-tick", {
        servicePrefix: "mobile.live.tick",
        prepareParams: { streamId: stream.streamId },
        onCommitted: async () => loadLive(),
        successMessage: "直播片段已继续",
        focusAfterCommit: () => nodes.liveTitle.focus?.({ preventScroll: true }),
      });
    }

    async function sendLiveMessage(event) {
      event.preventDefault();
      const stream = activeLive();
      const content = nodes.liveMessageInput.value.trim();
      if (!stream || !content) return;
      const result = await invoke("mobile.live.message.create", {
        streamId: stream.streamId,
        content,
      });
      if (result) {
        nodes.liveMessageInput.value = "";
        await loadLive();
      }
    }

    async function toggleLiveLike() {
      const stream = activeLive();
      if (!stream) return;
      if (await invoke("mobile.live.like.toggle", { streamId: stream.streamId })) {
        await loadLive();
      }
    }

    async function endLive() {
      const stream = activeLive();
      if (!stream) return;
      const confirmed = await confirmAction(
        "结束当前模拟直播？",
        "直播会停止继续片段，但历史内容仍会保留。",
        "结束直播",
      );
      if (!confirmed) return;
      if (await invoke("mobile.live.end", { streamId: stream.streamId }, "直播已结束")) {
        await loadLive();
      }
    }

    async function deleteLive() {
      const stream = activeLive();
      if (!stream) return;
      const confirmed = await confirmAction(
        "删除这场直播？",
        `“${stream.title}”的片段和弹幕会被永久删除。`,
        "删除直播",
      );
      if (!confirmed) return;
      if (await invoke("mobile.live.delete", { streamId: stream.streamId }, "直播已删除")) {
        state.activeLiveId = null;
        await loadLive();
      }
    }

    async function loadAssistant() {
      if (!state.context) return;
      const bound = { ...state.context };
      setLoading("assistant", true);
      try {
        const result = await invokeService("mobile.assistant.list", { context: bound });
        if (window.MobileChatGeneratedApp.sameContext(state.context, bound)) {
          state.drafts = result.drafts || [];
        }
      } catch (error) {
        setNotice(errorMessage(error), "error");
        if (isContextFailure(error)) await syncContext();
      } finally {
        setLoading("assistant", false);
        renderAssistant();
      }
    }

    function renderAssistant() {
      nodes.assistantList.replaceChildren();
      for (const draft of state.drafts) {
        const card = element("li", "light-app-card assistant-card");
        const main = element("div", "light-app-card-main");
        const heading = element("div");
        heading.append(
          element("strong", "", draft.name),
          element("time", "", formatTime(draft.updatedAt)),
        );
        const meta = element("div", "light-app-card-meta");
        meta.append(element("span", "", draft.mode === "extract" ? "摘要提取" : "新建草稿"));
        for (const tag of draft.tags.slice(0, 3)) meta.append(element("span", "", tag));
        main.append(heading, element("p", "", draft.summary), meta);
        const actions = element("div", "light-app-card-actions");
        for (const [action, label] of [["edit", "编"], ["delete", "删"]]) {
          const button = element("button", "", label);
          button.type = "button";
          button.dataset.action = action;
          button.dataset.draftId = draft.draftId;
          button.setAttribute("aria-label", `${action === "edit" ? "编辑" : "删除"}${draft.name}`);
          actions.append(button);
        }
        card.append(main, actions);
        nodes.assistantList.append(card);
      }
      nodes.assistantCount.textContent = `${state.drafts.length} 份内部草稿 · 不写回角色卡`;
      nodes.assistantEmpty.hidden = state.drafts.length > 0;
      nodes.assistantList.hidden = state.drafts.length === 0;
      const busy = generation.isBusy();
      nodes.assistantCreate.disabled = !state.context || busy;
      nodes.assistantCreateFirst.disabled = !state.context || busy;
    }

    function updateAssistantMode() {
      const extract = nodes.assistantMode.value === "extract";
      nodes.assistantSource.disabled = !extract;
      nodes.assistantNotes.placeholder = extract
        ? "可选：说明希望从白名单摘要中保留哪些特点。"
        : "描述希望得到的人物草稿；不会读取角色卡正文。";
    }

    function openAssistant(draftId = null) {
      state.editingDraftId = draftId;
      const draft = activeDraft();
      const editing = Boolean(draft);
      nodes.assistantDialogTitle.textContent = editing ? "编辑人物草稿" : "生成人物草稿";
      nodes.assistantGenerateFields.hidden = editing;
      nodes.assistantEditFields.hidden = !editing;
      nodes.assistantSubmit.textContent = editing ? "保存草稿" : "生成草稿";
      nodes.assistantError.hidden = true;
      if (editing) {
        nodes.assistantName.value = draft.name;
        nodes.assistantSummary.value = draft.summary;
        nodes.assistantPersonality.value = draft.personality;
        nodes.assistantScenario.value = draft.scenario;
        nodes.assistantChatStyle.value = draft.chatStyle;
        nodes.assistantTags.value = draft.tags.join("，");
      } else {
        nodes.assistantMode.value = "create";
        nodes.assistantNotes.value = "";
        nodes.assistantSource.replaceChildren();
        for (const character of state.characters) {
          const option = document.createElement("option");
          option.value = character.cardUid;
          option.textContent = character.name || "未命名角色";
          nodes.assistantSource.append(option);
        }
        updateAssistantMode();
      }
      nodes.assistantDialog.showModal();
      (editing ? nodes.assistantName : nodes.assistantNotes).focus();
    }

    async function saveAssistant(event) {
      event.preventDefault();
      nodes.assistantError.hidden = true;
      const draft = activeDraft();
      if (draft) {
        const result = await invoke(
          "mobile.assistant.update",
          {
            draftId: draft.draftId,
            draft: {
              name: nodes.assistantName.value.trim(),
              summary: nodes.assistantSummary.value.trim(),
              personality: nodes.assistantPersonality.value.trim(),
              scenario: nodes.assistantScenario.value.trim(),
              chatStyle: nodes.assistantChatStyle.value.trim(),
              tags: nodes.assistantTags.value
                .split(/[,，]/)
                .map((tag) => tag.trim())
                .filter(Boolean),
            },
          },
          "人物草稿已保存",
        );
        if (result) {
          nodes.assistantDialog.close();
          await loadAssistant();
        }
        return;
      }
      const mode = nodes.assistantMode.value;
      await generated.run("assistant", {
        prepareParams: {
          mode,
          sourceCharacterId: mode === "extract" ? nodes.assistantSource.value : "",
          notes: nodes.assistantNotes.value.trim(),
        },
        onCommitted: async () => {
          nodes.assistantDialog.close();
          await loadAssistant();
        },
        successMessage: "人物草稿已生成",
        focusAfterCommit: () => byId("assistant-title").focus({ preventScroll: true }),
      });
    }

    async function deleteAssistant(draftId) {
      const draft = state.drafts.find((item) => item.draftId === draftId);
      if (!draft) return;
      const confirmed = await confirmAction(
        "删除这份人物草稿？",
        `“${draft.name}”只会从小手机内部草稿中删除。`,
        "删除草稿",
      );
      if (!confirmed) return;
      if (await invoke("mobile.assistant.delete", { draftId }, "人物草稿已删除")) {
        await loadAssistant();
      }
    }

    function initializeWorkbenchScopes() {
      if (nodes.workbenchScope.options.length) return;
      const labels = {
        diary: "日记",
        calendar: "日程",
        feed: "动态",
        forum: "论坛",
        mail: "邮箱",
        phone: "电话",
        live: "直播",
        assistant: "人物辅助",
      };
      for (const [scope, label] of Object.entries(labels)) {
        const option = document.createElement("option");
        option.value = scope;
        option.textContent = label;
        nodes.workbenchScope.append(option);
      }
    }

    async function loadWorkbench() {
      if (!state.context) return;
      const bound = { ...state.context };
      setLoading("workbench", true);
      try {
        const result = await invokeService("mobile.workbench.get", { context: bound });
        if (window.MobileChatGeneratedApp.sameContext(state.context, bound)) {
          state.profiles = result.profiles || [];
          state.diagnostics = result.diagnostics || [];
          initializeWorkbenchScopes();
          syncWorkbenchForm();
        }
      } catch (error) {
        setNotice(errorMessage(error), "error");
        if (isContextFailure(error)) await syncContext();
      } finally {
        setLoading("workbench", false);
        renderWorkbenchDiagnostics();
      }
    }

    function syncWorkbenchForm() {
      const profile = selectedProfile();
      nodes.workbenchEnabled.checked = Boolean(profile?.enabled);
      nodes.workbenchInstruction.value = profile?.instruction || "";
    }

    function renderWorkbenchDiagnostics() {
      nodes.workbenchDiagnostics.replaceChildren();
      for (const diagnostic of state.diagnostics) {
        const item = element("li", `is-${diagnostic.status}`);
        item.append(
          element("strong", "", `${diagnostic.scope} · ${diagnostic.status}`),
          element("time", "", formatTime(diagnostic.createdAt)),
          element("p", "", diagnostic.summary || "没有额外诊断内容"),
        );
        nodes.workbenchDiagnostics.append(item);
      }
      if (!state.diagnostics.length) {
        nodes.workbenchDiagnostics.append(
          element("li", "is-empty", "还没有运行过 JSON 契约测试。"),
        );
      }
    }

    async function saveWorkbench(event) {
      event.preventDefault();
      const result = await invoke(
        "mobile.workbench.update",
        {
          profile: {
            scope: nodes.workbenchScope.value,
            enabled: nodes.workbenchEnabled.checked,
            instruction: nodes.workbenchInstruction.value.trim(),
          },
        },
        "Prompt 追加指令已保存",
      );
      if (result) {
        state.profiles = state.profiles.map((profile) => (
          profile.scope === result.profile.scope ? result.profile : profile
        ));
      }
    }

    async function resetWorkbench() {
      const result = await invoke(
        "mobile.workbench.reset",
        { scope: nodes.workbenchScope.value },
        "当前 scope 已重置",
      );
      if (result) {
        state.profiles = state.profiles.map((profile) => (
          profile.scope === result.profile.scope ? result.profile : profile
        ));
        syncWorkbenchForm();
      }
    }

    async function previewWorkbench() {
      const result = await invoke("mobile.workbench.preview", {
        scope: nodes.workbenchScope.value,
      });
      if (result) {
        nodes.workbenchPreview.textContent = JSON.stringify(result.preview, null, 2);
      }
    }

    async function testWorkbench() {
      await generated.run("workbench", {
        prepareParams: {
          scope: nodes.workbenchScope.value,
          input: nodes.workbenchInput.value.trim(),
        },
        onCommitted: async (_purpose, result) => {
          nodes.workbenchPreview.textContent = JSON.stringify(
            { keys: result.keys, parsed: result.parsed },
            null,
            2,
          );
        },
        successMessage: "JSON 契约测试通过",
        focusAfterCommit: () => nodes.workbenchPreview.focus?.({ preventScroll: true }),
      });
      await loadWorkbench();
    }

    function renderGeneration() {
      const busy = generation.isBusy();
      const phoneOwner = generation.isOwner("light:phone");
      const liveOwner = ["live", "live-tick"].find(
        (purpose) => generation.isOwner(`light:${purpose}`),
      );
      const assistantOwner = generation.isOwner("light:assistant");
      const workbenchOwner = generation.isOwner("light:workbench");
      nodes.phoneStop.hidden = !phoneOwner;
      nodes.liveStop.hidden = !liveOwner;
      nodes.liveStop.dataset.owner = liveOwner || "";
      nodes.assistantStop.hidden = !assistantOwner;
      nodes.workbenchStop.hidden = !workbenchOwner;
      nodes.phoneSend.hidden = phoneOwner;
      nodes.liveStart.hidden = Boolean(liveOwner);
      nodes.assistantCreate.hidden = assistantOwner;
      nodes.assistantForm.querySelectorAll("input, textarea, select, button").forEach((node) => {
        if (node !== nodes.assistantStop) node.disabled = assistantOwner;
      });
      nodes.workbenchTest.disabled = !state.context || busy;
      nodes.workbenchForm.querySelectorAll("input, textarea, select, button").forEach((node) => {
        if (node !== nodes.workbenchStop) node.disabled = !state.context || busy;
      });
      renderPhone();
      renderLive();
      renderAssistant();
    }

    async function bindContext(context, activeCharacter, characters) {
      const changed = !window.MobileChatGeneratedApp.sameContext(state.context, context);
      state.context = context ? { ...context } : null;
      state.activeCharacter = activeCharacter || null;
      state.characters = Array.isArray(characters) ? characters : [];
      if (changed) {
        state.phoneSessions = [];
        state.activePhoneId = null;
        state.liveStreams = [];
        state.activeLiveId = null;
        state.drafts = [];
        state.profiles = [];
        state.diagnostics = [];
      }
      renderPhoneContacts();
      renderPhone();
      renderLive();
      renderAssistant();
      renderWorkbenchDiagnostics();
      if (state.context) {
        await Promise.all([
          loadPhone(),
          loadLive(),
          loadAssistant(),
          loadWorkbench(),
        ]);
      }
    }

    nodes.phoneInput.addEventListener("input", renderPhone);
    nodes.phoneContact.addEventListener("change", () => {
      const session = activePhone();
      if (session?.contactId !== nodes.phoneContact.value) state.activePhoneId = null;
      renderPhone();
    });
    nodes.phoneForm.addEventListener("submit", (event) => void sendPhoneLine(event));
    nodes.phoneStop.addEventListener("click", () => void generated.stop("phone"));
    nodes.phoneHangup.addEventListener("click", () => void hangupPhone());
    nodes.phoneDelete.addEventListener("click", () => void deletePhone());
    nodes.phoneHistory.addEventListener("click", (event) => {
      const button = event.target.closest("[data-phone-session-id]");
      if (!button) return;
      state.activePhoneId = button.dataset.phoneSessionId;
      renderPhone();
    });

    nodes.liveStart.addEventListener("click", () => void startLive());
    nodes.liveContinue.addEventListener("click", () => void continueLive());
    nodes.liveStop.addEventListener("click", () => {
      const owner = nodes.liveStop.dataset.owner;
      if (owner) void generated.stop(owner);
    });
    nodes.liveMessageForm.addEventListener("submit", (event) => void sendLiveMessage(event));
    nodes.liveLike.addEventListener("click", () => void toggleLiveLike());
    nodes.liveEnd.addEventListener("click", () => void endLive());
    nodes.liveDelete.addEventListener("click", () => void deleteLive());
    nodes.liveHistory.addEventListener("click", (event) => {
      const button = event.target.closest("[data-live-stream-id]");
      if (!button) return;
      state.activeLiveId = button.dataset.liveStreamId;
      renderLive();
    });

    nodes.assistantCreate.addEventListener("click", () => openAssistant());
    nodes.assistantCreateFirst.addEventListener("click", () => openAssistant());
    nodes.assistantStop.addEventListener("click", () => void generated.stop("assistant"));
    nodes.assistantMode.addEventListener("change", updateAssistantMode);
    nodes.assistantForm.addEventListener("submit", (event) => void saveAssistant(event));
    nodes.assistantList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-draft-id]");
      if (!button) return;
      if (button.dataset.action === "edit") openAssistant(button.dataset.draftId);
      if (button.dataset.action === "delete") void deleteAssistant(button.dataset.draftId);
    });

    nodes.workbenchScope.addEventListener("change", syncWorkbenchForm);
    nodes.workbenchForm.addEventListener("submit", (event) => void saveWorkbench(event));
    nodes.workbenchReset.addEventListener("click", () => void resetWorkbench());
    nodes.workbenchPreviewButton.addEventListener("click", () => void previewWorkbench());
    nodes.workbenchTest.addEventListener("click", () => void testWorkbench());
    nodes.workbenchStop.addEventListener("click", () => void generated.stop("workbench"));

    renderGeneration();
    return {
      bindContext,
      renderGeneration,
      open(screenId) {
        const loaders = {
          phone: loadPhone,
          live: loadLive,
          assistant: loadAssistant,
          workbench: loadWorkbench,
        };
        if (loaders[screenId]) void loaders[screenId]();
      },
    };
  }

  window.MobileChatMc6Apps = Object.freeze({ createController });
})();
