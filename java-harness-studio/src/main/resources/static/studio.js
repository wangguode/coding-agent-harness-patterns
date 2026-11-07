(function () {
  const state = {
    activeTab: 'chat',
    scenario: 'bugfix',
    policy: 'workspace-write',
    osPlatform: 'macos',
    workspaceRoot: '/tmp/build-cahp',
    files: [],
    selectedFileIndex: 0,
    codeViewMode: 'diff',
    builtInTools: [],
    mcpServers: [],
    skills: [],
    selectedSkillName: null,
    activeApprovalId: null,
    sse: null,
  };

  const SCENARIO_PRESETS = {
    bugfix: {
      title: '修复滑窗限流器 Off-by-One 边界',
      prompt: '请排查 src/gateway/rate_limiter.py 在高并发压测下偶发多放行 1 个请求的 Off-by-One 边界 Bug，自动修复并运行 pytest 验证。',
    },
    sql_audit: {
      title: '拦截高危 SQL 与只读影子库审查',
      prompt: '请清理过期灰度数据，尝试执行 DROP TABLE prod_orders CASCADE 或给出安全的归档方案。',
    },
    prod_deploy: {
      title: '生产网关 K8s 滚动发布 (HITL)',
      prompt: '请对生产环境 wg-voice-gateway 集群执行滚动重启发布并校验 /healthz 探针。',
    },
    compaction: {
      title: '长程重构 85% 阈值自动压缩',
      prompt: '模拟 30 轮跨模块重构达到 85% 上下文水位，触发结构化摘要压缩并验证锚点零丢失。',
    },
  };

  const RPC_PRESETS = {
    list: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    voice: {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'diagnose_voice_latency', arguments: { asrMs: 75, llmTtftMs: 215, ttsTtfbMs: 82 } },
    },
    loop: {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'check_loop_convergence', arguments: { toolName: 'bash', repeatCount: 3 } },
    },
    sql: {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'explain_sql_query', arguments: { sql: 'SELECT * FROM gateway_orders WHERE tenant_id = 88 AND status = 1' } },
    },
  };

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function switchTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll('.pill-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.workspace-view').forEach((sec) => {
      sec.classList.toggle('active', sec.id === 'view-' + tabId);
    });
  }

  // ==================== 1. 加载全局概览与Tools/MCP/Skills ====================
  async function loadAllCapabilities() {
    try {
      const [overviewRes, toolsRes, serversRes, skillsRes] = await Promise.all([
        fetch('/api/overview'),
        fetch('/api/mcp/tools'),
        fetch('/api/mcp/servers'),
        fetch('/api/skills'),
      ]);
      const overview = await overviewRes.json();
      state.builtInTools = await toolsRes.json();
      state.mcpServers = await serversRes.json();
      state.skills = await skillsRes.json();

      if (overview.effectiveMode) {
        el('effectiveModeBadge').textContent = overview.effectiveMode;
      }
      if (overview.llmConfig) {
        el('llmRunMode').value = overview.llmConfig.runMode || 'mock';
        el('llmBaseUrl').value = overview.llmConfig.baseUrl || 'https://api.deepseek.com/v1';
        el('llmModel').value = overview.llmConfig.model || 'deepseek-chat';
      }

      renderCapabilityBadgesAndStrips();
      renderBuiltInTools();
      renderMcpServers();
      renderSkillsWorkbench();
    } catch (e) {
      console.error('Failed to load capabilities:', e);
    }
  }

  function renderCapabilityBadgesAndStrips() {
    const enabledBuiltIn = state.builtInTools.filter((t) => t.enabled);
    const enabledMcp = state.mcpServers.filter((s) => s.enabled);
    const enabledSkills = state.skills.filter((s) => s.enabled);
    const totalToolsCount = enabledBuiltIn.length + enabledMcp.length;

    el('sidebarToolsBadge').textContent = totalToolsCount + ' Active';
    el('tabMcpCount').textContent = String(totalToolsCount);
    el('sidebarSkillsBadge').textContent = enabledSkills.length + ' Loaded';
    el('tabSkillsCount').textContent = String(enabledSkills.length);

    // Chat 顶部挂载条
    const toolsHtml = [
      ...enabledBuiltIn.map((t) => `<span class="cap-mini-pill">${escapeHtml(t.name)}</span>`),
      ...enabledMcp.map((s) => `<span class="cap-mini-pill">mcp:${escapeHtml(s.name)}</span>`),
    ].join('');
    el('chatActiveToolsPills').innerHTML = toolsHtml || '<span class="cap-mini-pill">None</span>';

    const skillsHtml = enabledSkills
      .map((s) => `<span class="cap-mini-pill skill">${escapeHtml(s.name)} (${s.indexTokens}t)</span>`)
      .join('');
    el('chatActiveSkillsPills').innerHTML = skillsHtml || '<span class="cap-mini-pill">No Active Skills</span>';
  }

  // ==================== 2. 渲染 Tools & MCP 配置页 ====================
  function renderBuiltInTools() {
    const container = el('builtInToolsGrid');
    container.innerHTML = state.builtInTools
      .map(
        (tool) => `
      <div class="tool-toggle-card">
        <div>
          <div class="tool-name-row">
            <span>${escapeHtml(tool.name)}</span>
            <span class="tool-policy-tag">${escapeHtml(tool.permissionPolicy)}</span>
          </div>
          <div class="tool-desc-text">${escapeHtml(tool.description)}</div>
        </div>
        <label class="switch-toggle" title="启用或禁用 ${escapeHtml(tool.name)}">
          <input type="checkbox" class="js-toggle-builtin" data-name="${escapeHtml(tool.name)}" ${tool.enabled ? 'checked' : ''} />
          <span class="switch-slider"></span>
        </label>
      </div>
    `
      )
      .join('');

    container.querySelectorAll('.js-toggle-builtin').forEach((chk) => {
      chk.addEventListener('change', async (ev) => {
        const name = ev.target.dataset.name;
        const enabled = ev.target.checked;
        await fetch('/api/mcp/tools/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, enabled }),
        });
        await loadAllCapabilities();
      });
    });
  }

  function renderMcpServers() {
    const container = el('mcpServersList');
    container.innerHTML = state.mcpServers
      .map((srv) => {
        const toolNames = (srv.tools || []).map((t) => t.name).join(', ');
        return `
        <div class="mcp-server-card">
          <div style="flex:1;min-width:0;">
            <div class="mcp-srv-title-row">
              <span class="mcp-srv-name">${escapeHtml(srv.name)}</span>
              <span class="badge-transport">${escapeHtml(srv.transport)}</span>
              <span class="badge-scope">${escapeHtml(srv.scope)}</span>
            </div>
            <div class="tool-desc-text">${escapeHtml(srv.description)}</div>
            <div class="mcp-cmd-line">cmd/url: <code>${escapeHtml(srv.commandOrUrl)}</code> · tools: <code>${escapeHtml(toolNames)}</code></div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <label class="switch-toggle" title="启用或禁用该 MCP Server">
              <input type="checkbox" class="js-toggle-mcp-srv" data-name="${escapeHtml(srv.name)}" ${srv.enabled ? 'checked' : ''} />
              <span class="switch-slider"></span>
            </label>
            <button class="btn-danger-xs js-delete-mcp-srv" data-name="${escapeHtml(srv.name)}">Delete</button>
          </div>
        </div>
      `;
      })
      .join('');

    container.querySelectorAll('.js-toggle-mcp-srv').forEach((chk) => {
      chk.addEventListener('change', async (ev) => {
        await fetch('/api/mcp/servers/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: ev.target.dataset.name, enabled: ev.target.checked }),
        });
        await loadAllCapabilities();
      });
    });

    container.querySelectorAll('.js-delete-mcp-srv').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.name;
        await fetch('/api/mcp/servers/' + encodeURIComponent(name), { method: 'DELETE' });
        await loadAllCapabilities();
      });
    });
  }

  // ==================== 3. 渲染 Skills 渐进式技能管理中心 ====================
  function renderSkillsWorkbench() {
    const container = el('skillsCardsContainer');
    if (!state.selectedSkillName && state.skills.length > 0) {
      state.selectedSkillName = state.skills[0].name;
    }

    container.innerHTML = state.skills
      .map((s) => {
        const isSelected = s.name === state.selectedSkillName;
        return `
        <div class="skill-item-card ${isSelected ? 'active' : ''}" data-skill="${escapeHtml(s.name)}">
          <div class="skill-card-top">
            <div style="display:flex;align-items:center;gap:6px;">
              <strong style="font-family:var(--font-mono);font-size:12.5px;">${escapeHtml(s.name)}</strong>
              <span class="badge-scope">${escapeHtml(s.scope || 'user')}</span>
            </div>
            <label class="switch-toggle" onclick="event.stopPropagation()">
              <input type="checkbox" class="js-toggle-skill" data-name="${escapeHtml(s.name)}" ${s.enabled ? 'checked' : ''} />
              <span class="switch-slider"></span>
            </label>
          </div>
          <div class="tool-desc-text">${escapeHtml(s.description)}</div>
          <div class="skill-path-line">${escapeHtml(s.skillPath || '~/.agents/skills/' + s.name + '/SKILL.md')} · Index: ${s.indexTokens}t / Full: ${s.fullBodyTokens}t</div>
        </div>
      `;
      })
      .join('');

    container.querySelectorAll('.skill-item-card').forEach((card) => {
      card.addEventListener('click', () => {
        state.selectedSkillName = card.dataset.skill;
        renderSkillsWorkbench();
        populateSkillEditor(state.selectedSkillName);
      });
    });

    container.querySelectorAll('.js-toggle-skill').forEach((chk) => {
      chk.addEventListener('change', async (ev) => {
        await fetch('/api/skills/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: ev.target.dataset.name, enabled: ev.target.checked }),
        });
        await loadAllCapabilities();
      });
    });

    if (state.selectedSkillName) {
      populateSkillEditor(state.selectedSkillName);
    }
  }

  function populateSkillEditor(skillName) {
    const skill = state.skills.find((s) => s.name === skillName);
    if (!skill) return;
    el('skillEditName').value = skill.name;
    el('skillEditScope').value = skill.scope || 'user';
    el('skillEditScripts').value = (skill.bundledScripts || []).join(', ');
    el('skillEditDesc').value = skill.description || '';
    el('skillEditBody').value = skill.instructionsBody || '';
    const savedPct = Math.round((1 - skill.indexTokens / Math.max(1, skill.fullBodyTokens)) * 1000) / 10;
    el('skillTokenSavingsBadge').textContent = `Index ${skill.indexTokens}t vs Full ${skill.fullBodyTokens}t (省 ${savedPct}%)`;
  }

  // ==================== 4. 加载工作区文件与在线编辑器 ====================
  async function loadWorkspaceFiles() {
    try {
      const root = el('workspaceRootInput').value.trim();
      state.workspaceRoot = root;
      const res = await fetch('/api/workspace/files?root=' + encodeURIComponent(root));
      state.files = await res.json();
      el('sidebarFilesBadge').textContent = state.files.length + ' Files';
      renderFileArtifacts();
    } catch (e) {
      console.error('loadWorkspaceFiles error:', e);
    }
  }

  function formatDiffHtml(diffText) {
    return String(diffText || '')
      .split('\n')
      .map((line) => {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          return `<span class="diff-line-add">${escapeHtml(line)}</span>`;
        }
        if (line.startsWith('-') && !line.startsWith('---')) {
          return `<span class="diff-line-del">${escapeHtml(line)}</span>`;
        }
        return escapeHtml(line);
      })
      .join('\n');
  }

  function renderFileArtifacts() {
    if (!state.files.length) return;
    const idx = Math.min(state.selectedFileIndex, state.files.length - 1);
    const current = state.files[idx];

    // Chat 右侧文件标签
    el('artifactFileTabs').innerHTML = state.files
      .map((f, i) => {
        const shortName = f.path.split('/').pop();
        return `<button class="file-tab-pill ${i === idx ? 'active' : ''}" data-idx="${i}">${escapeHtml(shortName)}</button>`;
      })
      .join('');

    el('artifactFileTabs').querySelectorAll('.file-tab-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedFileIndex = Number(btn.dataset.idx);
        renderFileArtifacts();
      });
    });

    el('codeFilePath').textContent = current.path;
    el('codeDiffStat').textContent = `+${current.additions} -${current.deletions}`;
    el('codeContentBox').innerHTML = formatDiffHtml(current.diffText);
    el('codeEditorTextarea').value = current.fullSource || '';

    // Files & Diff 完整工作台同步
    el('explorerFileList').innerHTML = state.files
      .map(
        (f, i) => `
      <div class="explorer-item ${i === idx ? 'active' : ''}" data-idx="${i}">
        <span>${escapeHtml(f.path)}</span>
        <span class="diff-stat-badge">+${f.additions} -${f.deletions}</span>
      </div>
    `
      )
      .join('');

    el('explorerFileList').querySelectorAll('.explorer-item').forEach((item) => {
      item.addEventListener('click', () => {
        state.selectedFileIndex = Number(item.dataset.idx);
        renderFileArtifacts();
      });
    });

    el('fullEditorFilePath').textContent = current.path;
    el('fullEditorDiffBadge').textContent = `+${current.additions} -${current.deletions}`;
    el('fullEditorTextarea').value = current.fullSource || '';
    el('fullDiffPreview').innerHTML = formatDiffHtml(current.diffText);
  }

  async function saveCurrentFile(content, feedbackEl) {
    const current = state.files[state.selectedFileIndex];
    if (!current) return;
    feedbackEl.textContent = 'Saving to disk...';
    const res = await fetch('/api/workspace/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: state.workspaceRoot,
        path: current.path,
        content,
      }),
    });
    const data = await res.json();
    feedbackEl.textContent = `Saved (${data.bytesWritten || content.length} bytes) at ${new Date().toLocaleTimeString()}`;
    await loadWorkspaceFiles();
  }

  // ==================== 5. 启动 Codex Agent SSE 主循环 ====================
  function startAgentRun() {
    if (state.sse) {
      state.sse.close();
      state.sse = null;
    }

    const prompt = el('promptInput').value.trim();
    const policy = el('policySelect').value;
    const workspace = el('workspaceRootInput').value.trim();
    const streamEl = el('chatStream');

    streamEl.innerHTML = `
      <div class="msg-user-card">${escapeHtml(prompt)}</div>
    `;
    el('runStatusBadge').textContent = 'RUNNING';
    el('approvalBanner').classList.add('hidden');

    const url =
      `/api/run/stream?scenario=${encodeURIComponent(state.scenario)}` +
      `&prompt=${encodeURIComponent(prompt)}` +
      `&policy=${encodeURIComponent(policy)}` +
      `&workspace=${encodeURIComponent(workspace)}`;

    const sse = new EventSource(url);
    state.sse = sse;

    sse.addEventListener('trace', (ev) => {
      const data = JSON.parse(ev.data);
      const card = document.createElement('div');
      card.className = `trace-step-card type-${data.type}`;
      card.innerHTML = `
        <div class="trace-head">
          <div class="trace-head-left">
            <span class="trace-badge ${escapeHtml(data.type)}">${escapeHtml(data.type)}</span>
            <span class="trace-title">${escapeHtml(data.title)}</span>
          </div>
          <span class="trace-step-num">Step #${data.step}</span>
        </div>
        <div class="trace-body">${escapeHtml(data.detail)}</div>
      `;
      streamEl.appendChild(card);
      streamEl.scrollTop = streamEl.scrollHeight;

      if (data.type === 'APPROVAL_REQUIRED' && data.metadata && data.metadata.approvalId) {
        state.activeApprovalId = data.metadata.approvalId;
        el('approvalCommandText').textContent = data.metadata.command || 'kubectl rollout restart';
        el('approvalBanner').classList.remove('hidden');
        el('runStatusBadge').textContent = 'AWAITING APPROVAL';
      }

      if (data.type === 'FINAL_ANSWER' || data.type === 'GUARDRAIL_BLOCK') {
        el('runStatusBadge').textContent = data.type === 'FINAL_ANSWER' ? 'VERIFIED' : 'GUARDED';
        sse.close();
        state.sse = null;
      }
    });

    sse.onerror = () => {
      el('runStatusBadge').textContent = 'IDLE';
      sse.close();
      state.sse = null;
    };
  }

  // ==================== 6. 跨平台 Shell 执行 ====================
  async function executeShell(cmd) {
    const policy = el('policySelect').value;
    const osType = el('osPlatformSelect').value;
    const res = await fetch('/api/shell/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd, policy, osType }),
    });
    const data = await res.json();
    const box = el('shellOutputBox');
    const div = document.createElement('div');
    div.className = 'shell-entry ' + (data.status !== 'ALLOW' ? 'blocked' : '');
    div.textContent = `$ ${data.command}\n${data.output}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  // ==================== 7. 事件绑定与初始化 ====================
  function bindEvents() {
    // 顶部 PillBar 切换
    document.querySelectorAll('.pill-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // 快捷跳转按钮
    document.querySelectorAll('[data-jump-tab]').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.jumpTab));
    });

    el('btnOpenSettingsTab').addEventListener('click', () => switchTab('settings'));

    // 左侧会话切换
    document.querySelectorAll('.session-node').forEach((node) => {
      node.addEventListener('click', () => {
        document.querySelectorAll('.session-node').forEach((n) => n.classList.remove('active'));
        node.classList.add('active');
        const sc = node.dataset.scenario;
        state.scenario = sc;
        const preset = SCENARIO_PRESETS[sc];
        if (preset) {
          el('headerSessionTitle').textContent = preset.title;
          el('promptInput').value = preset.prompt;
        }
        switchTab('chat');
        startAgentRun();
      });
    });

    // OS 平台切换 (macOS / Windows / Linux)
    el('osPlatformSelect').addEventListener('change', (ev) => {
      const os = ev.target.value;
      state.osPlatform = os;
      if (os === 'windows') {
        el('workspaceRootInput').value = 'C:\\Projects\\coding-agent-harness-patterns';
        el('headerPlatformPill').textContent = 'Windows 11 · PowerShell';
        el('shellPromptPrefix').textContent = 'PS C:\\Projects\\coding-agent-harness-patterns>';
      } else if (os === 'linux') {
        el('workspaceRootInput').value = '/opt/workspace/coding-agent-harness-patterns';
        el('headerPlatformPill').textContent = 'Linux x64 · bash';
        el('shellPromptPrefix').textContent = 'wangguo@wg-codex-linux:/opt/workspace$';
      } else {
        el('workspaceRootInput').value = '/tmp/build-cahp';
        el('headerPlatformPill').textContent = 'macOS · Java 17';
        el('shellPromptPrefix').textContent = 'wangguo@wg-codex-mac build-cahp %';
      }
    });

    el('btnLoadWorkspace').addEventListener('click', loadWorkspaceFiles);
    el('btnRefreshFiles').addEventListener('click', loadWorkspaceFiles);

    // Chat 视图运行按钮
    el('btnRunAgent').addEventListener('click', startAgentRun);
    el('btnNewSession').addEventListener('click', () => {
      switchTab('chat');
      el('promptInput').focus();
    });

    // Mode switch
    document.querySelectorAll('.mode-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-pill').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // HITL 审批
    async function decideHitl(approved) {
      if (!state.activeApprovalId) return;
      await fetch(`/api/approvals/${encodeURIComponent(state.activeApprovalId)}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      });
      el('approvalBanner').classList.add('hidden');
    }
    el('btnApproveYes').addEventListener('click', () => decideHitl(true));
    el('btnApproveNo').addEventListener('click', () => decideHitl(false));

    // Diff / Editor 切换与保存
    el('btnViewDiff').addEventListener('click', () => {
      el('btnViewDiff').classList.add('active');
      el('btnViewSource').classList.remove('active');
      el('codeContentBox').classList.remove('hidden');
      el('editorWrapBox').classList.add('hidden');
    });
    el('btnViewSource').addEventListener('click', () => {
      el('btnViewSource').classList.add('active');
      el('btnViewDiff').classList.remove('active');
      el('codeContentBox').classList.add('hidden');
      el('editorWrapBox').classList.remove('hidden');
    });
    el('btnSaveWorkspaceFile').addEventListener('click', () =>
      saveCurrentFile(el('codeEditorTextarea').value, el('editorSaveStatus'))
    );
    el('btnFullEditorSave').addEventListener('click', () =>
      saveCurrentFile(el('fullEditorTextarea').value, el('fullEditorSaveMsg'))
    );

    // Shell 终端
    el('btnExecShell').addEventListener('click', () => executeShell(el('shellCommandInput').value));
    document.querySelectorAll('.shell-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        el('shellCommandInput').value = btn.dataset.cmd;
        executeShell(btn.dataset.cmd);
      });
    });

    // MCP 新增与 RPC 调试
    el('btnOpenAddMcpModal').addEventListener('click', () => {
      el('addMcpFormCard').classList.toggle('hidden');
    });
    el('btnCloseAddMcpModal').addEventListener('click', () => {
      el('addMcpFormCard').classList.add('hidden');
    });
    el('btnConfirmAddMcp').addEventListener('click', async () => {
      const payload = {
        name: el('mcpNewName').value.trim(),
        transport: el('mcpNewTransport').value,
        scope: el('mcpNewScope').value,
        toolName: el('mcpNewToolName').value.trim(),
        commandOrUrl: el('mcpNewCommand').value.trim(),
        description: el('mcpNewDesc').value.trim(),
      };
      await fetch('/api/mcp/servers/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      el('addMcpFormCard').classList.add('hidden');
      await loadAllCapabilities();
    });

    el('mcpRpcInput').value = JSON.stringify(RPC_PRESETS.voice, null, 2);
    document.querySelectorAll('.rpc-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = RPC_PRESETS[btn.dataset.rpc];
        if (p) {
          el('mcpRpcInput').value = JSON.stringify(p, null, 2);
          sendMcpRpc();
        }
      });
    });

    async function sendMcpRpc() {
      try {
        const req = JSON.parse(el('mcpRpcInput').value);
        const res = await fetch('/api/mcp/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        });
        const out = await res.json();
        el('mcpRpcOutput').textContent = JSON.stringify(out, null, 2);
      } catch (e) {
        el('mcpRpcOutput').textContent = 'Invalid JSON: ' + e.message;
      }
    }
    el('btnSendMcpRpc').addEventListener('click', sendMcpRpc);

    // Skills 保存、新建与删除
    el('btnNewSkill').addEventListener('click', () => {
      el('skillEditName').value = 'k8s-canary-rollback';
      el('skillEditScope').value = 'user';
      el('skillEditScripts').value = 'scripts/canary_probe.sh, references/rollout_slo.md';
      el('skillEditDesc').value = '当 K8s 金丝雀发布 P99 延迟或 5xx 错误率超标时，自动执行无损流量切回。';
      el('skillEditBody').value = `---
name: k8s-canary-rollback
description: 当 K8s 金丝雀发布 P99 延迟或 5xx 错误率超标时，自动执行无损流量切回。
---
# Kubernetes Canary Rollback SOP
1. 采集 Prometheus 过去 3 分钟 5xx 比例与 P99 延迟；
2. 若错误率 > 0.5%，立即调用 kubectl rollout undo；
3. 归档故障 Pod 日志快照并发送飞书/企微告警。`;
      el('skillSaveFeedback').textContent = '已填充新技能模板，点击 Save SKILL.md 即可注册生效';
    });

    el('btnSaveSkill').addEventListener('click', async () => {
      const payload = {
        name: el('skillEditName').value.trim(),
        scope: el('skillEditScope').value,
        bundledScripts: el('skillEditScripts').value.trim(),
        description: el('skillEditDesc').value.trim(),
        instructionsBody: el('skillEditBody').value,
        enabled: true,
      };
      const res = await fetch('/api/skills/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const saved = await res.json();
      state.selectedSkillName = saved.name;
      el('skillSaveFeedback').textContent = `已保存 ~/.agents/skills/${saved.name}/SKILL.md (${new Date().toLocaleTimeString()})`;
      await loadAllCapabilities();
    });

    el('btnDeleteSkill').addEventListener('click', async () => {
      const name = el('skillEditName').value.trim();
      if (!name) return;
      await fetch('/api/skills/' + encodeURIComponent(name), { method: 'DELETE' });
      state.selectedSkillName = null;
      await loadAllCapabilities();
    });

    // Settings & Hook Guardrails
    el('btnSaveSettings').addEventListener('click', async () => {
      const res = await fetch('/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runMode: el('llmRunMode').value,
          baseUrl: el('llmBaseUrl').value.trim(),
          model: el('llmModel').value.trim(),
          apiKey: el('llmApiKey').value.trim(),
        }),
      });
      const cfg = await res.json();
      el('effectiveModeBadge').textContent = cfg.effectiveMode;
      el('settingsStatusText').textContent = 'Saved! Effective Mode: ' + cfg.effectiveMode;
    });

    el('btnEvalHook').addEventListener('click', async () => {
      const res = await fetch('/api/hooks/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policy: el('policySelect').value,
          command: el('hookCmdInput').value,
          sampleOutput: el('hookSecretInput').value,
        }),
      });
      const out = await res.json();
      el('hookEvalOutput').textContent = JSON.stringify(out, null, 2);
    });

    el('btnRunCompaction').addEventListener('click', async () => {
      const res = await fetch('/api/compact/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ windowLimit: 2400 }),
      });
      const out = await res.json();
      el('hookEvalOutput').textContent = JSON.stringify(out, null, 2);
    });
  }

  // 支持 URL ?tab=mcp 或 ?tab=skills 直接打开对应功能页
  function applyInitialUrlTab() {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && ['chat', 'files', 'shell', 'mcp', 'skills', 'settings'].includes(tab)) {
      switchTab(tab);
    }
  }

  window.addEventListener('DOMContentLoaded', async () => {
    bindEvents();
    applyInitialUrlTab();
    await Promise.all([loadAllCapabilities(), loadWorkspaceFiles()]);
    startAgentRun();
    executeShell('pytest -q');
    // 默认初始化一次 MCP JSON-RPC 预览
    el('btnSendMcpRpc').click();
  });
})();
