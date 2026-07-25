(() => {
  "use strict";

  const root = document.documentElement;
  const status = document.getElementById("fixture-status");
  const clock = document.getElementById("clock");
  const screens = Array.from(document.querySelectorAll("[data-screen]"));
  const host = window.fantarealExtension;

  function showScreen(screenId) {
    for (const screen of screens) {
      const active = screen.dataset.screen === screenId;
      screen.hidden = !active;
      screen.classList.toggle("is-active", active);
    }
    status.textContent = screenId === "chat" ? "口袋群聊 · 静态数据" : "离线 fixture 已就绪";
  }

  function updateClock() {
    const now = new Date();
    clock.textContent = new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
  }

  for (const trigger of document.querySelectorAll("[data-open-screen]")) {
    trigger.addEventListener("click", () => showScreen(trigger.dataset.openScreen));
  }

  document.getElementById("theme-toggle").addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "paper" ? "amber" : "paper";
  });

  document.getElementById("close-extension").addEventListener("click", async () => {
    if (host && typeof host.close === "function") {
      status.textContent = "正在关闭 Extension session…";
      await host.close();
      return;
    }
    status.textContent = "浏览器预览模式：请直接关闭窗口";
  });

  updateClock();
})();
