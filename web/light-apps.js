(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function today() {
    const date = new Date();
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  function createController(dependencies) {
    const {
      invokeService,
      setNotice,
      errorMessage,
      errorCode,
      isContextFailure,
      syncContext,
      confirmAction,
      generation,
    } = dependencies;
    const nodes = {
      diaryCount: byId("diary-count"),
      diaryList: byId("diary-list"),
      diaryEmpty: byId("diary-empty"),
      diaryDialog: byId("diary-dialog"),
      diaryForm: byId("diary-form"),
      diaryDialogTitle: byId("diary-dialog-title"),
      diaryDate: byId("diary-date-input"),
      diaryMood: byId("diary-mood-input"),
      diaryTitle: byId("diary-title-input"),
      diaryContent: byId("diary-content-input"),
      diaryError: byId("diary-form-error"),
      deleteDiary: byId("delete-diary"),
      generateDiary: byId("generate-diary"),
      stopDiaryGeneration: byId("stop-diary-generation"),
      calendarCount: byId("calendar-count"),
      calendarList: byId("calendar-list"),
      calendarEmpty: byId("calendar-empty"),
      calendarDialog: byId("calendar-dialog"),
      calendarForm: byId("calendar-form"),
      calendarDialogTitle: byId("calendar-dialog-title"),
      calendarTitle: byId("calendar-title-input"),
      calendarStart: byId("calendar-start-input"),
      calendarEnd: byId("calendar-end-input"),
      calendarLocation: byId("calendar-location-input"),
      calendarStatus: byId("calendar-status-input"),
      calendarDescription: byId("calendar-description-input"),
      calendarError: byId("calendar-form-error"),
      deleteCalendar: byId("delete-calendar"),
      generateCalendar: byId("generate-calendar"),
      stopCalendarGeneration: byId("stop-calendar-generation"),
      notificationsCount: byId("notifications-count"),
      notificationsList: byId("notifications-list"),
      notificationsEmpty: byId("notifications-empty"),
      readAllNotifications: byId("read-all-notifications"),
      clearNotifications: byId("clear-notifications"),
    };
    const state = {
      context: null,
      activeCharacter: null,
      characters: [],
      diary: [],
      calendar: [],
      notifications: [],
      editingDiaryId: null,
      editingCalendarId: null,
      loading: false,
    };
    const generated = window.MobileChatGeneratedApp.createRunner({
      ...dependencies,
      getContext: () => state.context,
      canStart: () => !state.loading,
      onCommitted: async (purpose) => {
        await Promise.all([load(purpose), load("notifications")]);
      },
      successMessage: (purpose) => (
        purpose === "diary" ? "角色日记已生成" : "角色日程已生成"
      ),
      focusAfterCommit: (purpose) => {
        byId(`${purpose}-title`).focus({ preventScroll: true });
      },
    });

    function actionButton(action, id, label, glyph) {
      const button = element("button", "", glyph);
      button.type = "button";
      button.dataset.action = action;
      button.dataset.id = id;
      button.setAttribute("aria-label", label);
      button.title = label;
      return button;
    }

    function renderDiary() {
      nodes.diaryList.replaceChildren();
      for (const entry of state.diary) {
        const card = element("li", "light-app-card");
        const main = element("article", "light-app-card-main");
        const heading = element("div");
        heading.append(
          element("strong", "", entry.title),
          element("time", "", entry.entryDate),
        );
        const meta = element("div", "light-app-card-meta");
        if (entry.mood) meta.append(element("span", "", entry.mood));
        meta.append(element("span", "", entry.authorName));
        for (const tag of entry.tags || []) meta.append(element("span", "", `#${tag}`));
        main.append(heading, element("p", "", entry.content), meta);
        const actions = element("div", "light-app-card-actions");
        actions.append(
          actionButton("edit", entry.entryId, `编辑日记：${entry.title}`, "✎"),
          actionButton("delete", entry.entryId, `删除日记：${entry.title}`, "⌫"),
        );
        card.append(main, actions);
        nodes.diaryList.append(card);
      }
      nodes.diaryEmpty.hidden = state.diary.length > 0;
      nodes.diaryList.hidden = state.diary.length === 0;
    }

    function statusLabel(status) {
      return {
        planned: "计划中",
        completed: "已完成",
        cancelled: "已取消",
      }[status] || status;
    }

    function renderCalendar() {
      nodes.calendarList.replaceChildren();
      for (const event of state.calendar) {
        const card = element("li", "light-app-card");
        const main = element("article", "light-app-card-main");
        const heading = element("div");
        heading.append(
          element("strong", "", event.title),
          element("time", "", event.endsOn
            ? `${event.startsOn} → ${event.endsOn}`
            : event.startsOn),
        );
        const meta = element("div", "light-app-card-meta");
        meta.append(element("span", "", statusLabel(event.status)));
        if (event.location) meta.append(element("span", "", event.location));
        for (const tag of event.tags || []) meta.append(element("span", "", `#${tag}`));
        main.append(heading, element("p", "", event.description || "没有补充说明。"), meta);
        const actions = element("div", "light-app-card-actions");
        actions.append(
          actionButton("edit", event.eventId, `编辑日程：${event.title}`, "✎"),
          actionButton("delete", event.eventId, `删除日程：${event.title}`, "⌫"),
        );
        card.append(main, actions);
        nodes.calendarList.append(card);
      }
      nodes.calendarEmpty.hidden = state.calendar.length > 0;
      nodes.calendarList.hidden = state.calendar.length === 0;
    }

    function renderGeneration() {
      const diaryOwner = "light:diary";
      const calendarOwner = "light:calendar";
      const busy = generation.isBusy();
      const diaryGenerating = generation.isOwner(diaryOwner);
      const calendarGenerating = generation.isOwner(calendarOwner);
      const planned = state.calendar.filter((event) => event.status === "planned").length;
      nodes.diaryCount.textContent = diaryGenerating
        ? (generation.isCancelled(diaryOwner) ? "正在停止生成…" : "正在生成日记…")
        : `${state.diary.length} 篇 · ${state.activeCharacter?.name || "当前角色"}`;
      nodes.calendarCount.textContent = calendarGenerating
        ? (generation.isCancelled(calendarOwner) ? "正在停止生成…" : "正在生成日程…")
        : `${planned} 项待进行 · 共 ${state.calendar.length} 项`;
      nodes.generateDiary.hidden = diaryGenerating;
      nodes.stopDiaryGeneration.hidden = !diaryGenerating;
      nodes.generateCalendar.hidden = calendarGenerating;
      nodes.stopCalendarGeneration.hidden = !calendarGenerating;
      nodes.generateDiary.disabled = !state.context || state.loading || busy;
      nodes.generateCalendar.disabled = !state.context || state.loading || busy;
    }

    function sourceLabel(source) {
      return {
        diary: "日记",
        calendar: "日程",
        system: "系统",
        import: "导入",
      }[source] || source;
    }

    function renderNotifications() {
      nodes.notificationsList.replaceChildren();
      for (const notification of state.notifications) {
        const card = element(
          "li",
          `light-app-card${notification.isRead ? "" : " unread"}`,
        );
        const main = element("article", "light-app-card-main");
        const heading = element("div");
        heading.append(
          element("strong", "", notification.title),
          element("time", "", new Date(notification.createdAt).toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })),
        );
        const meta = element("div", "light-app-card-meta");
        meta.append(element("span", "", sourceLabel(notification.source)));
        if (!notification.isRead) meta.append(element("span", "", "未读"));
        main.append(heading, element("p", "", notification.content || "没有附加内容。"), meta);
        const actions = element("div", "light-app-card-actions");
        actions.append(
          actionButton(
            "mark",
            notification.notificationId,
            notification.isRead ? "标记为未读" : "标记为已读",
            notification.isRead ? "○" : "✓",
          ),
        );
        card.append(main, actions);
        nodes.notificationsList.append(card);
      }
      const unread = state.notifications.filter((item) => !item.isRead).length;
      nodes.notificationsCount.textContent = `${unread} 条未读 · 共 ${state.notifications.length} 条`;
      nodes.notificationsEmpty.hidden = state.notifications.length > 0;
      nodes.notificationsList.hidden = state.notifications.length === 0;
      nodes.readAllNotifications.disabled = unread === 0;
      nodes.clearNotifications.disabled = state.notifications.length === 0;
    }

    function renderAll() {
      renderDiary();
      renderCalendar();
      renderNotifications();
      renderGeneration();
      const disabled = !state.context || state.loading || generation.isBusy();
      byId("create-diary").disabled = disabled;
      byId("create-first-diary").disabled = disabled;
      byId("create-calendar").disabled = disabled;
      byId("create-first-calendar").disabled = disabled;
    }

    async function load(kind) {
      if (!state.context) {
        renderAll();
        return;
      }
      const bound = { ...state.context };
      state.loading = true;
      renderAll();
      try {
        if (kind === "diary" || kind === "all") {
          const result = await invokeService("mobile.diary.list", { context: bound });
          if (window.MobileChatGeneratedApp.sameContext(state.context, bound)) {
            state.diary = result.entries || [];
          }
        }
        if (kind === "calendar" || kind === "all") {
          const result = await invokeService("mobile.calendar.list", { context: bound });
          if (window.MobileChatGeneratedApp.sameContext(state.context, bound)) {
            state.calendar = result.events || [];
          }
        }
        if (kind === "notifications" || kind === "all") {
          const result = await invokeService("mobile.notifications.list", { context: bound });
          if (window.MobileChatGeneratedApp.sameContext(state.context, bound)) {
            state.notifications = result.notifications || [];
          }
        }
      } catch (error) {
        setNotice(errorMessage(error), "error");
        if (isContextFailure(error)) await syncContext();
      } finally {
        if (window.MobileChatGeneratedApp.sameContext(state.context, bound)) {
          state.loading = false;
        }
        renderAll();
      }
    }

    async function bindContext(context, activeCharacter, characters) {
      const changed = !window.MobileChatGeneratedApp.sameContext(state.context, context);
      state.context = context ? { ...context } : null;
      state.activeCharacter = activeCharacter || null;
      state.characters = Array.isArray(characters) ? characters : [];
      if (changed) {
        state.diary = [];
        state.calendar = [];
        state.notifications = [];
      }
      renderAll();
      if (state.context) await load("all");
    }

    function openDiary(entryId = null) {
      const entry = state.diary.find((item) => item.entryId === entryId) || null;
      state.editingDiaryId = entry?.entryId || null;
      nodes.diaryDialogTitle.textContent = entry ? "编辑日记" : "新建日记";
      nodes.diaryDate.value = entry?.entryDate || today();
      nodes.diaryMood.value = entry?.mood || "";
      nodes.diaryTitle.value = entry?.title || "";
      nodes.diaryContent.value = entry?.content || "";
      nodes.diaryError.hidden = true;
      nodes.deleteDiary.hidden = !entry;
      nodes.diaryDialog.showModal();
      nodes.diaryTitle.focus();
    }

    async function saveDiary(event) {
      event.preventDefault();
      nodes.diaryError.hidden = true;
      const entry = {
        title: nodes.diaryTitle.value.trim(),
        content: nodes.diaryContent.value.trim(),
        entryDate: nodes.diaryDate.value,
        mood: nodes.diaryMood.value.trim(),
        authorId: state.activeCharacter?.cardUid || state.context?.cardUid,
        authorName: state.activeCharacter?.name || "当前角色",
        tags: [],
        source: "manual",
      };
      const method = state.editingDiaryId ? "mobile.diary.update" : "mobile.diary.create";
      const params = { context: state.context, entry };
      if (state.editingDiaryId) params.entryId = state.editingDiaryId;
      try {
        await invokeService(method, params);
        nodes.diaryDialog.close();
        await Promise.all([load("diary"), load("notifications")]);
        setNotice(state.editingDiaryId ? "日记已更新" : "日记已保存", "success");
        byId("diary-title").focus({ preventScroll: true });
      } catch (error) {
        nodes.diaryError.textContent = errorMessage(error);
        nodes.diaryError.hidden = false;
        if (isContextFailure(error)) {
          nodes.diaryDialog.close();
          await syncContext();
        }
      }
    }

    async function deleteDiary(entryId = state.editingDiaryId) {
      const entry = state.diary.find((item) => item.entryId === entryId);
      if (!entry) return;
      const confirmed = await confirmAction(
        "删除这篇日记？",
        `“${entry.title}”会从当前角色的数据中删除，无法撤销。`,
        "删除日记",
      );
      if (!confirmed) return;
      try {
        await invokeService("mobile.diary.delete", {
          context: state.context,
          entryId: entry.entryId,
        });
        if (nodes.diaryDialog.open) nodes.diaryDialog.close();
        await Promise.all([load("diary"), load("notifications")]);
        setNotice("日记已删除", "success");
        byId("diary-title").focus({ preventScroll: true });
      } catch (error) {
        setNotice(errorMessage(error), "error");
        if (isContextFailure(error)) await syncContext();
      }
    }

    function openCalendar(eventId = null) {
      const calendarEvent = state.calendar.find((item) => item.eventId === eventId) || null;
      state.editingCalendarId = calendarEvent?.eventId || null;
      nodes.calendarDialogTitle.textContent = calendarEvent ? "编辑日程" : "新建日程";
      nodes.calendarTitle.value = calendarEvent?.title || "";
      nodes.calendarStart.value = calendarEvent?.startsOn || today();
      nodes.calendarEnd.value = calendarEvent?.endsOn || "";
      nodes.calendarLocation.value = calendarEvent?.location || "";
      nodes.calendarStatus.value = calendarEvent?.status || "planned";
      nodes.calendarDescription.value = calendarEvent?.description || "";
      nodes.calendarError.hidden = true;
      nodes.deleteCalendar.hidden = !calendarEvent;
      nodes.calendarDialog.showModal();
      nodes.calendarTitle.focus();
    }

    async function saveCalendar(event) {
      event.preventDefault();
      nodes.calendarError.hidden = true;
      const calendarEvent = {
        title: nodes.calendarTitle.value.trim(),
        description: nodes.calendarDescription.value.trim(),
        startsOn: nodes.calendarStart.value,
        endsOn: nodes.calendarEnd.value,
        allDay: true,
        status: nodes.calendarStatus.value,
        participants: state.activeCharacter
          ? [{
            roleId: state.activeCharacter.cardUid,
            displayName: state.activeCharacter.name || "当前角色",
            kind: "character",
            summary: state.activeCharacter.description || "",
          }]
          : [],
        location: nodes.calendarLocation.value.trim(),
        tags: [],
        source: "manual",
      };
      const method = state.editingCalendarId
        ? "mobile.calendar.update"
        : "mobile.calendar.create";
      const params = { context: state.context, event: calendarEvent };
      if (state.editingCalendarId) params.eventId = state.editingCalendarId;
      try {
        await invokeService(method, params);
        nodes.calendarDialog.close();
        await Promise.all([load("calendar"), load("notifications")]);
        setNotice(state.editingCalendarId ? "日程已更新" : "日程已保存", "success");
        byId("calendar-title").focus({ preventScroll: true });
      } catch (error) {
        nodes.calendarError.textContent = errorMessage(error);
        nodes.calendarError.hidden = false;
        if (isContextFailure(error)) {
          nodes.calendarDialog.close();
          await syncContext();
        }
      }
    }

    async function deleteCalendar(eventId = state.editingCalendarId) {
      const calendarEvent = state.calendar.find((item) => item.eventId === eventId);
      if (!calendarEvent) return;
      const confirmed = await confirmAction(
        "删除这条日程？",
        `“${calendarEvent.title}”及关联通知会被删除，无法撤销。`,
        "删除日程",
      );
      if (!confirmed) return;
      try {
        await invokeService("mobile.calendar.delete", {
          context: state.context,
          eventId: calendarEvent.eventId,
        });
        if (nodes.calendarDialog.open) nodes.calendarDialog.close();
        await Promise.all([load("calendar"), load("notifications")]);
        setNotice("日程已删除", "success");
        byId("calendar-title").focus({ preventScroll: true });
      } catch (error) {
        setNotice(errorMessage(error), "error");
        if (isContextFailure(error)) await syncContext();
      }
    }

    async function markNotification(notificationId) {
      const notification = state.notifications.find(
        (item) => item.notificationId === notificationId,
      );
      if (!notification) return;
      try {
        const result = await invokeService("mobile.notifications.mark", {
          context: state.context,
          notificationId,
          isRead: !notification.isRead,
        });
        state.notifications = state.notifications.map((item) => (
          item.notificationId === notificationId ? result.notification : item
        ));
        renderNotifications();
        byId("notifications-title").focus({ preventScroll: true });
      } catch (error) {
        setNotice(errorMessage(error), "error");
        if (isContextFailure(error)) await syncContext();
      }
    }

    async function readAllNotifications() {
      try {
        await invokeService("mobile.notifications.readAll", { context: state.context });
        await load("notifications");
        setNotice("通知已全部标记为已读", "success");
        byId("notifications-title").focus({ preventScroll: true });
      } catch (error) {
        setNotice(errorMessage(error), "error");
        if (isContextFailure(error)) await syncContext();
      }
    }

    async function clearNotifications() {
      if (!state.notifications.length) return;
      const confirmed = await confirmAction(
        "清空全部通知？",
        "只会清除通知记录；日记和日程内容会保留。",
        "清空通知",
      );
      if (!confirmed) return;
      try {
        await invokeService("mobile.notifications.clear", { context: state.context });
        await load("notifications");
        setNotice("通知已清空", "success");
        byId("notifications-title").focus({ preventScroll: true });
      } catch (error) {
        setNotice(errorMessage(error), "error");
        if (isContextFailure(error)) await syncContext();
      }
    }

    byId("create-diary").addEventListener("click", () => openDiary());
    byId("create-first-diary").addEventListener("click", () => openDiary());
    nodes.generateDiary.addEventListener("click", () => void generated.run("diary"));
    nodes.stopDiaryGeneration.addEventListener("click", () => void generated.stop("diary"));
    nodes.diaryForm.addEventListener("submit", (event) => void saveDiary(event));
    nodes.deleteDiary.addEventListener("click", () => void deleteDiary());
    nodes.diaryList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      if (button.dataset.action === "edit") openDiary(button.dataset.id);
      if (button.dataset.action === "delete") void deleteDiary(button.dataset.id);
    });

    byId("create-calendar").addEventListener("click", () => openCalendar());
    byId("create-first-calendar").addEventListener("click", () => openCalendar());
    nodes.generateCalendar.addEventListener("click", () => void generated.run("calendar"));
    nodes.stopCalendarGeneration.addEventListener(
      "click",
      () => void generated.stop("calendar"),
    );
    nodes.calendarForm.addEventListener("submit", (event) => void saveCalendar(event));
    nodes.deleteCalendar.addEventListener("click", () => void deleteCalendar());
    nodes.calendarList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      if (button.dataset.action === "edit") openCalendar(button.dataset.id);
      if (button.dataset.action === "delete") void deleteCalendar(button.dataset.id);
    });

    nodes.notificationsList.addEventListener("click", (event) => {
      const button = event.target.closest('[data-action="mark"]');
      if (button) void markNotification(button.dataset.id);
    });
    nodes.readAllNotifications.addEventListener("click", () => void readAllNotifications());
    nodes.clearNotifications.addEventListener("click", () => void clearNotifications());

    renderAll();
    return {
      bindContext,
      renderGeneration,
      open(screenId) {
        if (["diary", "calendar", "notifications"].includes(screenId)) {
          void load(screenId);
        }
      },
    };
  }

  window.MobileChatLightApps = Object.freeze({ createController });
})();
