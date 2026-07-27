(() => {
  "use strict";

  function sameContext(left, right) {
    return Boolean(
      left
      && right
      && left.cardUid === right.cardUid
      && left.contextRevision === right.contextRevision
      && left.sessionId === right.sessionId,
    );
  }

  function createRunner(dependencies) {
    const {
      invokeService,
      setNotice,
      errorMessage,
      errorCode,
      isContextFailure,
      syncContext,
      generation,
      getContext,
      canStart,
      onCommitted,
      successMessage,
      focusAfterCommit,
    } = dependencies;

    async function run(purpose, options = {}) {
      const context = getContext();
      if (!context || (canStart && !canStart())) return;
      const owner = `light:${options.owner || purpose}`;
      const servicePrefix = options.servicePrefix || `mobile.${purpose}`;
      if (!generation.begin(owner)) {
        setNotice("已有模型生成任务正在进行。");
        return;
      }

      const bound = { ...context };
      let operationId = null;
      let resyncAfter = false;
      try {
        const prepared = await invokeService(`${servicePrefix}.generate.prepare`, {
          context: bound,
          ...(options.prepareParams || {}),
        });
        operationId = prepared.operationId;
        const generated = await generation.generate(prepared.request);
        const committed = await invokeService(`${servicePrefix}.generate.commit`, {
          context: bound,
          operationId,
          content: generated.content,
        });
        if (sameContext(getContext(), bound)) {
          await (options.onCommitted || onCommitted)(purpose, committed);
          setNotice(
            options.successMessage || successMessage(purpose, committed),
            "success",
          );
          (options.focusAfterCommit || focusAfterCommit)(purpose, committed);
        }
      } catch (error) {
        const reason = generation.isCancelled(owner) || errorCode(error) === "llm_cancelled"
          ? "cancelled"
          : errorCode(error) === "llm_timeout"
            ? "timeout"
            : "error";
        if (operationId) {
          try {
            await invokeService(`${servicePrefix}.generate.abort`, {
              context: bound,
              operationId,
              reason,
            });
          } catch (abortError) {
            if (!isContextFailure(abortError)) {
              setNotice(`生成失败，且无法结束生成事务：${errorMessage(abortError)}`, "error");
            }
          }
        }
        if (sameContext(getContext(), bound)) {
          setNotice(errorMessage(error), reason === "cancelled" ? "neutral" : "error");
        }
        resyncAfter = isContextFailure(error);
      } finally {
        generation.finish(owner);
        if (resyncAfter) await syncContext();
      }
    }

    async function stop(purpose) {
      const owner = `light:${purpose}`;
      if (!generation.requestCancel(owner)) return;
      try {
        await generation.cancel();
      } catch (error) {
        generation.restore(owner);
        setNotice(`停止生成失败：${errorMessage(error)}`, "error");
      }
    }

    return Object.freeze({ run, stop });
  }

  window.MobileChatGeneratedApp = Object.freeze({ createRunner, sameContext });
})();
