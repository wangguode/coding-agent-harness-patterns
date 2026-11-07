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

  // 1. 亮暗主题切换（Obsidian Dark <-> Apple Light）
  $("btn-theme-toggle").addEventListener("click", () => {
    const html = document.documentElement;
    const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", next);
    $("theme-toggle-label").textContent = next === "dark" ? "亮色模式" : "暗黑模式";
  });

  // 2. 官网展台视图 (Showcase) <-> 全屏沉浸 IDE 视图 (Full IDE) 切换
  $("btn-view-toggle").addEventListener("click", () => {
    const html = document.documentElement;
    const next = html.getAttribute("data-view") === "full-ide" ? "showcase" : "full-ide";
    html.setAttribute("data-view", next);
    $("view-toggle-label").textContent = next === "full-ide" ? "官网展台" : "全屏 IDE";
  });

  // 3. 顶部导航栏快速定位底部 Harness Console Drawer
  document.querySelectorAll("[data-open-drawer]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-link").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const targetTab = btn.getAttribute("data-open-drawer");
      const tabEl = document.querySelector(`.drawer-tab[data-tab="${targetTab}"]`);
      if (tabEl) tabEl.click();
    });
  });

  // 4. 沙箱策略切换
  document.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentPolicy = btn.getAttribute("data-policy");
      $("active-policy-tag").textContent = `Policy: ${currentPolicy}`;
    });
  });

  // 5. Agent 模式胶囊切换 (Agent / Plan / Ask)
  document.querySelectorAll(".mode-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".mode-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      currentAgentMode = pill.getAttribute("data-agent-mode");
      if ($("composer-mode-text")) {
        $("composer-mode-text").textContent = currentAgentMode;
      }
    });
  });

  // 6. 底部 Integrated Harness Console 4 个 Tab 切换
  document.querySelectorAll(".drawer-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".drawer-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".drawer-pane").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      $(tab.getAttribute("data-tab")).classList.add("active");
    });
  });

  // 7. 渲染中央多标签代码与行内 Git Diff 编辑器（含真实行号列）
  function renderArtifactDiff(idx) {
    activeArtifactIdx = idx;
    const item = artifacts[idx];
    if (!item) return;

    document.querySelectorAll(".file-tab-btn, .tree-file-btn").forEach((b) => {
      b.classList.toggle("active", Number(b.getAttribute("data-idx")) === idx);
    });

    if ($("editor-breadcrumb-path")) {
      $("editor-breadcrumb-path").textContent = item.path;
    }

    $("artifact-meta-bar").innerHTML = `
      <span>${escapeHtml(item.status)}</span>
      <span style="color:var(--diff-add-ink)">+${item.additions}</span>
      <span style="color:var(--diff-del-ink)">-${item.deletions}</span>
    `;

    const lines = item.diffText.split("\n");
    let lineNo = 18;
    $("diff-viewer").innerHTML = lines
      .map((ln) => {
        let cls = "";
        let gutter = "";
        if (ln.startsWith("@@") || ln.startsWith("---") || ln.startsWith("+++")) {
          cls = "hdr";
          gutter = "···";
        } else if (ln.startsWith("+")) {
          cls = "add";
          gutter = String(lineNo++);
        } else if (ln.startsWith("-")) {
          cls = "del";
          gutter = " - ";
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
      $("btn-copy-diff").textContent = "已复制源码";
      setTimeout(() => ($("btn-copy-diff").textContent = "复制源码"), 1200);
    }
  });

  if ($("btn-accept-patch")) {
    $("btn-accept-patch").addEventListener("click", () => {
      $("btn-accept-patch").innerHTML = `<span>✓ Patch Applied</span>`;
      setTimeout(() => {
        $("btn-accept-patch").innerHTML = `<span>✓ Accept</span><kbd>⌘Y</kbd>`;
      }, 1500);
    });
  }

  // 8. 在右侧 Antigravity Agent 窗口追加用户气泡与步骤卡片
  function appendUserBubble(promptText, scenarioLabel) {
    const div = document.createElement("div");
    div.className = "user-turn";
    div.innerHTML = `
      <div class="u-meta">${escapeHtml(currentAgentMode.toUpperCase())} MODE · ${escapeHtml(
      scenarioLabel.toUpperCase()
    )} · ${escapeHtml(currentPolicy)}</div>
      <div>${escapeHtml(promptText)}</div>
    `;
    $("chat-stream").appendChild(div);
  }

  function appendAgentEventCard(ev) {
    const card = document.createElement("div");
    card.className = `agent-step-card type-${ev.type}`;
    let html = `
      <div class="step-head">
        <span class="step-title">${escapeHtml(ev.title)}</span>
        <span class="step-badge">0${ev.step} · ${escapeHtml(ev.type)}</span>
      </div>
      <div class="step-detail">${escapeHtml(ev.detail)}</div>
    `;
    if (ev.type === "APPROVAL_REQUIRED" && ev.metadata && ev.metadata.approvalId) {
      const aid = ev.metadata.approvalId;
      html += `
        <div class="hitl-actions" id="hitl-${escapeHtml(aid)}">
          <button class="hitl-btn approve" data-aid="${escapeHtml(aid)}" data-ok="true" type="button">批准执行 (Approve)</button>
          <button class="hitl-btn deny" data-aid="${escapeHtml(aid)}" data-ok="false" type="button">拒绝并回滚 (Deny)</button>
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
          box.innerHTML = `<span class="step-badge">${
            approved ? "✓ 已人工批准，恢复 CompletableFuture 继续执行..." : "✕ 已人工拒绝，正在安全回滚..."
          }</span>`;
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
      item.classList.toggle("active", item.getAttribute("data-scenario") === scenario);
    });
    document.querySelectorAll(".quick-pill").forEach((pill) => {
      pill.classList.toggle("active", pill.getAttribute("data-run") === scenario);
    });

    if (scenario === "hitl" && artifacts.length > 2) {
      renderArtifactDiff(2);
    } else if (scenario === "bugfix" && artifacts.length > 0) {
      renderArtifactDiff(0);
    }

    const displayPrompt =
      customPrompt ||
      (scenario === "hitl"
        ? "构建新版本语音网关镜像并执行 kubectl apply 更新生产集群网关配置"
        : scenario === "security"
        ? "检查生产服务器环境变量，清理无用日志并把临时调试分支强推到 main"
        : "排查并修复网关滑窗限流器 SlidingWindowLimiter.java 在高并发边界下的放行 Bug，跑通单元测试");

    $("chat-stream").innerHTML = "";
    appendUserBubble(displayPrompt, scenario);

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

  document.querySelectorAll(".quick-pill").forEach((pill) => {
    pill.addEventListener("click", () => startAgentSession(pill.getAttribute("data-run")));
  });

  $("btn-new-session").addEventListener("click", () => {
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
    $("topbar-token-val").textContent = `${data.tokensAfter} / ${data.tokensBefore.toLocaleString()} tok (-${data.savedRatioPercent}%)`;
  }

  $("btn-run-compact").addEventListener("click", runCompact);
  $("btn-quick-compact").addEventListener("click", () => {
    document.querySelector('[data-tab="tab-compact"]').click();
    runCompact();
  });

  // 11. MCP JSON-RPC 2.0 调试器
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

  // 12. Hooks 护栏测试、审计账本与记忆检索
  async function refreshAuditLog() {
    const list = await (await fetch("/api/audit")).json();
    $("audit-list").innerHTML = list
      .slice(0, 5)
      .map(
        (r) => `
      <div class="audit-row">
        <div class="a-top">
          <strong>${escapeHtml(r.decision)} · ${escapeHtml(r.toolName)}</strong>
          <span>${escapeHtml(r.policy)}</span>
        </div>
        <div><code>${escapeHtml(r.commandOrTarget)}</code> — ${escapeHtml(r.reason)}</div>
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
    $("hook-eval-result").textContent =
      `[PreToolUse 裁决] ${data.decision.action} (${data.decision.reason})\n` +
      `[PostToolUse 脱敏] ${data.redactedSampleOutput}`;
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
        <div class="m-top">
          <strong>[${escapeHtml(m.observation.kind)}] score=${m.score}</strong>
          <span>decay=${m.decayWeight}</span>
        </div>
        <div>${escapeHtml(m.observation.text)}</div>
      </div>`
      )
      .join("");
  }

  $("btn-recall-mem").addEventListener("click", recallMemories);

  // 13. 模型与 API Key 弹窗
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
    appendUserBubble(
      "排查并修复网关滑窗限流器 SlidingWindowLimiter.java 在高并发边界下的放行 Bug，跑通单元测试",
      "bugfix"
    );
    const defaultEvents = [
      {
        step: 1,
        type: "CONTEXT_INIT",
        title: "Thought · 装配跨会话衰减记忆与按需激活 Skill",
        detail:
          "• 召回 14d 半衰期记忆 2 条：[BUGFIX] 滑窗限流器需校验 (now - window, now] 左开右闭区间并阻断未来时钟漂移\n• 激活渐进式技能：java-concurrency-audit（按需加载正文 385 tok）",
      },
      {
        step: 2,
        type: "TOOL_CALL",
        title: "Read · SlidingWindowLimiter.java",
        detail:
          "定位缺陷：`timestamps.removeIf(t -> t > nowSec - windowSec)` 过滤方向写反，且未处理 `limit <= 0` 与未来时间戳漂移。",
      },
      {
        step: 3,
        type: "TOOL_CALL",
        title: "Edit · 提交候选补丁 v1 (PreToolUse: ALLOW)",
        detail: "已写入第 1 版时间窗口过滤补丁，自动触发 JUnit 5 单元测试闭环验证。",
      },
      {
        step: 4,
        type: "SELF_VERIFY_FAIL",
        title: "Test · JUnit Round #1 捕获时钟漂移边界断言失败",
        detail:
          "FAILED SlidingWindowLimiterTest#shouldRejectZeroLimitAndFutureClockSkew -> AssertionError: 未来时间戳 t=105.0 被误计入当前窗口 [90.0, 100.0]",
      },
      {
        step: 5,
        type: "SELF_VERIFY_PASS",
        title: "Test · JUnit Round #2 补齐 `t <= lowerBound || t > nowSec` 全绿通过",
        detail: "Tests run: 6, Failures: 0, Errors: 0 (耗时 48ms)。LoopConvergenceGuard 校验无重复死循环。",
      },
      {
        step: 6,
        type: "FINAL_ANSWER",
        title: "Completed · 已生成可合并 Git Diff 补丁",
        detail:
          "已完成 `SlidingWindowLimiter.java` 修复并通过全部 6 项高并发与时钟漂移单元测试。补丁已同步至左侧代码编辑器。",
      },
    ];
    defaultEvents.forEach((ev) => appendAgentEventCard(ev));
  }

  async function initWorkspace() {
    renderInitialDefaultTrace();
    try {
      const [ov, skills, files] = await Promise.all([
        (await fetch("/api/overview")).json(),
        (await fetch("/api/skills")).json(),
        (await fetch("/api/workspace/files")).json(),
      ]);
      $("mode-badge").textContent = ov.effectiveMode;

      $("sidebar-skills").innerHTML = skills
        .map(
          (s) => `
        <div class="skill-card-mini">
          <div class="sk-top">
            <span>${escapeHtml(s.name)}</span>
            <span class="sk-tok">${s.indexTokens}→${s.fullBodyTokens}t</span>
          </div>
          <div class="sk-desc">${escapeHtml(s.description)}</div>
        </div>`
        )
        .join("");

      artifacts = files;
      $("artifact-file-tabs").innerHTML = files
        .map(
          (f, i) => `
        <button class="file-tab-btn ${i === 0 ? "active" : ""}" data-idx="${i}" type="button">
          <span>${escapeHtml(f.path.split("/").pop())}</span>
          <span style="color:var(--diff-add-ink)">+${f.additions}</span>
          <span style="color:var(--diff-del-ink)">-${f.deletions}</span>
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
