(() => {
  let currentScenario = "bugfix";
  let activeSource = null;

  const $ = (id) => document.getElementById(id);

  // 主题切换
  $("theme-toggle").addEventListener("click", () => {
    const html = document.documentElement;
    const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", next);
    $("theme-toggle").textContent = next === "dark" ? "亮色模式" : "暗色模式";
  });

  // 顶部概览与审计刷新
  async function refreshOverview() {
    try {
      const res = await fetch("/api/overview");
      const data = await res.json();
      $("runtime-mode").textContent = `引擎: ${data.effectiveMode}`;
      $("jdk-badge").textContent = `Java ${data.javaVersion}`;
      $("metric-skills").textContent = data.skillsCount;
      $("metric-audits").textContent = data.auditCount;
    } catch (e) {
      $("runtime-mode").textContent = "引擎离线";
    }
  }

  async function refreshAudit() {
    const res = await fetch("/api/audit");
    const list = await res.json();
    $("metric-audits").textContent = list.length;
    if (!list.length) return;
    $("audit-list").innerHTML = list
      .slice(0, 8)
      .map(
        (r) =>
          `<div class="audit-row"><strong>[${r.decision}]</strong> ${escapeHtml(r.toolName)} · <code>${escapeHtml(
            r.commandOrTarget
          )}</code><br><span style="color:var(--text-soft)">策略=${r.policy} | ${escapeHtml(r.reason)}</span></div>`
      )
      .join("");
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // 导航切换
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      $(btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "tab-compact") runCompactionSim();
      if (btn.dataset.tab === "tab-memory") runMemoryRecall();
    });
  });

  // 场景选择
  document.querySelectorAll(".scenario-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".scenario-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      currentScenario = card.dataset.scenario;
    });
  });

  // 启动 SSE 实时 Agent Loop
  function startAgentRun() {
    if (activeSource) {
      activeSource.close();
      activeSource = null;
    }
    const policy = $("policy-select").value;
    const prompt = $("task-input").value.trim();
    $("trace-container").innerHTML = "";
    $("run-status-label").textContent = "RUNNING STREAM...";
    let stepCount = 0;

    const url = `/api/run/stream?scenario=${encodeURIComponent(currentScenario)}&policy=${encodeURIComponent(
      policy
    )}&prompt=${encodeURIComponent(prompt)}`;
    const es = new EventSource(url);
    activeSource = es;

    es.addEventListener("trace", (ev) => {
      const item = JSON.parse(ev.data);
      stepCount = item.step;
      $("metric-steps").textContent = stepCount;

      const div = document.createElement("div");
      div.className = `trace-item type-${item.type}`;
      let hitlHtml = "";
      if (item.type === "APPROVAL_REQUIRED" && item.metadata && item.metadata.approvalId) {
        const aid = item.metadata.approvalId;
        hitlHtml = `
          <div class="hitl-actions" id="hitl-${aid}">
            <button type="button" class="btn btn-ok" onclick="window.__decideHitl('${aid}', true)">批准执行 (Approve)</button>
            <button type="button" class="btn btn-danger" onclick="window.__decideHitl('${aid}', false)">拒绝变更 (Reject)</button>
          </div>`;
      }
      div.innerHTML = `
        <div class="trace-top">
          <span class="trace-title">Step #${item.step} · ${escapeHtml(item.title)}</span>
          <span class="trace-badge">${escapeHtml(item.type)}</span>
        </div>
        <div class="trace-detail">${escapeHtml(item.detail)}</div>
        ${hitlHtml}
      `;
      $("trace-container").appendChild(div);
      refreshAudit();

      if (item.type === "FINAL_ANSWER" || item.type === "HOOK_BLOCKED" || item.type === "ERROR") {
        $("run-status-label").textContent = "COMPLETED";
        es.close();
      }
    });

    es.onerror = () => {
      $("run-status-label").textContent = "IDLE";
      es.close();
      refreshAudit();
    };
  }

  window.__decideHitl = async (approvalId, approved) => {
    const box = $(`hitl-${approvalId}`);
    if (box) box.innerHTML = `<span class="panel-meta">已提交人工裁决: ${approved ? "批准" : "拒绝"}...</span>`;
    await fetch(`/api/approvals/${approvalId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved }),
    });
  };

  $("btn-start-run").addEventListener("click", startAgentRun);

  // Tab 2: Compaction + Skills
  async function runCompactionSim() {
    const windowLimit = Number($("window-input").value || 2400);
    const res = await fetch("/api/compact/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ windowLimit }),
    });
    const rep = await res.json();
    $("cmp-before").textContent = rep.beforeTokens;
    $("cmp-after").textContent = rep.afterTokens;
    $("cmp-saved").textContent = `${rep.savedPercent}%`;
    const pct = Math.min(100, Math.round((rep.afterTokens / rep.windowLimit) * 100));
    $("cmp-bar").style.width = `${pct}%`;
    $("cmp-messages").innerHTML = rep.compactedMessages
      .map(
        (m) => `
      <div class="trace-item">
        <div class="trace-top">
          <span class="trace-title">Role: ${escapeHtml(m.role)}</span>
          <span class="trace-badge">≈ ${m.estimatedTokens} tokens</span>
        </div>
        <div class="trace-detail">${escapeHtml(m.content)}</div>
      </div>`
      )
      .join("");

    const sRes = await fetch("/api/skills");
    const skills = await sRes.json();
    $("skills-list").innerHTML = skills
      .map(
        (s) => `
      <div class="trace-item">
        <div class="trace-top">
          <span class="trace-title">${escapeHtml(s.name)}</span>
          <span class="trace-badge">索引 ${s.indexTokens}t / 正文 ${s.fullBodyTokens}t</span>
        </div>
        <div class="trace-detail">${escapeHtml(s.description)}\n---\n${escapeHtml(s.instructionsBody)}</div>
      </div>`
      )
      .join("");
  }

  $("btn-run-compact").addEventListener("click", runCompactionSim);

  // Tab 3: Hooks + MCP
  $("btn-eval-hook").addEventListener("click", async () => {
    const res = await fetch("/api/hooks/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        policy: $("policy-select").value,
        command: $("hook-cmd-input").value,
        sampleOutput: $("hook-out-input").value,
      }),
    });
    const data = await res.json();
    $("hook-result").textContent = JSON.stringify(data, null, 2);
    refreshAudit();
  });

  document.querySelectorAll(".mcp-preset").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const method = btn.dataset.method;
      const payload =
        method === "tools/call"
          ? {
              jsonrpc: "2.0",
              id: Date.now(),
              method: "tools/call",
              params: { name: "diagnose_voice_latency", arguments: { asrMs: 75, llmTtftMs: 240, ttsTtfbMs: 78 } },
            }
          : { jsonrpc: "2.0", id: Date.now(), method, params: {} };
      const res = await fetch("/api/mcp/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = await res.json();
      $("mcp-output").textContent = "// Request:\n" + JSON.stringify(payload, null, 2) + "\n\n// Response:\n" + JSON.stringify(out, null, 2);
    });
  });

  // Tab 4: Decay Memory
  async function runMemoryRecall() {
    const q = $("mem-query").value.trim();
    const res = await fetch(`/api/memory/recall?query=${encodeURIComponent(q)}&topK=5`);
    const items = await res.json();
    $("mem-results").innerHTML = items
      .map(
        (m) => `
      <div class="trace-item">
        <div class="trace-top">
          <span class="trace-title">[${escapeHtml(m.observation.kind)}] ${escapeHtml(m.observation.id)}</span>
          <span class="trace-badge">综合得分 ${m.score} (相关度 ${m.relevance} × 衰减 ${m.decayFactor})</span>
        </div>
        <div class="trace-detail">${escapeHtml(m.observation.text)}</div>
      </div>`
      )
      .join("");
  }

  $("btn-recall-mem").addEventListener("click", runMemoryRecall);
  $("btn-add-mem").addEventListener("click", async () => {
    await fetch("/api/memory/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: $("mem-kind").value,
        text: $("mem-text").value,
        importance: 0.9,
      }),
    });
    runMemoryRecall();
  });

  // 页面加载后默认自动跑一次 Scenario 01，让用户打开即看到鲜活的完整自验证闭环轨迹！
  refreshOverview().then(() => startAgentRun());
})();
