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
      feedEmptyCopy: byId("feed-empty-copy"),
      feedListView: byId("feed-list-view"),
      feedDetailView: byId("feed-detail-view"),
      feedBackHome: byId("feed-back-home"),
      feedBackList: byId("feed-back-list"),
      feedPageTitle: byId("feed-title"),
      feedDetailAvatar: byId("feed-detail-avatar"),
      feedDetailAuthor: byId("feed-detail-author"),
      feedDetailTime: byId("feed-detail-time"),
      feedDetailTitle: byId("feed-detail-title"),
      feedDetailContent: byId("feed-detail-content"),
      feedDetailMedia: byId("feed-detail-media"),
      feedDetailMediaCopy: byId("feed-detail-media-copy"),
      feedDetailTags: byId("feed-detail-tags"),
      feedDetailContext: byId("feed-detail-context"),
      feedDetailLike: byId("feed-detail-like"),
      feedDetailEdit: byId("feed-detail-edit"),
      feedDetailDelete: byId("feed-detail-delete"),
      feedDialog: byId("feed-dialog"),
      feedForm: byId("feed-form"),
      feedDialogTitle: byId("feed-dialog-title"),
      feedTitle: byId("feed-title-input"),
      feedContent: byId("feed-content-input"),
      feedTags: byId("feed-tags-input"),
      feedError: byId("feed-form-error"),
      deleteFeed: byId("delete-feed"),
      generateFeed: byId("generate-feed"),
      stopFeedGeneration: byId("stop-feed-generation"),
      forumCount: byId("forum-count"),
      forumList: byId("forum-list"),
      forumEmpty: byId("forum-empty"),
      forumListView: byId("forum-list-view"),
      forumDetailView: byId("forum-detail-view"),
      forumBackList: byId("forum-back-list"),
      forumDetailCategory: byId("forum-detail-category"),
      forumDetailTitle: byId("forum-detail-title"),
      forumDetailMeta: byId("forum-detail-meta"),
      forumDetailBody: byId("forum-detail-body"),
      forumDetailReplies: byId("forum-detail-replies"),
      forumFloorCount: byId("forum-floor-count"),
      forumDetailReply: byId("forum-detail-reply"),
      forumDetailEdit: byId("forum-detail-edit"),
      forumDetailDelete: byId("forum-detail-delete"),
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
      feedTab: "home",
      detailPostId: null,
      forum: [],
      forumTab: "latest",
      detailThreadId: null,
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

    function initials(value) {
      const rows = String(value || "角").trim().split(/\s+/).filter(Boolean);
      return (rows.length > 1 ? rows.slice(0, 2).map((item) => item[0]).join("") : rows[0]?.slice(0, 2) || "角")
        .toUpperCase();
    }

    function feedSearchText(post) {
      return [
        post.title,
        post.content,
        post.authorName,
        post.eventType,
        ...(post.tags || []),
        post.metadata?.mood,
        post.metadata?.location,
      ].map((item) => String(item || "")).join(" ");
    }

    function feedSocialScore(post) {
      return (post.metadata?.views || 0)
        + (post.likeCount || 0) * 5
        + (post.metadata?.commentCount || 0) * 8;
    }

    function visibleFeed() {
      if (state.feedTab === "discover") {
        return [...state.feed].sort((left, right) => (
          feedSocialScore(right) - feedSocialScore(left)
        ));
      }
      if (state.feedTab === "notice") {
        return state.feed.filter((post) => (
          /通知|公告|提醒|系统|notice/i.test(feedSearchText(post))
        ));
      }
      if (state.feedTab === "mine") {
        return state.feed.filter((post) => post.source === "manual");
      }
      return state.feed;
    }

    function feedMetaText(post) {
      const parts = [post.metadata?.mood, post.metadata?.location].filter(Boolean);
      return parts.join(" · ");
    }

    function feedStat(label, value) {
      const node = element("span", "", `${label} ${value || 0}`);
      node.setAttribute("aria-label", `${label} ${value || 0}`);
      return node;
    }

    function renderFeedDetail() {
      const post = state.feed.find((item) => item.postId === state.detailPostId);
      const detailOpen = Boolean(post);
      if (!detailOpen) state.detailPostId = null;
      nodes.feedListView.hidden = detailOpen;
      nodes.feedDetailView.hidden = !detailOpen;
      nodes.feedBackHome.hidden = detailOpen;
      nodes.feedBackList.hidden = !detailOpen;
      nodes.feedPageTitle.textContent = detailOpen ? "动态详情" : "动态";
      nodes.generateFeed.hidden = detailOpen || generation.isOwner("light:feed");
      if (!post) return;

      nodes.feedDetailAvatar.textContent = initials(post.authorName);
      nodes.feedDetailAuthor.textContent = post.authorName;
      nodes.feedDetailTime.textContent = formatTime(post.createdAt);
      nodes.feedDetailTitle.textContent = post.title;
      nodes.feedDetailContent.textContent = post.content;
      nodes.feedDetailMedia.hidden = !post.metadata?.mediaHint;
      nodes.feedDetailMediaCopy.textContent = post.metadata?.mediaHint || "";
      nodes.feedDetailTags.replaceChildren(
        ...(post.tags || []).map((tag) => element("span", "", `#${tag}`)),
      );
      nodes.feedDetailContext.replaceChildren();
      for (const [label, value] of [
        ["心情", post.metadata?.mood],
        ["地点", post.metadata?.location],
        ["类型", post.eventType],
      ]) {
        if (!value) continue;
        const row = element("div");
        row.append(element("dt", "", label), element("dd", "", value));
        nodes.feedDetailContext.append(row);
      }
      nodes.feedDetailLike.textContent = `${post.liked ? "♥" : "♡"} ${post.likeCount}`;
      nodes.feedDetailLike.setAttribute("aria-label", post.liked ? "取消喜欢" : "喜欢");
    }

    function renderFeed() {
      const rows = visibleFeed();
      nodes.feedList.replaceChildren();
      for (const post of rows) {
        const card = element("li", "feed-card");
        const article = element("article");
        const author = element("header", "feed-card-author");
        const avatar = element("span", "feed-avatar", initials(post.authorName));
        avatar.setAttribute("aria-hidden", "true");
        const identity = element("div");
        identity.append(
          element("strong", "", post.authorName),
          element("time", "", formatTime(post.createdAt)),
        );
        const more = element("span", "feed-card-more", "•••");
        more.setAttribute("aria-hidden", "true");
        author.append(avatar, identity, more);

        const open = element("button", "feed-card-open");
        open.type = "button";
        open.dataset.action = "open";
        open.dataset.id = post.postId;
        open.setAttribute("aria-label", `查看动态：${post.title}`);
        open.append(element("p", "feed-card-copy", post.content));
        if (post.metadata?.mediaHint) {
          const media = element("span", "feed-card-media");
          media.append(
            element("span", "", "▧"),
            element("small", "", post.metadata.mediaHint),
          );
          open.append(media);
        }
        const metaText = feedMetaText(post);
        if (metaText) open.append(element("span", "feed-card-context", metaText));

        const tagsNode = element("div", "feed-tags");
        for (const tag of post.tags || []) tagsNode.append(element("span", "", `#${tag}`));
        const actions = element("footer", "feed-card-actions");
        const like = actionButton(
          "like",
          post.postId,
          post.liked ? "取消喜欢" : "喜欢",
          `${post.liked ? "♥" : "♡"} ${post.likeCount}`,
        );
        like.className = post.liked ? "is-liked" : "";
        actions.append(
          feedStat("浏览", post.metadata?.views),
          feedStat("评论", post.metadata?.commentCount),
          like,
          actionButton("edit", post.postId, "编辑动态", "✎"),
          actionButton("delete", post.postId, "删除动态", "⌫"),
        );
        article.append(author, open, tagsNode, actions);
        card.append(article);
        nodes.feedList.append(card);
      }

      const tabLabels = {
        home: "全部动态",
        discover: "角色发现",
        notice: "通知动态",
        mine: "我的动态",
      };
      nodes.feedCount.textContent = `${tabLabels[state.feedTab]} · ${rows.length} 条`;
      nodes.feedEmptyCopy.textContent = state.feedTab === "home"
        ? "发布一段近况，或刷新看看角色们正在做什么。"
        : "这个分区暂时没有内容，可以返回首页继续浏览。";
      nodes.feedEmpty.hidden = rows.length > 0;
      nodes.feedList.hidden = rows.length === 0;
      document.querySelectorAll("[data-feed-tab]").forEach((button) => {
        const active = button.dataset.feedTab === state.feedTab;
        button.classList.toggle("is-active", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      });
      renderFeedDetail();
    }

    function visibleForum() {
      if (state.forumTab === "hot") {
        return [...state.forum].sort((left, right) => (
          right.replies.length - left.replies.length
          || new Date(right.updatedAt) - new Date(left.updatedAt)
        ));
      }
      if (state.forumTab === "mine") {
        return state.forum.filter((thread) => thread.source === "manual");
      }
      return [...state.forum].sort((left, right) => (
        new Date(right.updatedAt) - new Date(left.updatedAt)
      ));
    }

    function renderForumDetail() {
      const thread = state.forum.find((item) => item.threadId === state.detailThreadId);
      const open = Boolean(thread);
      if (!open) state.detailThreadId = null;
      nodes.forumListView.hidden = open;
      nodes.forumDetailView.hidden = !open;
      nodes.generateForum.hidden = open || generation.isOwner("light:forum");
      if (!thread) return;
      nodes.forumDetailCategory.textContent = thread.category;
      nodes.forumDetailTitle.textContent = thread.title;
      nodes.forumDetailMeta.textContent = `${thread.authorName} · ${formatTime(thread.updatedAt)}`;
      nodes.forumDetailBody.textContent = thread.body;
      nodes.forumFloorCount.textContent = `${thread.replies.length} 楼`;
      nodes.forumDetailReplies.replaceChildren();
      thread.replies.forEach((reply, index) => {
        const item = element("li", "forum-floor");
        item.dataset.threadId = thread.threadId;
        const heading = element("div");
        heading.append(
          element("strong", "", reply.authorName),
          element("span", "", `${index + 1} 楼 · ${formatTime(reply.createdAt)}`),
        );
        item.append(
          heading,
          element("p", "", reply.content),
          actionButton("delete-reply", reply.replyId, "删除回复", "删除"),
        );
        nodes.forumDetailReplies.append(item);
      });
    }

    function renderForum() {
      const rows = visibleForum();
      nodes.forumList.replaceChildren();
      for (const thread of rows) {
        const card = element("li", "forum-board-card");
        const open = element("button", "forum-board-open");
        open.type = "button";
        open.dataset.action = "open-detail";
        open.dataset.id = thread.threadId;
        open.setAttribute("aria-label", `查看主题：${thread.title}`);
        const heading = element("span", "forum-board-heading");
        heading.append(
          element("span", "forum-category", thread.category),
          element("time", "", formatTime(thread.updatedAt)),
        );
        const title = element("strong", "", thread.title);
        const body = element("p", "", thread.body);
        const meta = element("span", "forum-board-meta");
        meta.append(
          element("span", "", thread.authorName),
          element("span", "", `回复 ${thread.replies.length}`),
        );
        open.append(heading, title, body, meta);
        card.append(open);
        nodes.forumList.append(card);
      }
      const replies = state.forum.reduce((total, thread) => total + thread.replies.length, 0);
      nodes.forumCount.textContent = `${state.forum.length} 个主题 · ${replies} 条回复`;
      nodes.forumEmpty.hidden = rows.length > 0;
      nodes.forumList.hidden = rows.length === 0;
      document.querySelectorAll("[data-forum-tab]").forEach((button) => {
        const active = button.dataset.forumTab === state.forumTab;
        button.classList.toggle("is-active", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      });
      renderForumDetail();
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
      nodes.generateFeed.hidden = feedGenerating || Boolean(state.detailPostId);
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
      byId("create-feed-pivot").disabled = disabled;
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
        state.feedTab = "home";
        state.detailPostId = null;
        state.forum = [];
        state.forumTab = "latest";
        state.detailThreadId = null;
      }
      renderAll();
      if (state.context) await load("all");
    }

    function openFeed(postId = null) {
      const post = state.feed.find((item) => item.postId === postId) || null;
      state.editingPostId = post?.postId || null;
      nodes.feedDialogTitle.textContent = post ? "编辑动态" : "发布动态";
      nodes.feedTitle.value = post?.title || "";
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
        title: nodes.feedTitle.value.trim() || nodes.feedContent.value.trim().slice(0, 40),
        content: nodes.feedContent.value.trim(),
        authorId: state.activeCharacter?.cardUid || state.context?.cardUid,
        authorName: state.activeCharacter?.name || "当前角色",
        eventType: "status",
        tags: nodes.feedTags.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
        metadata: {
          mood: "",
          location: "",
          mediaHint: "",
          views: 0,
          commentCount: 0,
        },
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
        if (state.editingPostId) state.detailPostId = state.editingPostId;
        renderFeed();
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

    function openFeedDetail(postId) {
      if (!state.feed.some((item) => item.postId === postId)) return;
      state.detailPostId = postId;
      renderFeed();
      nodes.feedDetailTitle.focus({ preventScroll: true });
    }

    function closeFeedDetail({ focus = true } = {}) {
      if (!state.detailPostId) return;
      state.detailPostId = null;
      renderFeed();
      if (focus) nodes.feedPageTitle.focus({ preventScroll: true });
    }

    function setFeedTab(tab) {
      if (!["home", "discover", "notice", "mine"].includes(tab)) return;
      state.feedTab = tab;
      state.detailPostId = null;
      renderFeed();
      nodes.feedPageTitle.focus({ preventScroll: true });
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
        if (state.detailPostId === postId) state.detailPostId = null;
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
        const savedId = state.editingThreadId;
        await load("forum");
        if (savedId) state.detailThreadId = savedId;
        renderForum();
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
        if (state.detailThreadId === threadId) state.detailThreadId = null;
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
        state.detailThreadId = state.replyThreadId;
        renderForum();
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

    byId("create-feed-pivot").addEventListener("click", () => openFeed());
    byId("create-first-feed").addEventListener("click", () => openFeed());
    nodes.feedBackList.addEventListener("click", () => closeFeedDetail());
    document.querySelector(".feed-bottom-nav").addEventListener("click", (event) => {
      const button = event.target.closest("[data-feed-tab]");
      if (button) setFeedTab(button.dataset.feedTab);
    });
    nodes.feedForm.addEventListener("submit", (event) => void saveFeed(event));
    nodes.deleteFeed.addEventListener("click", () => void deleteFeed());
    nodes.generateFeed.addEventListener("click", () => void generated.run("feed"));
    nodes.stopFeedGeneration.addEventListener("click", () => void generated.stop("feed"));
    nodes.feedList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      if (button.dataset.action === "open") openFeedDetail(button.dataset.id);
      if (button.dataset.action === "like") void toggleLike(button.dataset.id);
      if (button.dataset.action === "edit") openFeed(button.dataset.id);
      if (button.dataset.action === "delete") void deleteFeed(button.dataset.id);
    });
    nodes.feedDetailLike.addEventListener("click", () => {
      if (state.detailPostId) void toggleLike(state.detailPostId);
    });
    nodes.feedDetailEdit.addEventListener("click", () => {
      if (state.detailPostId) openFeed(state.detailPostId);
    });
    nodes.feedDetailDelete.addEventListener("click", () => {
      if (state.detailPostId) void deleteFeed(state.detailPostId);
    });

    byId("create-forum-thread").addEventListener("click", () => openForum());
    byId("create-first-forum-thread").addEventListener("click", () => openForum());
    byId("forum-compose-pivot").addEventListener("click", () => openForum());
    nodes.forumBackList.addEventListener("click", () => {
      state.detailThreadId = null;
      renderForum();
      byId("forum-title").focus({ preventScroll: true });
    });
    document.querySelector(".forum-tabs").addEventListener("click", (event) => {
      const button = event.target.closest("[data-forum-tab]");
      if (!button) return;
      state.forumTab = button.dataset.forumTab;
      state.detailThreadId = null;
      renderForum();
    });
    nodes.forumDetailReply.addEventListener("click", () => {
      if (state.detailThreadId) openReply(state.detailThreadId);
    });
    nodes.forumDetailEdit.addEventListener("click", () => {
      if (state.detailThreadId) openForum(state.detailThreadId);
    });
    nodes.forumDetailDelete.addEventListener("click", () => {
      if (state.detailThreadId) void deleteForum(state.detailThreadId);
    });
    nodes.forumForm.addEventListener("submit", (event) => void saveForum(event));
    nodes.deleteForum.addEventListener("click", () => void deleteForum());
    nodes.replyForm.addEventListener("submit", (event) => void saveReply(event));
    nodes.generateForum.addEventListener("click", () => void generated.run("forum"));
    nodes.stopForumGeneration.addEventListener("click", () => void generated.stop("forum"));
    nodes.forumList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      if (button.dataset.action === "open-detail") {
        state.detailThreadId = button.dataset.id;
        renderForum();
        nodes.forumDetailTitle.focus({ preventScroll: true });
      }
      if (button.dataset.action === "reply") openReply(button.dataset.id);
      if (button.dataset.action === "edit") openForum(button.dataset.id);
      if (button.dataset.action === "delete") void deleteForum(button.dataset.id);
      if (button.dataset.action === "delete-reply") {
        const threadId = button.closest("[data-thread-id]")?.dataset.threadId;
        if (threadId) void deleteReply(threadId, button.dataset.id);
      }
    });
    nodes.forumDetailReplies.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action='delete-reply']");
      if (!button) return;
      const threadId = button.closest("[data-thread-id]")?.dataset.threadId;
      if (threadId) void deleteReply(threadId, button.dataset.id);
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
