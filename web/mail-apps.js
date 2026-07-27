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
      count: byId("mail-count"),
      list: byId("mail-list"),
      empty: byId("mail-empty"),
      generate: byId("generate-mail"),
      stopGeneration: byId("stop-mail-generation"),
      compose: byId("compose-mail"),
      allFilter: byId("mail-filter-all"),
      unreadFilter: byId("mail-filter-unread"),
      composeDialog: byId("mail-compose-dialog"),
      composeForm: byId("mail-compose-form"),
      recipient: byId("mail-recipient-input"),
      subject: byId("mail-subject-input"),
      content: byId("mail-content-input"),
      composeError: byId("mail-compose-form-error"),
      threadDialog: byId("mail-thread-dialog"),
      threadTitle: byId("mail-thread-dialog-title"),
      threadMeta: byId("mail-thread-meta"),
      threadMessages: byId("mail-thread-messages"),
      replyForm: byId("mail-reply-form"),
      replyContent: byId("mail-reply-content-input"),
      replyError: byId("mail-reply-form-error"),
      deleteThread: byId("delete-mail-thread"),
    };
    const state = {
      context: null,
      activeCharacter: null,
      characters: [],
      threads: [],
      filter: "all",
      activeThreadId: null,
      loading: false,
    };
    const generated = window.MobileChatGeneratedApp.createRunner({
      ...dependencies,
      getContext: () => state.context,
      canStart: () => !state.loading,
      onCommitted: async () => load(),
      successMessage: () => "新邮件已收取",
      focusAfterCommit: () => byId("mail-title").focus({ preventScroll: true }),
    });

    function activeThread() {
      return state.threads.find((thread) => thread.threadId === state.activeThreadId) || null;
    }

    function filteredThreads() {
      return state.filter === "unread"
        ? state.threads.filter((thread) => !thread.isRead)
        : state.threads;
    }

    function renderThreads() {
      nodes.list.replaceChildren();
      for (const thread of filteredThreads()) {
        const card = element(
          "li",
          `light-app-card mail-card${thread.isRead ? "" : " unread"}`,
        );
        const open = element("button", "mail-card-open");
        open.type = "button";
        open.dataset.threadId = thread.threadId;
        const avatar = element(
          "span",
          "mail-avatar",
          thread.counterpartyName.trim().charAt(0) || "邮",
        );
        const copy = element("span", "mail-card-copy");
        const heading = element("span");
        heading.append(
          element("strong", "", thread.subject),
          element("time", "", formatTime(thread.updatedAt)),
        );
        const latest = thread.messages.at(-1);
        copy.append(
          heading,
          element(
            "small",
            "",
            `${latest?.direction === "sent" ? "我" : thread.counterpartyName}：${latest?.content || ""}`,
          ),
        );
        open.append(avatar, copy);
        if (!thread.isRead) open.append(element("span", "mail-unread-dot", "未读"));
        card.append(open);
        nodes.list.append(card);
      }
      const unread = state.threads.filter((thread) => !thread.isRead).length;
      nodes.count.textContent = `${unread} 封未读 · 共 ${state.threads.length} 个线程`;
      nodes.allFilter.textContent = `全部 ${state.threads.length}`;
      nodes.unreadFilter.textContent = `未读 ${unread}`;
      nodes.allFilter.classList.toggle("is-active", state.filter === "all");
      nodes.unreadFilter.classList.toggle("is-active", state.filter === "unread");
      const visible = filteredThreads();
      nodes.empty.hidden = visible.length > 0;
      nodes.list.hidden = visible.length === 0;
    }

    function renderThreadDialog() {
      const thread = activeThread();
      if (!thread) return;
      nodes.threadTitle.textContent = thread.subject;
      nodes.threadMeta.textContent = `与 ${thread.counterpartyName} 的往来 · ${thread.messages.length} 封`;
      nodes.threadMessages.replaceChildren();
      for (const message of thread.messages) {
        const item = element(
          "li",
          `mail-message ${message.direction === "sent" ? "sent" : "received"}`,
        );
        item.append(
          element("small", "", `${message.direction === "sent" ? "我" : message.authorName} · ${formatTime(message.createdAt)}`),
          element("p", "", message.content),
        );
        nodes.threadMessages.append(item);
      }
    }

    function renderGeneration() {
      const owners = ["mail", "mail-compose", "mail-reply"];
      const activeOwner = owners.find((purpose) => generation.isOwner(`light:${purpose}`));
      const busy = generation.isBusy();
      if (activeOwner) {
        nodes.count.textContent = generation.isCancelled(`light:${activeOwner}`)
          ? "正在停止生成…"
          : activeOwner === "mail"
            ? "正在收取邮件…"
            : "正在等待角色回信…";
      }
      nodes.generate.hidden = Boolean(activeOwner);
      nodes.stopGeneration.hidden = !activeOwner;
      nodes.stopGeneration.dataset.owner = activeOwner || "";
      nodes.generate.disabled = !state.context || state.loading || busy;
      nodes.compose.disabled = !state.context || state.loading || busy;
      nodes.replyContent.disabled = busy;
    }

    function renderAll() {
      renderThreads();
      renderGeneration();
    }

    async function load() {
      if (!state.context) {
        renderAll();
        return;
      }
      const bound = { ...state.context };
      state.loading = true;
      renderAll();
      try {
        const result = await invokeService("mobile.mail.list", { context: bound });
        if (window.MobileChatGeneratedApp.sameContext(state.context, bound)) {
          state.threads = result.threads || [];
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
        state.threads = [];
        state.activeThreadId = null;
      }
      renderAll();
      if (state.context) await load();
    }

    function openCompose() {
      nodes.recipient.replaceChildren();
      for (const character of state.characters) {
        const option = document.createElement("option");
        option.value = character.cardUid;
        option.textContent = character.name || "未命名角色";
        nodes.recipient.append(option);
      }
      nodes.subject.value = "";
      nodes.content.value = "";
      nodes.composeError.hidden = true;
      nodes.composeDialog.showModal();
      nodes.subject.focus();
    }

    async function composeMail(event) {
      event.preventDefault();
      nodes.composeError.hidden = true;
      await generated.run("mail-compose", {
        servicePrefix: "mobile.mail.compose",
        prepareParams: {
          recipientId: nodes.recipient.value,
          subject: nodes.subject.value.trim(),
          content: nodes.content.value.trim(),
        },
        onCommitted: async () => {
          nodes.composeDialog.close();
          await load();
        },
        successMessage: "邮件已发送，角色回信已保存",
        focusAfterCommit: () => byId("mail-title").focus({ preventScroll: true }),
      });
    }

    async function openThread(threadId) {
      state.activeThreadId = threadId;
      const thread = activeThread();
      if (!thread) return;
      if (!thread.isRead) {
        try {
          const result = await invokeService("mobile.mail.mark", {
            context: state.context,
            threadId,
            isRead: true,
          });
          state.threads = state.threads.map((item) => (
            item.threadId === threadId ? result.thread : item
          ));
        } catch (error) {
          setNotice(errorMessage(error), "error");
          if (isContextFailure(error)) await syncContext();
          return;
        }
      }
      nodes.replyContent.value = "";
      nodes.replyError.hidden = true;
      renderAll();
      renderThreadDialog();
      nodes.threadDialog.showModal();
      nodes.threadTitle.focus();
    }

    async function replyMail(event) {
      event.preventDefault();
      const thread = activeThread();
      if (!thread) return;
      nodes.replyError.hidden = true;
      await generated.run("mail-reply", {
        servicePrefix: "mobile.mail.reply",
        prepareParams: {
          threadId: thread.threadId,
          content: nodes.replyContent.value.trim(),
        },
        onCommitted: async () => {
          await load();
          renderThreadDialog();
          nodes.replyContent.value = "";
        },
        successMessage: "回复已发送，角色回信已保存",
        focusAfterCommit: () => nodes.threadTitle.focus({ preventScroll: true }),
      });
    }

    async function deleteThread() {
      const thread = activeThread();
      if (!thread) return;
      const confirmed = await confirmAction(
        "删除这个邮件线程？",
        `“${thread.subject}”及全部往来会被删除，无法撤销。`,
        "删除邮件",
      );
      if (!confirmed) return;
      try {
        await invokeService("mobile.mail.delete", {
          context: state.context,
          threadId: thread.threadId,
        });
        nodes.threadDialog.close();
        state.activeThreadId = null;
        await load();
        setNotice("邮件线程已删除", "success");
      } catch (error) {
        setNotice(errorMessage(error), "error");
        if (isContextFailure(error)) await syncContext();
      }
    }

    nodes.generate.addEventListener("click", () => void generated.run("mail"));
    nodes.stopGeneration.addEventListener("click", () => {
      const owner = nodes.stopGeneration.dataset.owner;
      if (owner) void generated.stop(owner);
    });
    nodes.compose.addEventListener("click", openCompose);
    byId("mail-empty").querySelector("[data-open-mail-compose]").addEventListener(
      "click",
      openCompose,
    );
    nodes.composeForm.addEventListener("submit", (event) => void composeMail(event));
    nodes.replyForm.addEventListener("submit", (event) => void replyMail(event));
    nodes.deleteThread.addEventListener("click", () => void deleteThread());
    nodes.allFilter.addEventListener("click", () => {
      state.filter = "all";
      renderAll();
    });
    nodes.unreadFilter.addEventListener("click", () => {
      state.filter = "unread";
      renderAll();
    });
    nodes.list.addEventListener("click", (event) => {
      const button = event.target.closest("[data-thread-id]");
      if (button) void openThread(button.dataset.threadId);
    });

    renderAll();
    return {
      bindContext,
      renderGeneration,
      open(screenId) {
        if (screenId === "mail") void load();
      },
    };
  }

  window.MobileChatMailApps = Object.freeze({ createController });
})();
