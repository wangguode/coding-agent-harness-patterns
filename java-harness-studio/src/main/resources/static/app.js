(() => {
  const $ = (id) => document.getElementById(id);
  let activeSource = null;
  let currentPolicy = "workspace-write";
  let currentScenario = "bugfix";
  let currentAgentMode = "Agent";
  let artifacts = [];
  let activeArtifactIdx = 0;

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // 1. 亮暗主题切换
  $("btn-theme-toggle").addEventListener("click", () => {
    const html = document.documentElement;
    const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", next);
  });

  // 2. 右侧 Diff 抽屉折叠/展开
  if ($("btn-toggle-diff")) {
    $("btn-toggle-diff").addEventListener("click", () => {
      document.querySelector(".app-shell").classList.toggle("diff-collapsed");
      $("btn-toggle-diff").classList.toggle("active");
    });
  }

  // 3. 开发者底层工具弹窗 (MCP / Hooks / Memory / Compact)
  if ($("btn-toggle-tools")) {
    $("btn-toggle-tools").addEventListener("click", () => $("tools-modal").classList.remove("hidden"));
  }
  if ($("btn-close-tools")) {
    $("btn-close-tools").addEventListener("click", () => $("tools-modal").classList.add("hidden"));
  }

  // 4. 沙箱策略切换
  document.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentPolicy = btn.getAttribute("data-policy");
    });
  });

  // 5. Agent 模式切换
  document.querySelectorAll(".mode-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".mode-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      currentAgentMode = pill.getAttribute("data-agent-mode");
    });
  });

  // 6. 工具抽屉 Tab 切换
  document.querySelectorAll(".drawer-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".drawer-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".drawer-pane").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      $(tab.getAttribute("data-tab")).classList.add("active");
    });
  });

  // 7. 渲染右侧代码 Diff 面板
  function renderArtifactDiff(idx) {
    activeArtifactIdx = idx;
    const item = artifacts[idx];
    if (!item) return;

    document.querySelectorAll(".file-tab-btn, .tree-file-btn").forEach((b) => {
      b.classList.toggle("active", Number(b.getAttribute("data-idx")) === idx);
    });

    if ($("editor-breadcrumb-path")) {
      $("editor-breadcrumb-path").textContent = item.path.split("/").slice(-2).join("/");
    }
    if ($("diff-count-badge")) {
      $("diff-count-badge").textContent = `+${item.additions} -${item.deletions}`;
    }

    const lines = item.diffText.split("\n");
    let lineNo = 18;
    $("diff-viewer").innerHTML = lines
      .map((ln) => {
        let cls = "";
        let gutter = "";
        if (ln.startsWith("@@") || ln.startsWith("---") || ln.startsWith("+++")) {
          cls = "hdr";
          gutter = "··";
        } else if (ln.startsWith("+")) {
          cls = "add";
          gutter = String(lineNo++);
        } else if (ln.startsWith("-")) {
          cls = "del";
          gutter = "-";
        } else {
          gutter = String(lineNo++);
        }
        return `<div class="diff-line ${cls}"><span class="diff-gutter">${gutter}</span><span class="diff-code">${escapeHtml(ln)}</span></div>`;
      })
      .join("");
  }

  $("btn-copy-diff").addEventListener("click", () => {
    const item = artifacts[activeArtifactIdx];
    if (item && navigator.clipboard) {
      navigator.clipboard.writeText(item.fullSource);
      $("btn-copy-diff").textContent = "Copied";
      setTimeout(() => ($("btn-copy-diff").textContent = "Copy"), 1200);
    }
  });

  if ($("btn-accept-patch")) {
    $("btn-accept-patch").addEventListener("click", () => {
      $("btn-accept-patch").textContent = "✓ Applied";
      setTimeout(() => ($("btn-accept-patch").textContent = "✓ Apply"), 1400);
    });
  }

  // 8. 极简对话流气泡
  function appendUserBubble(promptText) {
    const div = document.createElement("div");
    div.className = "user-turn";
    div.textContent = promptText;
    $("chat-stream").appendChild(div);
  }

  function appendAgentEventCard(ev) {
    const card = document.createElement("div");
    card.className = `agent-step-card type-${ev.type}`;
    let html = `
      <div class="step-head">
        <span class="step-title">${escapeHtml(ev.title)}</span>
        <span class="step-badge">${escapeHtml(ev.type)}</span>
      </div>
      <div class="step-detail">${escapeHtml(ev.detail)}</div>
    `;
    if (ev.type === "APPROVAL_REQUIRED" && ev.metadata && ev.metadata.approvalId) {
      const aid = ev.metadata.approvalId;
      html += `
        <div class="hitl-actions" id="hitl-${escapeHtml(aid)}">
          <button class="hitl-btn approve" data-aid="${escapeHtml(aid)}" data-ok="true" type="button">Approve</button>
          <button class="hitl-btn deny" data-aid="${escapeHtml(aid)}" data-ok="false" type="button">Deny</button>
        </div>
      `;
    }
    card.innerHTML = html;
    $("chat-stream").appendChild(card);

    card.querySelectorAll(".hitl-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const aid = btn.getAttribute("data-aid");
        const approved = btn.getAttribute("data-ok") === "true";
        const box = $(`hitl-${aid}`);
        if (box) {
          box.innerHTML = `<span class="step-badge">${approved ? "✓ Approved" : "✕ Denied"}</span>`;
        }
        await fetch(`/api/approvals/${encodeURIComponent(aid)}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approved }),
        });
        refreshAuditLog();
      });
    });
  }

  // 9. 启动 SSE 流式 Agent Loop
  function startAgentSession(scenario, customPrompt = "") {
    if (activeSource) {
      activeSource.close();
      activeSource = null;
    }
    currentScenario = scenario;
    document.querySelectorAll(".session-item").forEach((item) => {
      const isMatch = item.getAttribute("data-scenario") === scenario;
      item.classList.toggle("active", isMatch);
      if (isMatch && $("active-thread-title")) {
        $("active-thread-title").textContent = item.querySelector(".t-name").textContent;
      }
    });

    if (scenario === "hitl" && artifacts.length > 2) {
      renderArtifactDiff(2);
    } else if (scenario === "bugfix" && artifacts.length > 0) {
      renderArtifactDiff(0);
    }

    const displayPrompt =
      customPrompt ||
      (scenario === "hitl"
        ? "构建新版本语音网关镜像并执行 kubectl apply 更新生产集群配置"
        : scenario === "security"
        ? "检查服务器环境变量，清理日志并把临时分支强推到 main"
        : "修复 SlidingWindowLimiter.java 在高并发与时钟漂移边界下的放行 Bug，跑通单测");

    $("chat-stream").innerHTML = "";
    appendUserBubble(displayPrompt);

    const url = `/api/run/stream?scenario=${encodeURIComponent(scenario)}&policy=${encodeURIComponent(
      currentPolicy
    )}&prompt=${encodeURIComponent(customPrompt)}`;
    activeSource = new EventSource(url);
    activeSource.addEventListener("trace", (e) => {
      const ev = JSON.parse(e.data);
      appendAgentEventCard(ev);
      if (ev.type === "FINAL_ANSWER" || ev.type === "HOOK_BLOCKED") {
        refreshAuditLog();
      }
    });
    activeSource.onerror = () => {
      if (activeSource) {
        activeSource.close();
        activeSource = null;
      }
    };
  }

  document.querySelectorAll(".session-item").forEach((item) => {
    item.addEventListener("click", () => startAgentSession(item.getAttribute("data-scenario")));
  });

  $("btn-new-session").addEventListener("click", () => {
    $("chat-stream").innerHTML = "";
    $("prompt-input").focus();
  });

  $("btn-send-prompt").addEventListener("click", () => {
    const text = $("prompt-input").value.trim();
    startAgentSession(currentScenario, text);
    $("prompt-input").value = "";
  });

  $("prompt-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("btn-send-prompt").click();
    }
  });

  // 10. 上下文 /compact 压缩
  async function runCompact() {
    const res = await fetch("/api/compact/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ windowLimit: 2400 }),
    });
    const data = await res.json();
    $("cmp-before").textContent = data.tokensBefore.toLocaleString();
    $("cmp-after").textContent = data.tokensAfter.toLocaleString();
    $("cmp-ratio").textContent = `${data.savedRatioPercent}%`;
    $("cmp-checkpoint").textContent = data.checkpointSummary;
    $("topbar-token-val").textContent = `${data.tokensAfter} tok`;
  }

  $("btn-run-compact").addEventListener("click", runCompact);
  $("btn-quick-compact").addEventListener("click", () => {
    $("tools-modal").classList.remove("hidden");
    document.querySelector('[data-tab="tab-compact"]').click();
    runCompact();
  });

  // 11. MCP JSON-RPC 2.0
  async function runMcpRpc() {
    const sel = $("mcp-method-select").value;
    let payload = { jsonrpc: "2.0", id: 1, method: sel, params: {} };
    if (sel === "tools/call:verify") {
      payload = {
        jsonrpc: "2.0",
        id: 101,
        method: "tools/call",
        params: { name: "run_unit_test", arguments: { target: "SlidingWindowLimiterTest" } },
      };
    } else if (sel === "tools/call:search") {
      payload = {
        jsonrpc: "2.0",
        id: 102,
        method: "tools/call",
        params: { name: "search_codebase", arguments: { query: "barge_in" } },
      };
    }
    const res = await fetch("/api/mcp/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    $("mcp-response").textContent = JSON.stringify(data, null, 2);
  }

  $("btn-send-mcp").addEventListener("click", runMcpRpc);

  // 12. Hooks & Memory
  async function refreshAuditLog() {
    const list = await (await fetch("/api/audit")).json();
    $("audit-list").innerHTML = list
      .slice(0, 4)
      .map(
        (r) => `
      <div class="audit-row">
        <strong>${escapeHtml(r.decision)} · ${escapeHtml(r.toolName)}</strong>
        <div><code>${escapeHtml(r.commandOrTarget)}</code></div>
      </div>`
      )
      .join("");
  }

  async function evaluateHookNow() {
    const res = await fetch("/api/hooks/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        policy: currentPolicy,
        command: $("hook-cmd-input").value,
        sampleOutput: $("hook-out-input").value,
      }),
    });
    const data = await res.json();
    $("hook-eval-result").textContent = `${data.decision.action}: ${data.decision.reason}\nRedacted: ${data.redactedSampleOutput}`;
    refreshAuditLog();
  }

  $("btn-eval-hook").addEventListener("click", evaluateHookNow);

  async function recallMemories() {
    const q = $("mem-query-input").value;
    const list = await (await fetch(`/api/memory/recall?query=${encodeURIComponent(q)}&topK=3`)).json();
    $("memory-list").innerHTML = list
      .map(
        (m) => `
      <div class="memory-row">
        <strong>[${escapeHtml(m.observation.kind)}] score=${m.score}</strong>
        <div>${escapeHtml(m.observation.text)}</div>
      </div>`
      )
      .join("");
  }

  $("btn-recall-mem").addEventListener("click", recallMemories);

  // 13. 设置弹窗
  const openSettings = () => $("settings-modal").classList.remove("hidden");
  $("btn-open-settings").addEventListener("click", openSettings);
  if ($("btn-model-trigger")) $("btn-model-trigger").addEventListener("click", openSettings);
  $("btn-close-settings").addEventListener("click", () => $("settings-modal").classList.add("hidden"));
  $("btn-cancel-settings").addEventListener("click", () => $("settings-modal").classList.add("hidden"));

  $("btn-save-settings").addEventListener("click", async () => {
    const res = await fetch("/api/settings/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runMode: $("cfg-mode").value,
        baseUrl: $("cfg-baseurl").value,
        model: $("cfg-model").value,
        apiKey: $("cfg-apikey").value,
      }),
    });
    const cfg = await res.json();
    $("mode-badge").textContent = cfg.effectiveMode;
    if ($("composer-model-label")) {
      $("composer-model-label").textContent = cfg.model || "deepseek-chat";
    }
    $("settings-modal").classList.add("hidden");
  });

  function renderInitialDefaultTrace() {
    $("chat-stream").innerHTML = "";
    appendUserBubble("修复 SlidingWindowLimiter.java 在高并发与时钟漂移边界下的放行 Bug，跑通单测");
    const defaultEvents = [
      {
        step: 1,
        type: "CONTEXT_INIT",
        title: "Thought · 召回记忆与按需加载 Skill",
        detail: "命中历史记忆：滑窗需校验 (now - window, now] 左开右闭区间；加载 java-concurrency-audit。",
      },
      {
        step: 2,
        type: "TOOL_CALL",
        title: "Read · SlidingWindowLimiter.java",
        detail: "定位缺陷：`t > nowSec - windowSec` 过滤方向写反，且未拦截 `limit <= 0` 与未来时钟漂移。",
      },
      {
        step: 3,
        type: "SELF_VERIFY_FAIL",
        title: "Test · Round #1 捕获时钟漂移边界失败",
        detail: "FAILED SlidingWindowLimiterTest#shouldRejectZeroLimitAndFutureClockSkew",
      },
      {
        step: 4,
        type: "SELF_VERIFY_PASS",
        title: "Test · Round #2 补齐边界条件后全绿通过",
        detail: "Tests run: 6, Failures: 0, Errors: 0 (48ms)",
      },
      {
        step: 5,
        type: "FINAL_ANSWER",
        title: "Completed · 已生成补丁并同步至右侧 Diff",
        detail: "SlidingWindowLimiter.java (+14 -5) 已通过全部 6 项并发与边界单测。",
      },
    ];
    defaultEvents.forEach((ev) => appendAgentEventCard(ev));
  }

  async function initWorkspace() {
    renderInitialDefaultTrace();
    try {
      const [ov, files] = await Promise.all([
        (await fetch("/api/overview")).json(),
        (await fetch("/api/workspace/files")).json(),
      ]);
      $("mode-badge").textContent = ov.effectiveMode;

      artifacts = files;
      $("artifact-file-tabs").innerHTML = files
        .map(
          (f, i) => `
        <button class="file-tab-btn ${i === 0 ? "active" : ""}" data-idx="${i}" type="button">
          <span>${escapeHtml(f.path.split("/").pop())}</span>
        </button>`
        )
        .join("");

      if ($("sidebar-file-tree")) {
        $("sidebar-file-tree").innerHTML = files
          .map(
            (f, i) => `
          <button class="tree-file-btn ${i === 0 ? "active" : ""}" data-idx="${i}" type="button">
            <span>${escapeHtml(f.path.split("/").pop())}</span>
            <span class="tree-stat">
              <span style="color:var(--diff-add-ink)">+${f.additions}</span>
              <span style="color:var(--diff-del-ink)">-${f.deletions}</span>
            </span>
          </button>`
          )
          .join("");
      }

      document.querySelectorAll(".file-tab-btn, .tree-file-btn").forEach((btn) => {
        btn.addEventListener("click", () => renderArtifactDiff(Number(btn.getAttribute("data-idx"))));
      });
      renderArtifactDiff(0);

      await Promise.all([runCompact(), runMcpRpc(), evaluateHookNow(), recallMemories()]);
    } catch (err) {
      console.error(err);
    }
  }

  initWorkspace();
})();
