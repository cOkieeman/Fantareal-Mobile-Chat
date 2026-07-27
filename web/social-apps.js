(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function actionButton(action, id, label, glyph) {
    const button = element("button", "", glyph);
    button.type = "button";
    button.dataset.action = action;
    button.dataset.id = id;
    button.setAttribute("aria-label", label);
    button.title = label;
    return button;
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
      feedCount: byId("feed-count"),
      feedList: byId("feed-list"),
      feedEmpty: byId("feed-empty"),
      feedDialog: byId("feed-dialog"),
      feedForm: byId("feed-form"),
      feedDialogTitle: byId("feed-dialog-title"),
      feedContent: byId("feed-content-input"),
      feedTags: byId("feed-tags-input"),
      feedError: byId("feed-form-error"),
      deleteFeed: byId("delete-feed"),
      generateFeed: byId("generate-feed"),
      stopFeedGeneration: byId("stop-feed-generation"),
      forumCount: byId("forum-count"),
      forumList: byId("forum-list"),
      forumEmpty: byId("forum-empty"),
      forumDialog: byId("forum-thread-dialog"),
      forumForm: byId("forum-thread-form"),
      forumDialogTitle: byId("forum-thread-dialog-title"),
      forumTitle: byId("forum-title-input"),
      forumCategory: byId("forum-category-input"),
      forumBody: byId("forum-body-input"),
      forumError: byId("forum-thread-form-error"),
      deleteForum: byId("delete-forum-thread"),
      replyDialog: byId("forum-reply-dialog"),
      replyForm: byId("forum-reply-form"),
      replyContent: byId("forum-reply-content-input"),
      replyError: byId("forum-reply-form-error"),
      generateForum: byId("generate-forum"),
      stopForumGeneration: byId("stop-forum-generation"),
    };
    const state = {
      context: null,
      activeCharacter: null,
      feed: [],
      forum: [],
      editingPostId: null,
      editingThreadId: null,
      replyThreadId: null,
      loading: false,
    };
    const generated = window.MobileChatGeneratedApp.createRunner({
      ...dependencies,
      getContext: () => state.context,
      canStart: () => !state.loading,
      onCommitted: load,
      successMessage: (purpose) => (
        purpose === "feed" ? "角色动态已生成" : "论坛主题已生成"
      ),
      focusAfterCommit: (purpose) => {
        byId(`${purpose}-title`).focus({ preventScroll: true });
      },
    });

    function renderFeed() {
      nodes.feedList.replaceChildren();
      for (const post of state.feed) {
        const card = element("li", "light-app-card social-card");
        const main = element("article", "light-app-card-main");
        const heading = element("div");
        heading.append(
          element("strong", "", post.authorName),
          element("time", "", formatTime(post.createdAt)),
        );
        const meta = element("div", "light-app-card-meta");
        for (const tag of post.tags || []) meta.append(element("span", "", `#${tag}`));
        main.append(heading, element("p", "", post.content), meta);
        const actions = element("div", "light-app-card-actions");
        actions.append(
          actionButton(
            "like",
            post.postId,
            post.liked ? "取消喜欢" : "喜欢",
            `${post.liked ? "♥" : "♡"} ${post.likeCount}`,
          ),
          actionButton("edit", post.postId, "编辑动态", "✎"),
          actionButton("delete", post.postId, "删除动态", "⌫"),
        );
        card.append(main, actions);
        nodes.feedList.append(card);
      }
      nodes.feedCount.textContent = `${state.feed.length} 条 · ${state.activeCharacter?.name || "当前角色"}`;
      nodes.feedEmpty.hidden = state.feed.length > 0;
      nodes.feedList.hidden = state.feed.length === 0;
    }

    function renderForum() {
      nodes.forumList.replaceChildren();
      for (const thread of state.forum) {
        const card = element("li", "light-app-card social-card forum-card");
        const main = element("article", "light-app-card-main");
        const heading = element("div");
        heading.append(
          element("strong", "", thread.title),
          element("time", "", formatTime(thread.updatedAt)),
        );
        const meta = element("div", "light-app-card-meta");
        meta.append(
          element("span", "", thread.category),
          element("span", "", `${thread.replies.length} 条回复`),
          element("span", "", thread.authorName),
        );
        main.append(heading, element("p", "", thread.body), meta);

        if (thread.replies.length) {
          const replies = element("ul", "forum-replies");
          for (const reply of thread.replies) {
            const item = element("li");
            const copy = element("div");
            copy.append(
              element("strong", "", reply.authorName),
              element("p", "", reply.content),
              element("time", "", formatTime(reply.createdAt)),
            );
            item.append(
              copy,
              actionButton("delete-reply", reply.replyId, "删除回复", "⌫"),
            );
            item.dataset.threadId = thread.threadId;
            replies.append(item);
          }
          main.append(replies);
        }

        const actions = element("div", "light-app-card-actions");
        actions.append(
          actionButton("reply", thread.threadId, `回复：${thread.title}`, "↩"),
          actionButton("edit", thread.threadId, `编辑主题：${thread.title}`, "✎"),
          actionButton("delete", thread.threadId, `删除主题：${thread.title}`, "⌫"),
        );
        card.append(main, actions);
        nodes.forumList.append(card);
      }
      const replies = state.forum.reduce((total, thread) => total + thread.replies.length, 0);
      nodes.forumCount.textContent = `${state.forum.length} 个主题 · ${replies} 条回复`;
      nodes.forumEmpty.hidden = state.forum.length > 0;
      nodes.forumList.hidden = state.forum.length === 0;
    }

    function renderGeneration() {
      const feedOwner = "light:feed";
      const forumOwner = "light:forum";
      const feedGenerating = generation.isOwner(feedOwner);
      const forumGenerating = generation.isOwner(forumOwner);
      if (feedGenerating) {
        nodes.feedCount.textContent = generation.isCancelled(feedOwner)
          ? "正在停止生成…"
          : "正在生成动态…";
      }
      if (forumGenerating) {
        nodes.forumCount.textContent = generation.isCancelled(forumOwner)
          ? "正在停止生成…"
          : "正在生成论坛主题…";
      }
      nodes.generateFeed.hidden = feedGenerating;
      nodes.stopFeedGeneration.hidden = !feedGenerating;
      nodes.generateForum.hidden = forumGenerating;
      nodes.stopForumGeneration.hidden = !forumGenerating;
      nodes.generateFeed.disabled = !state.context || state.loading || generation.isBusy();
      nodes.generateForum.disabled = !state.context || state.loading || generation.isBusy();
    }

    function renderAll() {
      renderFeed();
      renderForum();
      renderGeneration();
      const disabled = !state.context || state.loading || generation.isBusy();
      byId("create-feed").disabled = disabled;
      byId("create-first-feed").disabled = disabled;
      byId("create-forum-thread").disabled = disabled;
      byId("create-first-forum-thread").disabled = disabled;
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
        if (kind === "feed" || kind === "all") {
          const result = await invokeService("mobile.feed.list", { context: bound });
          if (window.MobileChatGeneratedApp.sameContext(state.context, bound)) {
            state.feed = result.posts || [];
          }
        }
        if (kind === "forum" || kind === "all") {
          const result = await invokeService("mobile.forum.list", { context: bound });
          if (window.MobileChatGeneratedApp.sameContext(state.context, bound)) {
            state.forum = result.threads || [];
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

    async function bindContext(context, activeCharacter) {
      const changed = !window.MobileChatGeneratedApp.sameContext(state.context, context);
      state.context = context ? { ...context } : null;
      state.activeCharacter = activeCharacter || null;
      if (changed) {
        state.feed = [];
        state.forum = [];
      }
      renderAll();
      if (state.context) await load("all");
    }

    function openFeed(postId = null) {
      const post = state.feed.find((item) => item.postId === postId) || null;
      state.editingPostId = post?.postId || null;
      nodes.feedDialogTitle.textContent = post ? "编辑动态" : "发布动态";
      nodes.feedContent.value = post?.content || "";
      nodes.feedTags.value = (post?.tags || []).join("，");
      nodes.feedError.hidden = true;
      nodes.deleteFeed.hidden = !post;
      nodes.feedDialog.showModal();
      nodes.feedContent.focus();
    }

    async function saveFeed(event) {
      event.preventDefault();
      nodes.feedError.hidden = true;
      const post = {
        content: nodes.feedContent.value.trim(),
        authorId: state.activeCharacter?.cardUid || state.context?.cardUid,
        authorName: state.activeCharacter?.name || "当前角色",
        tags: nodes.feedTags.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
        source: "manual",
      };
      const method = state.editingPostId ? "mobile.feed.update" : "mobile.feed.create";
      const params = { context: state.context, post };
      if (state.editingPostId) params.postId = state.editingPostId;
      try {
        await invokeService(method, params);
        nodes.feedDialog.close();
        await load("feed");
        setNotice(state.editingPostId ? "动态已更新" : "动态已发布", "success");
        byId("feed-title").focus({ preventScroll: true });
      } catch (error) {
        nodes.feedError.textContent = errorMessage(error);
        nodes.feedError.hidden = false;
        if (isContextFailure(error)) {
          nodes.feedDialog.close();
          await syncContext();
        }
      }
    }

    async function toggleLike(postId) {
      try {
        const result = await invokeService("mobile.feed.like.toggle", {
          context: state.context,
          postId,
        });
        state.feed = state.feed.map((post) => (
          post.postId === postId ? result.post : post
        ));
        renderAll();
      } catch (error) {
        setNotice(errorMessage(error), "error");
        if (isContextFailure(error)) await syncContext();
      }
    }

    async function deleteFeed(postId = state.editingPostId) {
      const post = state.feed.find((item) => item.postId === postId);
      if (!post) return;
      const confirmed = await confirmAction(
        "删除这条动态？",
        "动态及其来源通知会被删除，无法撤销。",
        "删除动态",
      );
      if (!confirmed) return;
      try {
        await invokeService("mobile.feed.delete", { context: state.context, postId });
        if (nodes.feedDialog.open) nodes.feedDialog.close();
        await load("feed");
        setNotice("动态已删除", "success");
      } catch (error) {
        setNotice(errorMessage(error), "error");
        if (isContextFailure(error)) await syncContext();
      }
    }

    function openForum(threadId = null) {
      const thread = state.forum.find((item) => item.threadId === threadId) || null;
      state.editingThreadId = thread?.threadId || null;
      nodes.forumDialogTitle.textContent = thread ? "编辑论坛主题" : "发布论坛主题";
      nodes.forumTitle.value = thread?.title || "";
      nodes.forumCategory.value = thread?.category || "闲聊";
      nodes.forumBody.value = thread?.body || "";
      nodes.forumError.hidden = true;
      nodes.deleteForum.hidden = !thread;
      nodes.forumDialog.showModal();
      nodes.forumTitle.focus();
    }

    async function saveForum(event) {
      event.preventDefault();
      nodes.forumError.hidden = true;
      const thread = {
        title: nodes.forumTitle.value.trim(),
        body: nodes.forumBody.value.trim(),
        category: nodes.forumCategory.value.trim(),
        authorId: state.activeCharacter?.cardUid || state.context?.cardUid,
        authorName: state.activeCharacter?.name || "当前角色",
        source: "manual",
      };
      const method = state.editingThreadId ? "mobile.forum.update" : "mobile.forum.create";
      const params = { context: state.context, thread };
      if (state.editingThreadId) params.threadId = state.editingThreadId;
      try {
        await invokeService(method, params);
        nodes.forumDialog.close();
        await load("forum");
        setNotice(state.editingThreadId ? "论坛主题已更新" : "论坛主题已发布", "success");
        byId("forum-title").focus({ preventScroll: true });
      } catch (error) {
        nodes.forumError.textContent = errorMessage(error);
        nodes.forumError.hidden = false;
        if (isContextFailure(error)) {
          nodes.forumDialog.close();
          await syncContext();
        }
      }
    }

    async function deleteForum(threadId = state.editingThreadId) {
      const thread = state.forum.find((item) => item.threadId === threadId);
      if (!thread) return;
      const confirmed = await confirmAction(
        "删除这个论坛主题？",
        `“${thread.title}”及全部回复会被删除，无法撤销。`,
        "删除主题",
      );
      if (!confirmed) return;
      try {
        await invokeService("mobile.forum.delete", {
          context: state.context,
          threadId,
        });
        if (nodes.forumDialog.open) nodes.forumDialog.close();
        await load("forum");
        setNotice("论坛主题已删除", "success");
      } catch (error) {
        setNotice(errorMessage(error), "error");
        if (isContextFailure(error)) await syncContext();
      }
    }

    function openReply(threadId) {
      state.replyThreadId = threadId;
      nodes.replyContent.value = "";
      nodes.replyError.hidden = true;
      nodes.replyDialog.showModal();
      nodes.replyContent.focus();
    }

    async function saveReply(event) {
      event.preventDefault();
      nodes.replyError.hidden = true;
      try {
        await invokeService("mobile.forum.reply.create", {
          context: state.context,
          threadId: state.replyThreadId,
          reply: {
            content: nodes.replyContent.value.trim(),
            authorId: state.activeCharacter?.cardUid || state.context?.cardUid,
            authorName: state.activeCharacter?.name || "当前角色",
            source: "manual",
          },
        });
        nodes.replyDialog.close();
        await load("forum");
        setNotice("回复已发布", "success");
      } catch (error) {
        nodes.replyError.textContent = errorMessage(error);
        nodes.replyError.hidden = false;
        if (isContextFailure(error)) {
          nodes.replyDialog.close();
          await syncContext();
        }
      }
    }

    async function deleteReply(threadId, replyId) {
      const confirmed = await confirmAction(
        "删除这条回复？",
        "回复会从当前主题中删除，无法撤销。",
        "删除回复",
      );
      if (!confirmed) return;
      try {
        await invokeService("mobile.forum.reply.delete", {
          context: state.context,
          threadId,
          replyId,
        });
        await load("forum");
        setNotice("回复已删除", "success");
      } catch (error) {
        setNotice(errorMessage(error), "error");
        if (isContextFailure(error)) await syncContext();
      }
    }

    byId("create-feed").addEventListener("click", () => openFeed());
    byId("create-first-feed").addEventListener("click", () => openFeed());
    nodes.feedForm.addEventListener("submit", (event) => void saveFeed(event));
    nodes.deleteFeed.addEventListener("click", () => void deleteFeed());
    nodes.generateFeed.addEventListener("click", () => void generated.run("feed"));
    nodes.stopFeedGeneration.addEventListener("click", () => void generated.stop("feed"));
    nodes.feedList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      if (button.dataset.action === "like") void toggleLike(button.dataset.id);
      if (button.dataset.action === "edit") openFeed(button.dataset.id);
      if (button.dataset.action === "delete") void deleteFeed(button.dataset.id);
    });

    byId("create-forum-thread").addEventListener("click", () => openForum());
    byId("create-first-forum-thread").addEventListener("click", () => openForum());
    nodes.forumForm.addEventListener("submit", (event) => void saveForum(event));
    nodes.deleteForum.addEventListener("click", () => void deleteForum());
    nodes.replyForm.addEventListener("submit", (event) => void saveReply(event));
    nodes.generateForum.addEventListener("click", () => void generated.run("forum"));
    nodes.stopForumGeneration.addEventListener("click", () => void generated.stop("forum"));
    nodes.forumList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      if (button.dataset.action === "reply") openReply(button.dataset.id);
      if (button.dataset.action === "edit") openForum(button.dataset.id);
      if (button.dataset.action === "delete") void deleteForum(button.dataset.id);
      if (button.dataset.action === "delete-reply") {
        const threadId = button.closest("[data-thread-id]")?.dataset.threadId;
        if (threadId) void deleteReply(threadId, button.dataset.id);
      }
    });

    renderAll();
    return {
      bindContext,
      renderGeneration,
      open(screenId) {
        if (["feed", "forum"].includes(screenId)) void load(screenId);
      },
    };
  }

  window.MobileChatSocialApps = Object.freeze({ createController });
})();
