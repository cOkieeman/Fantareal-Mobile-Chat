(() => {
  "use strict";

  const INTERVALS = [
    [300, "5 分钟"],
    [900, "15 分钟"],
    [3600, "1 小时"],
    [21600, "6 小时"],
    [43200, "12 小时"],
    [86400, "1 天"],
  ];

  function createController(dependencies) {
    const {
      host,
      invokeService,
      setNotice,
      errorMessage,
      isContextFailure,
      syncContext,
    } = dependencies;
    const byId = (id) => document.getElementById(id);
    const nodes = {
      count: byId("background-job-count"),
      summary: byId("background-job-summary"),
      list: byId("background-job-list"),
      refresh: byId("refresh-background-jobs"),
      pauseAll: byId("pause-all-background-jobs"),
      resumeAll: byId("resume-all-background-jobs"),
    };
    const state = {
      context: null,
      activeCharacter: null,
      catalog: [],
      jobs: [],
      activeJobId: "",
      queueLength: 0,
      loading: false,
      visible: false,
      pollTimer: 0,
    };

    function sameBinding(binding) {
      return Boolean(
        state.context
        && binding
        && binding.cardUid === state.context.cardUid
        && binding.contextRevision === state.context.contextRevision
        && binding.sessionId === state.context.sessionId,
      );
    }

    function hostMethod(name) {
      const method = host?.[name];
      if (typeof method !== "function") {
        const error = new Error("当前 Fantareal Host 不支持受管后台任务");
        error.code = "background_jobs_unavailable";
        throw error;
      }
      return method.bind(host);
    }

    function jobFor(spec) {
      return state.jobs.find((job) => job.id === spec.jobId) || null;
    }

    function intervalFor(spec, job) {
      const configured = Number(job?.intervalSeconds);
      return INTERVALS.some(([seconds]) => seconds === configured)
        ? configured
        : spec.defaultIntervalSeconds;
    }

    function formatTime(value) {
      const date = new Date(value);
      if (!value || Number.isNaN(date.getTime())) return "尚未运行";
      return new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
    }

    function statusText(job, bound) {
      if (!job) return "未登记 · 默认关闭";
      if (!bound) return "角色已切换 · 需重新启用";
      if (state.activeJobId === job.id) return "正在执行";
      const labels = {
        paused: "已暂停",
        queued: "排队中",
        running: "正在执行",
        success: "上次成功",
        error: "上次失败",
        cancelled: "已取消",
        interrupted: "上次被 Host 退出中断",
        context_stale: "角色 Context 已变化",
      };
      return labels[job.lastStatus] || "等待调度";
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

    function render() {
      nodes.list.replaceChildren();
      nodes.count.textContent = state.context
        ? `${state.catalog.length} 项 · 队列 ${state.queueLength}`
        : "等待角色 Context";
      nodes.summary.textContent = state.activeJobId
        ? `Host 正在执行 ${state.activeJobId}；关闭小手机窗口不会取消它。`
        : "所有自动活动默认关闭，只在 Fantareal Host 运行期间执行。";

      for (const spec of state.catalog) {
        const job = jobFor(spec);
        const bound = sameBinding(job?.binding);
        const interval = intervalFor(spec, job);
        const item = document.createElement("li");
        item.className = "background-job-card";
        if (job?.enabled && bound) item.dataset.enabled = "true";

        const heading = document.createElement("div");
        heading.className = "background-job-heading";
        const copy = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = spec.title;
        const description = document.createElement("p");
        description.textContent = spec.description;
        copy.append(title, description);

        const toggle = makeButton(
          job?.enabled && bound ? "暂停" : "启用",
          () => toggleJob(spec, interval),
          job?.enabled && bound ? "danger" : "primary",
        );
        toggle.setAttribute(
          "aria-label",
          `${job?.enabled && bound ? "暂停" : "启用"}${spec.title}自动活动`,
        );
        heading.append(copy, toggle);

        const controls = document.createElement("div");
        controls.className = "background-job-controls";
        const intervalLabel = document.createElement("label");
        intervalLabel.textContent = "间隔";
        const select = document.createElement("select");
        select.setAttribute("aria-label", `${spec.title}运行间隔`);
        for (const [seconds, label] of INTERVALS) {
          const option = document.createElement("option");
          option.value = String(seconds);
          option.textContent = label;
          option.selected = seconds === interval;
          select.append(option);
        }
        select.disabled = state.loading || !state.context;
        select.addEventListener("change", () => {
          void updateInterval(spec, Number(select.value));
        });
        intervalLabel.append(select);
        controls.append(
          intervalLabel,
          makeButton("立即运行", () => runNow(spec, Number(select.value))),
        );
        if (state.activeJobId === spec.jobId) {
          controls.append(makeButton("取消本次", () => cancelJob(spec), "danger"));
        }
        if (job) {
          controls.append(makeButton("移除", () => removeJob(spec)));
        }

        const meta = document.createElement("div");
        meta.className = "background-job-meta";
        const status = document.createElement("span");
        status.textContent = statusText(job, bound);
        const lastRun = document.createElement("span");
        lastRun.textContent = `最近：${formatTime(job?.lastRunAt)}`;
        meta.append(status, lastRun);
        if (job?.lastError) {
          const error = document.createElement("small");
          error.textContent = job.lastError;
          meta.append(error);
        }
        item.append(heading, controls, meta);
        nodes.list.append(item);
      }

      const disabled = state.loading || !state.context;
      nodes.refresh.disabled = disabled;
      nodes.pauseAll.disabled = disabled || state.jobs.length === 0;
      nodes.resumeAll.disabled = disabled || state.catalog.length === 0;
    }

    function schedulePoll() {
      window.clearTimeout(state.pollTimer);
      if (!state.visible || !state.context) return;
      state.pollTimer = window.setTimeout(() => void refresh({ quiet: true }), 5000);
    }

    async function refresh({ quiet = false } = {}) {
      if (!state.context || state.loading) return;
      state.loading = true;
      render();
      try {
        if (state.catalog.length === 0) {
          const result = await invokeService("mobile.background.catalog");
          state.catalog = Array.isArray(result.jobs) ? result.jobs : [];
        }
        const result = await hostMethod("listBackgroundJobs")();
        state.jobs = Array.isArray(result.jobs) ? result.jobs : [];
        state.activeJobId = String(result.activeJobId || "");
        state.queueLength = Number(result.queueLength) || 0;
        if (!quiet) setNotice("已刷新受管后台任务。", "success");
      } catch (error) {
        setNotice(errorMessage(error), "error");
        if (isContextFailure(error)) await syncContext();
      } finally {
        state.loading = false;
        render();
        schedulePoll();
      }
    }

    function definition(spec, intervalSeconds) {
      return {
        id: spec.jobId,
        title: spec.title,
        handler: "mobile.background.prepare",
        intervalSeconds,
        params: {
          purpose: spec.purpose,
          context: { ...state.context },
          activeCharacter: { ...state.activeCharacter },
        },
        binding: { ...state.context },
      };
    }

    async function upsert(spec, intervalSeconds) {
      return hostMethod("upsertBackgroundJob")(definition(spec, intervalSeconds));
    }

    async function perform(action, successMessage) {
      if (state.loading) return;
      state.loading = true;
      render();
      try {
        await action();
        setNotice(successMessage, "success");
      } catch (error) {
        setNotice(errorMessage(error), "error");
        if (isContextFailure(error)) await syncContext();
      } finally {
        state.loading = false;
        await refresh({ quiet: true });
      }
    }

    async function toggleJob(spec, intervalSeconds) {
      const current = jobFor(spec);
      if (current?.enabled && sameBinding(current.binding)) {
        await perform(
          () => hostMethod("pauseBackgroundJob")(spec.jobId),
          `已暂停${spec.title}。`,
        );
        return;
      }
      await perform(async () => {
        await upsert(spec, intervalSeconds);
        await hostMethod("resumeBackgroundJob")(spec.jobId);
      }, `已启用${spec.title}。`);
    }

    async function updateInterval(spec, intervalSeconds) {
      await perform(
        () => upsert(spec, intervalSeconds),
        `已更新${spec.title}的运行间隔。`,
      );
    }

    async function runNow(spec, intervalSeconds) {
      await perform(async () => {
        await upsert(spec, intervalSeconds);
        await hostMethod("runBackgroundJobNow")(spec.jobId);
      }, `${spec.title}已进入 Host 队列。`);
    }

    async function cancelJob(spec) {
      await perform(
        () => hostMethod("cancelBackgroundJob")(spec.jobId),
        `已取消${spec.title}本次执行。`,
      );
    }

    async function removeJob(spec) {
      await perform(
        () => hostMethod("removeBackgroundJob")(spec.jobId),
        `已移除${spec.title}任务定义。`,
      );
    }

    async function pauseAll() {
      await perform(
        () => hostMethod("pauseAllBackgroundJobs")(),
        "已暂停全部自动活动。",
      );
    }

    async function resumeAll() {
      await perform(async () => {
        for (const spec of state.catalog) {
          const job = jobFor(spec);
          await upsert(spec, intervalFor(spec, job));
        }
        await hostMethod("resumeAllBackgroundJobs")();
      }, "已为当前角色启用全部自动活动。");
    }

    async function bindContext(context, activeCharacter) {
      const changed = !window.MobileChatGeneratedApp.sameContext(state.context, context);
      state.context = context ? { ...context } : null;
      state.activeCharacter = activeCharacter ? { ...activeCharacter } : null;
      if (changed) {
        state.jobs = [];
        state.activeJobId = "";
        state.queueLength = 0;
      }
      if (state.context) await refresh({ quiet: true });
      else render();
    }

    nodes.refresh.addEventListener("click", () => void refresh());
    nodes.pauseAll.addEventListener("click", () => void pauseAll());
    nodes.resumeAll.addEventListener("click", () => void resumeAll());

    render();
    return {
      bindContext,
      renderGeneration() {
        render();
      },
      open(screenId) {
        state.visible = screenId === "background";
        if (state.visible) void refresh({ quiet: true });
        else window.clearTimeout(state.pollTimer);
      },
    };
  }

  window.MobileChatBackgroundJobs = Object.freeze({ createController });
})();
