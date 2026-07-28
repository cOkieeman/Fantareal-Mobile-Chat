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
      openScreen,
      confirmAction,
      generation,
    } = dependencies;
    const nodes = {
      diaryCount: byId("diary-count"),
      diaryList: byId("diary-list"),
      diaryEmpty: byId("diary-empty"),
      diaryRoles: byId("diary-role-list"),
      diaryOwner: byId("diary-book-owner"),
      diaryBookCount: byId("diary-book-count"),
      diaryDialog: byId("diary-dialog"),
      diaryForm: byId("diary-form"),
      diaryDialogTitle: byId("diary-dialog-title"),
      diaryDate: byId("diary-date-input"),
      diaryMood: byId("diary-mood-input"),
      diaryTitle: byId("diary-title-input"),
      diaryContent: byId("diary-content-input"),
      diaryError: byId("diary-form-error"),
      deleteDiary: byId("delete-diary"),
      diaryDetailDialog: byId("diary-detail-dialog"),
      diaryDetailTitle: byId("diary-detail-title"),
      diaryDetailDate: byId("diary-detail-date"),
      diaryDetailMood: byId("diary-detail-mood"),
      diaryDetailAuthor: byId("diary-detail-author"),
      diaryDetailContent: byId("diary-detail-content"),
      diaryDetailTags: byId("diary-detail-tags"),
      editDiaryFromDetail: byId("edit-diary-from-detail"),
      generateDiary: byId("generate-diary"),
      stopDiaryGeneration: byId("stop-diary-generation"),
      calendarCount: byId("calendar-count"),
      calendarList: byId("calendar-list"),
      calendarEmpty: byId("calendar-empty"),
      calendarGrid: byId("calendar-grid"),
      calendarMonthLabel: byId("calendar-month-label"),
      calendarPreviousMonth: byId("calendar-previous-month"),
      calendarNextMonth: byId("calendar-next-month"),
      calendarDayLabel: byId("calendar-day-label"),
      calendarDayCount: byId("calendar-day-count"),
      calendarAgendaList: byId("calendar-agenda-list"),
      calendarAgendaCount: byId("calendar-agenda-count"),
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
      notificationsUnreadCount: byId("notifications-unread-count"),
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
      viewingDiaryId: null,
      editingCalendarId: null,
      selectedDiaryRoleId: null,
      selectedCalendarDate: today(),
      calendarMonth: today().slice(0, 7),
      notificationFilter: "all",
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
      const selected = state.characters.find((item) => item.cardUid === state.selectedDiaryRoleId)
        || state.activeCharacter;
      const rows = state.diary.filter((entry) => (
        !selected || entry.authorId === selected.cardUid
      ));
      nodes.diaryRoles.replaceChildren();
      for (const character of state.characters) {
        const button = element("button", "diary-role");
        button.type = "button";
        button.dataset.diaryRoleId = character.cardUid;
        button.classList.toggle("is-active", character.cardUid === selected?.cardUid);
        button.append(
          element("span", "diary-role-avatar", String(character.name || "角").slice(0, 1)),
          element("span", "", character.name || "未命名角色"),
        );
        nodes.diaryRoles.append(button);
      }
      nodes.diaryList.replaceChildren();
      for (const entry of rows) {
        const card = element("li", "diary-entry-card");
        const main = element("button", "diary-entry-open");
        main.type = "button";
        main.dataset.action = "view";
        main.dataset.id = entry.entryId;
        main.setAttribute("aria-label", `阅读全文：${entry.title}`);
        const heading = element("div");
        heading.append(
          element("time", "", entry.entryDate),
          element("span", "diary-mood", entry.mood || "日常"),
        );
        main.append(
          heading,
          element("strong", "", entry.title),
          element("p", "", entry.content),
        );
        const actions = element("div", "diary-entry-actions");
        actions.append(
          actionButton("edit", entry.entryId, `编辑日记：${entry.title}`, "编辑"),
          actionButton("delete", entry.entryId, `删除日记：${entry.title}`, "删除"),
        );
        card.append(main, actions);
        nodes.diaryList.append(card);
      }
      nodes.diaryOwner.textContent = `${selected?.name || "当前角色"}的日记`;
      nodes.diaryBookCount.textContent = `${rows.length} 篇`;
      nodes.diaryEmpty.hidden = rows.length > 0;
      nodes.diaryList.hidden = rows.length === 0;
    }

    function statusLabel(status) {
      return {
        planned: "计划中",
        completed: "已完成",
        cancelled: "已取消",
      }[status] || status;
    }

    function upcomingCalendarEvents() {
      const start = new Date(`${today()}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return state.calendar
        .filter((event) => {
          const date = new Date(`${event.startsOn}T00:00:00`);
          return event.status === "planned" && date >= start && date < end;
        })
        .sort((left, right) => (
          left.startsOn.localeCompare(right.startsOn)
          || left.title.localeCompare(right.title, "zh-CN")
        ));
    }

    function renderCalendar() {
      const [yearText, monthText] = state.calendarMonth.split("-");
      const year = Number(yearText);
      const month = Number(monthText) - 1;
      const firstDay = new Date(year, month, 1).getDay();
      const days = new Date(year, month + 1, 0).getDate();
      const byDate = new Map();
      for (const event of state.calendar) {
        const rows = byDate.get(event.startsOn) || [];
        rows.push(event);
        byDate.set(event.startsOn, rows);
      }
      nodes.calendarMonthLabel.textContent = `${year} 年 ${month + 1} 月`;
      nodes.calendarGrid.replaceChildren();
      for (let index = 0; index < firstDay; index += 1) {
        const blank = element("span", "calendar-day is-blank");
        blank.setAttribute("aria-hidden", "true");
        nodes.calendarGrid.append(blank);
      }
      for (let day = 1; day <= days; day += 1) {
        const date = `${yearText}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const button = element("button", "calendar-day");
        button.type = "button";
        button.dataset.calendarDate = date;
        button.classList.toggle("is-active", date === state.selectedCalendarDate);
        button.classList.toggle("has-events", byDate.has(date));
        button.append(element("strong", "", String(day)));
        if (byDate.has(date)) button.append(element("span", "calendar-dot", ""));
        nodes.calendarGrid.append(button);
      }
      const dayRows = byDate.get(state.selectedCalendarDate) || [];
      const agendaRows = upcomingCalendarEvents();
      nodes.calendarAgendaList.replaceChildren();
      for (const event of agendaRows.slice(0, 6)) {
        const item = element("li");
        const open = element("button");
        open.type = "button";
        open.dataset.calendarDate = event.startsOn;
        const date = new Date(`${event.startsOn}T00:00:00`);
        const weekday = new Intl.DateTimeFormat("zh-CN", {
          month: "numeric",
          day: "numeric",
          weekday: "short",
        }).format(date);
        open.append(
          element("time", "", weekday),
          element("strong", "", event.title),
          element("small", "", event.location || "点击查看当天安排"),
        );
        item.append(open);
        nodes.calendarAgendaList.append(item);
      }
      nodes.calendarAgendaCount.textContent = agendaRows.length
        ? `未来 7 天 · ${agendaRows.length} 项`
        : "未来 7 天暂无安排";
      nodes.calendarList.replaceChildren();
      for (const event of dayRows) {
        const card = element("li", "calendar-event-card");
        const main = element("article");
        const heading = element("div");
        heading.append(
          element("strong", "", event.title),
          element("span", "calendar-event-status", statusLabel(event.status)),
        );
        main.append(
          heading,
          element("p", "", event.description || "没有补充说明。"),
          element("small", "", [event.location, event.endsOn ? `至 ${event.endsOn}` : ""].filter(Boolean).join(" · ")),
        );
        const actions = element("div", "calendar-event-actions");
        actions.append(
          actionButton("edit", event.eventId, `编辑日程：${event.title}`, "编辑"),
          actionButton("delete", event.eventId, `删除日程：${event.title}`, "删除"),
        );
        card.append(main, actions);
        nodes.calendarList.append(card);
      }
      nodes.calendarDayLabel.textContent = `${state.selectedCalendarDate} 当日安排`;
      nodes.calendarDayCount.textContent = `${dayRows.length} 项`;
      nodes.calendarEmpty.hidden = dayRows.length > 0;
      nodes.calendarList.hidden = dayRows.length === 0;
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
        feed: "动态",
        forum: "论坛",
        mail: "邮箱",
        phone: "电话",
        live: "直播",
        system: "系统",
        import: "导入",
      }[source] || source;
    }

    function notificationTarget(source) {
      return {
        diary: "diary",
        calendar: "calendar",
        feed: "feed",
        forum: "forum",
        mail: "mail",
        phone: "phone",
        live: "live",
      }[source] || null;
    }

    function renderNotifications() {
      const rows = state.notificationFilter === "unread"
        ? state.notifications.filter((item) => !item.isRead)
        : state.notifications;
      nodes.notificationsList.replaceChildren();
      for (const notification of rows) {
        const card = element(
          "li",
          `notification-row${notification.isRead ? " is-read" : " is-unread"}`,
        );
        card.append(element("span", "notification-dot", ""));
        const main = element("article", "notification-main");
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
        const meta = element("div", "notification-meta");
        meta.append(element("span", "", sourceLabel(notification.source)));
        if (!notification.isRead) meta.append(element("span", "", "未读"));
        main.append(heading, element("p", "", notification.content || "没有附加内容。"), meta);
        const actions = element("div", "notification-actions");
        const target = notificationTarget(notification.source);
        if (target) {
          actions.append(
            actionButton(
              "open-source",
              notification.notificationId,
              `查看${sourceLabel(notification.source)}来源`,
              "查看",
            ),
          );
        }
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
      nodes.notificationsUnreadCount.textContent = String(unread);
      nodes.notificationsCount.textContent = `${unread} 条未读 · 共 ${state.notifications.length} 条`;
      nodes.notificationsEmpty.hidden = rows.length > 0;
      nodes.notificationsList.hidden = rows.length === 0;
      document.querySelectorAll("[data-notification-filter]").forEach((button) => {
        button.classList.toggle(
          "is-active",
          button.dataset.notificationFilter === state.notificationFilter,
        );
      });
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
        state.selectedDiaryRoleId = activeCharacter?.cardUid || null;
        state.viewingDiaryId = null;
        state.selectedCalendarDate = today();
        state.calendarMonth = today().slice(0, 7);
        state.notificationFilter = "all";
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

    function openDiaryDetail(entryId) {
      const entry = state.diary.find((item) => item.entryId === entryId);
      if (!entry) return;
      state.viewingDiaryId = entry.entryId;
      nodes.diaryDetailTitle.textContent = entry.title;
      nodes.diaryDetailDate.textContent = entry.entryDate;
      nodes.diaryDetailMood.textContent = entry.mood || "日常";
      nodes.diaryDetailAuthor.textContent = entry.authorName || "当前角色";
      nodes.diaryDetailContent.replaceChildren();
      for (const paragraph of entry.content.split(/\n{2,}/).filter(Boolean)) {
        nodes.diaryDetailContent.append(element("p", "", paragraph));
      }
      nodes.diaryDetailTags.replaceChildren();
      for (const tag of entry.tags || []) {
        nodes.diaryDetailTags.append(element("span", "", `#${tag}`));
      }
      nodes.diaryDetailTags.hidden = !(entry.tags || []).length;
      nodes.diaryDetailDialog.showModal();
      nodes.diaryDetailTitle.focus();
    }

    async function saveDiary(event) {
      event.preventDefault();
      nodes.diaryError.hidden = true;
      const entry = {
        title: nodes.diaryTitle.value.trim(),
        content: nodes.diaryContent.value.trim(),
        entryDate: nodes.diaryDate.value,
        mood: nodes.diaryMood.value.trim(),
        authorId: (
          state.characters.find((item) => item.cardUid === state.selectedDiaryRoleId)?.cardUid
          || state.activeCharacter?.cardUid
          || state.context?.cardUid
        ),
        authorName: (
          state.characters.find((item) => item.cardUid === state.selectedDiaryRoleId)?.name
          || state.activeCharacter?.name
          || "当前角色"
        ),
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
      nodes.calendarStart.value = calendarEvent?.startsOn || state.selectedCalendarDate || today();
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

    async function openNotificationSource(notificationId) {
      const notification = state.notifications.find(
        (item) => item.notificationId === notificationId,
      );
      const target = notificationTarget(notification?.source);
      if (!notification || !target) {
        setNotice("这条通知没有可打开的来源页面。");
        return;
      }
      if (!notification.isRead) {
        try {
          await invokeService("mobile.notifications.mark", {
            context: state.context,
            notificationId,
            isRead: true,
          });
          notification.isRead = true;
        } catch (error) {
          setNotice(errorMessage(error), "error");
          if (isContextFailure(error)) await syncContext();
          return;
        }
      }
      openScreen(target);
      setNotice(`已打开${sourceLabel(notification.source)}；来源记录会按最新顺序显示。`);
    }

    byId("create-diary").addEventListener("click", () => openDiary());
    byId("create-first-diary").addEventListener("click", () => openDiary());
    nodes.generateDiary.addEventListener("click", () => void generated.run("diary", {
      prepareParams: { roleId: state.selectedDiaryRoleId },
    }));
    nodes.stopDiaryGeneration.addEventListener("click", () => void generated.stop("diary"));
    nodes.diaryForm.addEventListener("submit", (event) => void saveDiary(event));
    nodes.deleteDiary.addEventListener("click", () => void deleteDiary());
    nodes.diaryList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      if (button.dataset.action === "view") openDiaryDetail(button.dataset.id);
      if (button.dataset.action === "edit") openDiary(button.dataset.id);
      if (button.dataset.action === "delete") void deleteDiary(button.dataset.id);
    });
    nodes.editDiaryFromDetail.addEventListener("click", () => {
      const entryId = state.viewingDiaryId;
      nodes.diaryDetailDialog.close();
      if (entryId) openDiary(entryId);
    });
    nodes.diaryRoles.addEventListener("click", (event) => {
      const button = event.target.closest("[data-diary-role-id]");
      if (!button) return;
      state.selectedDiaryRoleId = button.dataset.diaryRoleId;
      renderAll();
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
    nodes.calendarPreviousMonth.addEventListener("click", () => {
      const [year, month] = state.calendarMonth.split("-").map(Number);
      const date = new Date(year, month - 2, 1);
      state.calendarMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      state.selectedCalendarDate = `${state.calendarMonth}-01`;
      renderAll();
    });
    nodes.calendarNextMonth.addEventListener("click", () => {
      const [year, month] = state.calendarMonth.split("-").map(Number);
      const date = new Date(year, month, 1);
      state.calendarMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      state.selectedCalendarDate = `${state.calendarMonth}-01`;
      renderAll();
    });
    nodes.calendarGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-calendar-date]");
      if (!button) return;
      state.selectedCalendarDate = button.dataset.calendarDate;
      renderAll();
    });
    nodes.calendarAgendaList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-calendar-date]");
      if (!button) return;
      state.selectedCalendarDate = button.dataset.calendarDate;
      state.calendarMonth = state.selectedCalendarDate.slice(0, 7);
      renderAll();
    });

    nodes.notificationsList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      if (button.dataset.action === "mark") void markNotification(button.dataset.id);
      if (button.dataset.action === "open-source") {
        void openNotificationSource(button.dataset.id);
      }
    });
    nodes.readAllNotifications.addEventListener("click", () => void readAllNotifications());
    nodes.clearNotifications.addEventListener("click", () => void clearNotifications());
    document.querySelector(".notification-filters").addEventListener("click", (event) => {
      const button = event.target.closest("[data-notification-filter]");
      if (!button) return;
      state.notificationFilter = button.dataset.notificationFilter;
      renderAll();
    });

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
