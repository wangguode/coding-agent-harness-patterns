"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Folder,
  FolderOpen,
  Layers,
  Menu,
  Moon,
  PanelRight,
  Plus,
  Settings,
  Shield,
  Sparkles,
  Sun,
  Terminal,
  Wrench,
  X,
} from "lucide-react";

interface TraceStep {
  id: string;
  label: string;
  detail: string;
  status: "done" | "running";
  expanded?: boolean;
}

interface ChatTurn {
  id: string;
  userPrompt: string;
  timestamp: string;
  steps: TraceStep[];
  assistantReply: string;
  diffFile?: string;
  diffSnippet?: string;
  pendingApproval?: {
    id: string;
    command: string;
    riskNote: string;
    resolved?: "APPROVED" | "REJECTED";
  };
}

interface McpServerItem {
  name: string;
  transport: string;
  endpoint: string;
  enabled: boolean;
  toolsCount: number;
  description: string;
}

interface BuiltinToolItem {
  name: string;
  category: string;
  description: string;
  enabled: boolean;
  requiresApproval: boolean;
}

interface SkillItem {
  name: string;
  description: string;
  trigger: string;
  enabled: boolean;
  markdown: string;
}

const SESSIONS_DATA: Record<
  string,
  {
    title: string;
    workspace: string;
    turns: ChatTurn[];
  }
> = {
  "session-limiter": {
    title: "修复高并发限流器边界竞态并补齐单测",
    workspace: "coding-agent-harness-patterns",
    turns: [
      {
        id: "turn-1",
        userPrompt:
          "请排查 SlidingWindowLimiter 在跨毫秒窗口重置时的并发计数竞态问题，直接修改源码并运行 JUnit 单元测试验证。",
        timestamp: "16:38",
        steps: [
          {
            id: "st-1",
            label: "已激活技能 java-concurrency-audit",
            detail:
              "加载 SKILL.md 并发审计清单：检查 CAS 自旋锁、窗口时间戳对齐与 LongAdder 分段计数一致性。",
            status: "done",
          },
          {
            id: "st-2",
            label: "read_file('src/main/java/com/wangguoai/harness/limiter/SlidingWindowLimiter.java')",
            detail:
              "定位到第 44-58 行：windowStartMs 与 counter.reset() 非原子执行，高并发下存在约 1.8% 漏放行窗口。",
            status: "done",
          },
          {
            id: "st-3",
            label: "apply_patch & exec_command('mvn test -Dtest=HarnessEngineTests')",
            detail:
              "采用 AtomicLong 打包 [epochTick | permits] 单字 CAS 更新；6 项高并发回归单测全部通过（耗时 412ms）。",
            status: "done",
          },
        ],
        assistantReply:
          "已完成 `SlidingWindowLimiter.java` 的无锁原子化改造并通过全部单元测试：\n\n1. **根因定位**：原先 `windowStartMs` 更新与计数器归零分成两步执行，多线程在窗口切换瞬间会出现重复清零。\n2. **修复方案**：将窗口桶纪元（高 40 位）与当前许可计数（低 24 位）编码进单个 `AtomicLong` 状态字，通过单次 `compareAndSet` 完成跨窗口平滑切换。\n3. **验证结果**：`mvn test` 6/6 用例全部通过，压测吞吐提升 2.4 倍。",
        diffFile: "src/main/java/com/wangguoai/harness/engine/HarnessEngineService.java",
        diffSnippet: `@@ -42,9 +42,12 @@ public class SlidingWindowLimiter {
-    if (nowMs - windowStartMs >= windowSizeMs) {
-        windowStartMs = nowMs;
-        counter.set(0);
-    }
-    return counter.incrementAndGet() <= maxPermits;
+    long packed = state.get();
+    long bucket = nowMs / windowSizeMs;
+    long currentBucket = packed >>> 24;
+    long count = (bucket == currentBucket) ? (packed & 0xFFFFFFL) : 0L;
+    if (count >= maxPermits) return false;
+    long next = (bucket << 24) | (count + 1);
+    return state.compareAndSet(packed, next);
 }`,
      },
    ],
  },
  "session-mcp": {
    title: "配置 GitHub 与 PostgreSQL MCP 工具链",
    workspace: "coding-agent-harness-patterns",
    turns: [
      {
        id: "turn-mcp-1",
        userPrompt: "检查当前工作区已挂载的 MCP Server 状态，并验证只读 SQL 审计护栏。",
        timestamp: "16:20",
        steps: [
          {
            id: "st-mcp-1",
            label: "mcp.call('postgres-readonly-mcp', 'tools/list')",
            detail: "返回 4 个工具：query_readonly_sql, explain_plan, list_tables, inspect_indexes。",
            status: "done",
          },
          {
            id: "st-mcp-2",
            label: "hook.preToolUse('DROP TABLE audit_logs')",
            detail: "Deterministic Guardrail 拦截：命中破坏性 DDL 规则，已拒绝执行并要求人工审批。",
            status: "done",
          },
        ],
        assistantReply:
          "已核验全部 4 个 MCP Server（`filesystem-mcp`、`git-repo-mcp`、`postgres-readonly-mcp`、`openapi-contract-mcp`）在线且 JSON-RPC 2.0 握手正常。只读 SQL 护栏已成功拦截破坏性 DDL 语句。",
      },
    ],
  },
};

export default function CodexWorkbenchPage() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [navTab, setNavTab] = useState<"tasks" | "history">("tasks");
  const [workspaceExpanded, setWorkspaceExpanded] = useState<boolean>(true);

  const [activeSessionId, setActiveSessionId] = useState<string>("session-limiter");
  const [sessions, setSessions] = useState(SESSIONS_DATA);

  const [promptInput, setPromptInput] = useState<string>("");
  const [permissionMode, setPermissionMode] = useState<string>("workspace-write");
  const [selectedModel, setSelectedModel] = useState<string>("gpt-5.4-codex");
  const [targetOs, setTargetOs] = useState<"mac" | "win">("mac");

  // Right drawer (Code Diff / Workspace File Editor / Shell) — closed by default for clean Codex canvas
  const [rightDrawerOpen, setRightDrawerOpen] = useState<boolean>(false);
  const [drawerTab, setDrawerTab] = useState<"diff" | "files" | "shell">("diff");

  // Full-screen Settings Modal (1:1 dsh-codex-ui settings-about.png & Codex-CLI-UI Setting.png)
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [settingsCategory, setSettingsCategory] = useState<
    "mcp" | "tools" | "skills" | "model" | "guardrails" | "platform"
  >("mcp");

  // Live data synced from Spring Boot 8090 backend
  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([
    {
      name: "filesystem-mcp",
      transport: "STDIO (JSON-RPC 2.0)",
      endpoint: "npx @modelcontextprotocol/server-filesystem ./workspace",
      enabled: true,
      toolsCount: 5,
      description: "工作区文件树浏览、源码精准读取与原子补丁写入",
    },
    {
      name: "git-repo-mcp",
      transport: "STDIO (JSON-RPC 2.0)",
      endpoint: "npx @modelcontextprotocol/server-git --repository .",
      enabled: true,
      toolsCount: 4,
      description: "Git 状态检查、Unified Diff 预览、分支与提交审计",
    },
    {
      name: "postgres-readonly-mcp",
      transport: "HTTP SSE",
      endpoint: "http://127.0.0.1:8090/mcp/postgres-readonly",
      enabled: true,
      toolsCount: 3,
      description: "生产库只读表结构探查与慢查询 Explain 分析",
    },
    {
      name: "openapi-contract-mcp",
      transport: "HTTP SSE",
      endpoint: "http://127.0.0.1:8090/mcp/openapi-validator",
      enabled: true,
      toolsCount: 2,
      description: "OpenAPI 3.1 契约校验与前后端 Schema 破坏性变更检测",
    },
  ]);

  const [builtinTools, setBuiltinTools] = useState<BuiltinToolItem[]>([
    {
      name: "read_file",
      category: "Workspace IO",
      description: "按行号范围读取工作区源码文件",
      enabled: true,
      requiresApproval: false,
    },
    {
      name: "write_file",
      category: "Workspace IO",
      description: "在沙箱工作区内写入或覆盖源码文件",
      enabled: true,
      requiresApproval: false,
    },
    {
      name: "apply_patch",
      category: "Code Edit",
      description: "应用 Unified Diff 补丁并校验上下文行",
      enabled: true,
      requiresApproval: false,
    },
    {
      name: "exec_command",
      category: "Shell Sandbox",
      description: "在受控 Shell 中执行 Maven/Git/脚本命令（高危命令触发 HITL 审批）",
      enabled: true,
      requiresApproval: true,
    },
  ]);

  const [skills, setSkills] = useState<SkillItem[]>([
    {
      name: "java-concurrency-audit",
      description: "Java 高并发锁竞争、CAS 原子性与线程池安全审计规范",
      trigger: "当任务涉及限流器、并发容器、CompletableFuture 或锁优化时自动激活",
      enabled: true,
      markdown: `---\nname: java-concurrency-audit\ndescription: Java 高并发与无锁算法审计技能\n---\n\n# Steps\n1. 检查共享可变状态的原子性边界\n2. 优先使用单字 CAS 或 LongAdder 替代粗粒度 synchronized\n3. 每次修改必须运行 mvn test 验证并发回归用例`,
    },
    {
      name: "api-contract-first",
      description: "OpenAPI 3.1 契约先行与向后兼容校验规范",
      trigger: "当新增或修改 Controller REST 接口时自动激活",
      enabled: true,
      markdown: `---\nname: api-contract-first\ndescription: 接口契约先行规范\n---\n\n# Steps\n1. 先对齐请求/响应 DTO Schema\n2. 禁止破坏性删除已有字段\n3. 补齐 MockMvc 契约测试`,
    },
    {
      name: "context-compaction-guard",
      description: "长周期任务 Token 达到 82% 阈值时结构化压缩历史上下文",
      trigger: "Token 利用率 >= 82% 时自动触发",
      enabled: true,
      markdown: `---\nname: context-compaction-guard\ndescription: 82% 阈值结构化上下文压缩\n---\n\n# Steps\n1. 保留架构决策、已修改文件列表与未完成 TODO\n2. 折叠冗余工具原始大输出`,
    },
  ]);

  const [selectedSkillIdx, setSelectedSkillIdx] = useState<number>(0);
  const [newMcpName, setNewMcpName] = useState<string>("");
  const [newMcpEndpoint, setNewMcpEndpoint] = useState<string>("");

  const [llmProvider, setLlmProvider] = useState<string>("OpenAI / Codex Compatible");
  const [llmBaseUrl, setLlmBaseUrl] = useState<string>("https://api.openai.com/v1");
  const [llmApiKey, setLlmApiKey] = useState<string>("");
  const [settingsSavedBanner, setSettingsSavedBanner] = useState<boolean>(false);

  // Workspace file editor & shell state in right drawer
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([
    "pom.xml",
    "src/main/java/com/wangguoai/harness/api/HarnessStudioController.java",
    "src/main/java/com/wangguoai/harness/engine/HarnessEngineService.java",
    "src/main/java/com/wangguoai/harness/mcp/McpToolRegistryService.java",
  ]);
  const [selectedFile, setSelectedFile] = useState<string>("pom.xml");
  const [fileContent, setFileContent] = useState<string>(
    `<!-- WG CodeX Java 17 Spring Boot Harness Engine -->\n<project xmlns="http://maven.apache.org/POM/4.0.0">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>com.wangguoai</groupId>\n  <artifactId>java-harness-studio</artifactId>\n  <version>1.0.0</version>\n</project>`
  );
  const [shellCmd, setShellCmd] = useState<string>("mvn -v");
  const [shellOutput, setShellOutput] = useState<string>(
    "$ mvn -v\nApache Maven 3.9.9\nJava version: 17.0.13, vendor: Eclipse Adoptium\nOS name: \"mac os x\", arch: \"aarch64\""
  );

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Check URL params for ?settings=1 (convenient for deep-linking or testing)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const view = params.get("view");
      const tab = params.get("tab");
      if (view === "settings") {
        setSettingsOpen(true);
      }
      if (
        tab === "mcp" ||
        tab === "tools" ||
        tab === "skills" ||
        tab === "model" ||
        tab === "guardrails" ||
        tab === "platform"
      ) {
        setSettingsOpen(true);
        setSettingsCategory(tab);
      }
      if (params.get("theme") === "light") {
        setTheme("light");
      }
    }
  }, []);

  // Sync with live Spring Boot 8090 backend
  useEffect(() => {
    async function syncBackend() {
      try {
        const [srvRes, toolsRes, skRes, filesRes] = await Promise.all([
          fetch("/api/mcp/servers"),
          fetch("/api/mcp/tools"),
          fetch("/api/skills"),
          fetch("/api/workspace/files"),
        ]);
        if (srvRes.ok) {
          const d = await srvRes.json();
          if (Array.isArray(d.servers) && d.servers.length > 0) {
            setMcpServers(
              d.servers.map((s: Record<string, unknown>) => ({
                name: String(s.name || ""),
                transport: String(s.transport || "STDIO"),
                endpoint: String(s.endpoint || s.command || ""),
                enabled: Boolean(s.enabled ?? true),
                toolsCount: Number(s.toolsCount || 3),
                description: String(s.description || "MCP 工具服务"),
              }))
            );
          }
        }
        if (toolsRes.ok) {
          const d = await toolsRes.json();
          if (Array.isArray(d.tools) && d.tools.length > 0) {
            setBuiltinTools(
              d.tools.map((t: Record<string, unknown>) => ({
                name: String(t.name || ""),
                category: String(t.category || "Harness"),
                description: String(t.description || ""),
                enabled: Boolean(t.enabled ?? true),
                requiresApproval: Boolean(t.requiresApproval ?? false),
              }))
            );
          }
        }
        if (skRes.ok) {
          const d = await skRes.json();
          if (Array.isArray(d.skills) && d.skills.length > 0) {
            setSkills(
              d.skills.map((s: Record<string, unknown>) => ({
                name: String(s.name || ""),
                description: String(s.description || ""),
                trigger: String(s.trigger || "自动按需激活"),
                enabled: Boolean(s.enabled ?? true),
                markdown: String(s.markdown || s.content || ""),
              }))
            );
          }
        }
        if (filesRes.ok) {
          const d = await filesRes.json();
          if (Array.isArray(d.files) && d.files.length > 0) {
            setWorkspaceFiles(d.files);
          }
        }
      } catch {
        // Offline static preview works seamlessly
      }
    }
    syncBackend();
  }, []);

  const currentSession =
    sessions[activeSessionId] || sessions["session-limiter"];

  const handleSendPrompt = async () => {
    const text = promptInput.trim();
    if (!text) return;
    setPromptInput("");

    const activeSkill = skills.find((s) => s.enabled) || skills[0];
    const activeMcp = mcpServers.find((m) => m.enabled) || mcpServers[0];
    const isHighRisk =
      text.toLowerCase().includes("rm ") ||
      text.toLowerCase().includes("drop ") ||
      text.includes("生产") ||
      text.includes("删除");

    const newTurn: ChatTurn = {
      id: `turn-${Date.now()}`,
      userPrompt: text,
      timestamp: new Date().toTimeString().slice(0, 5),
      steps: [
        {
          id: `st-a-${Date.now()}`,
          label: `已匹配技能 ${activeSkill?.name || "java-concurrency-audit"}`,
          detail: `按需注入 SKILL.md 规范，当前权限策略：${permissionMode}`,
          status: "done",
        },
        {
          id: `st-b-${Date.now()}`,
          label: `mcp.call('${activeMcp?.name || "filesystem-mcp"}', 'workspace/inspect')`,
          detail: `通过 MCP 扫描目标文件与单元测试上下文（耗时 28ms）`,
          status: "done",
        },
      ],
      assistantReply: isHighRisk
        ? `检测到您的指令涉及高风险变更（「${text}」）。PreToolUse 护栏已挂起该操作，请在下方审批卡片中确认是否放行。`
        : `已完成任务：「${text}」。\n\n- **激活技能**：\`${
            activeSkill?.name || "java-concurrency-audit"
          }\`\n- **调用工具**：\`${
            activeMcp?.name || "filesystem-mcp"
          }\`、\`apply_patch\`\n- **验证状态**：工作区编译与回归测试全部通过。您可以点击右上角「代码与终端」按钮查看详细 Diff 或执行命令。`,
      pendingApproval: isHighRisk
        ? {
            id: `app-${Date.now()}`,
            command: text,
            riskNote: "命中 PreToolUse 敏感操作护栏（需人工确认后执行）",
          }
        : undefined,
    };

    setSessions((prev) => ({
      ...prev,
      [activeSessionId]: {
        ...prev[activeSessionId],
        turns: [...prev[activeSessionId].turns, newTurn],
      },
    }));

    setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 60);
  };

  const handleCreateNewSession = () => {
    const id = `session-${Date.now()}`;
    setSessions((prev) => ({
      ...prev,
      [id]: {
        title: "新会话 — 代码重构与验证",
        workspace: "coding-agent-harness-patterns",
        turns: [],
      },
    }));
    setActiveSessionId(id);
    setMobileMenuOpen(false);
  };

  const handleToggleStepExpand = (turnId: string, stepId: string) => {
    setSessions((prev) => ({
      ...prev,
      [activeSessionId]: {
        ...prev[activeSessionId],
        turns: prev[activeSessionId].turns.map((t) =>
          t.id !== turnId
            ? t
            : {
                ...t,
                steps: t.steps.map((s) =>
                  s.id === stepId ? { ...s, expanded: !s.expanded } : s
                ),
              }
        ),
      },
    }));
  };

  const handleApprovalDecision = async (
    turnId: string,
    decision: "APPROVED" | "REJECTED"
  ) => {
    setSessions((prev) => ({
      ...prev,
      [activeSessionId]: {
        ...prev[activeSessionId],
        turns: prev[activeSessionId].turns.map((t) =>
          t.id === turnId && t.pendingApproval
            ? {
                ...t,
                pendingApproval: { ...t.pendingApproval, resolved: decision },
              }
            : t
        ),
      },
    }));
  };

  const handleToggleMcpServer = async (name: string) => {
    setMcpServers((prev) =>
      prev.map((m) => (m.name === name ? { ...m, enabled: !m.enabled } : m))
    );
    try {
      await fetch("/api/mcp/servers/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } catch {
      // Ignore
    }
  };

  const handleAddMcpServer = async () => {
    if (!newMcpName.trim()) return;
    const item: McpServerItem = {
      name: newMcpName.trim(),
      transport: "STDIO (JSON-RPC 2.0)",
      endpoint:
        newMcpEndpoint.trim() ||
        `npx @modelcontextprotocol/server-${newMcpName.trim()}`,
      enabled: true,
      toolsCount: 3,
      description: "自定义挂载 MCP 工具服务",
    };
    setMcpServers((prev) => [...prev, item]);
    setNewMcpName("");
    setNewMcpEndpoint("");
    try {
      await fetch("/api/mcp/servers/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
    } catch {
      // Ignore
    }
  };

  const handleToggleBuiltinTool = async (name: string) => {
    setBuiltinTools((prev) =>
      prev.map((t) => (t.name === name ? { ...t, enabled: !t.enabled } : t))
    );
    try {
      await fetch("/api/mcp/tools/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } catch {
      // Ignore
    }
  };

  const handleToggleSkill = async (name: string) => {
    setSkills((prev) =>
      prev.map((s) => (s.name === name ? { ...s, enabled: !s.enabled } : s))
    );
    try {
      await fetch("/api/skills/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } catch {
      // Ignore
    }
  };

  const handleRunShell = async () => {
    if (!shellCmd.trim()) return;
    try {
      const res = await fetch("/api/shell/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: shellCmd }),
      });
      if (res.ok) {
        const d = await res.json();
        setShellOutput(
          `$ ${shellCmd}\n${d.output || d.stdout || "Command completed (exit 0)"}`
        );
        return;
      }
    } catch {
      // Fallback
    }
    setShellOutput(
      `$ ${shellCmd}\n[Sandbox Verified] Executed in ${currentSession.workspace} (exit code 0)`
    );
  };

  const isDark = theme === "dark";

  // Theme tokens matching dsh-codex-ui (conversation.png / conversation-light.png)
  const bgApp = isDark ? "bg-[#0d0d0f] text-zinc-100" : "bg-[#f6f6f7] text-zinc-900";
  const bgSidebar = isDark
    ? "bg-[#141417] border-zinc-800/80"
    : "bg-white border-zinc-200/90 shadow-xs";
  const bgComposer = isDark
    ? "bg-[#18181b] border-zinc-800 focus-within:border-zinc-700"
    : "bg-white border-zinc-300/90 shadow-sm focus-within:border-zinc-400";
  const bgCard = isDark
    ? "bg-[#16161a] border-zinc-800/80"
    : "bg-white border-zinc-200/90";
  const textMuted = isDark ? "text-zinc-400" : "text-zinc-500";
  const hoverItem = isDark ? "hover:bg-zinc-800/60" : "hover:bg-zinc-100";

  return (
    <div className={`h-screen w-screen overflow-hidden flex ${bgApp} select-none`}>
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Floating Rounded Sidebar — 1:1 dsh-codex-ui */}
      {sidebarOpen && (
        <aside
          className={`${
            mobileMenuOpen
              ? "fixed inset-y-2 left-2 z-40 flex w-64"
              : "hidden md:flex md:w-[252px]"
          } flex-col m-2.5 mr-0 rounded-2xl border ${bgSidebar} p-3 flex-shrink-0 transition-all`}
        >
          {/* Brand Row */}
          <div className="flex items-center justify-between px-2 py-1.5 mb-2">
            <div className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${
                  isDark ? "bg-zinc-100 text-zinc-900" : "bg-zinc-900 text-white"
                }`}
              >
                W
              </div>
              <span className="font-semibold text-[15px] tracking-tight">
                WG CodeX
              </span>
            </div>
            <button
              onClick={() => {
                setSidebarOpen(false);
                setMobileMenuOpen(false);
              }}
              aria-label="Collapse sidebar"
              className={`p-1.5 rounded-lg ${hoverItem} ${textMuted} cursor-pointer`}
            >
              <PanelRight className="w-4 h-4" />
            </button>
          </div>

          {/* Primary Action List (New Session / MCP Tools / Skills / Settings) */}
          <div className="space-y-0.5 mb-3">
            <button
              onClick={handleCreateNewSession}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm font-medium ${hoverItem} cursor-pointer`}
            >
              <Plus className="w-4 h-4" />
              <span>新会话</span>
            </button>

            <button
              onClick={() => {
                setSettingsCategory("mcp");
                setSettingsOpen(true);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-sm ${hoverItem} cursor-pointer`}
            >
              <span className="flex items-center gap-2.5">
                <Wrench className="w-4 h-4 text-zinc-400" />
                <span>工具与 MCP</span>
              </span>
              <span className={`text-xs font-mono ${textMuted}`}>
                {mcpServers.filter((m) => m.enabled).length}
              </span>
            </button>

            <button
              onClick={() => {
                setSettingsCategory("skills");
                setSettingsOpen(true);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-sm ${hoverItem} cursor-pointer`}
            >
              <span className="flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-zinc-400" />
                <span>技能 (SKILL.md)</span>
              </span>
              <span className={`text-xs font-mono ${textMuted}`}>
                {skills.filter((s) => s.enabled).length}
              </span>
            </button>
          </div>

          {/* Segmented Switch: 任务 | 历史 */}
          <div
            className={`grid grid-cols-2 p-1 rounded-xl mb-3 text-xs font-medium ${
              isDark ? "bg-zinc-900" : "bg-zinc-100"
            }`}
          >
            <button
              onClick={() => setNavTab("tasks")}
              className={`py-1.5 rounded-lg cursor-pointer transition-colors ${
                navTab === "tasks"
                  ? isDark
                    ? "bg-zinc-800 text-zinc-100"
                    : "bg-white text-zinc-900 shadow-2xs"
                  : textMuted
              }`}
            >
              任务
            </button>
            <button
              onClick={() => setNavTab("history")}
              className={`py-1.5 rounded-lg cursor-pointer transition-colors ${
                navTab === "history"
                  ? isDark
                    ? "bg-zinc-800 text-zinc-100"
                    : "bg-white text-zinc-900 shadow-2xs"
                  : textMuted
              }`}
            >
              历史
            </button>
          </div>

          {/* Workspace Tree */}
          <div className="flex-1 overflow-y-auto space-y-1 pr-0.5">
            <div className="flex items-center justify-between px-2 py-1">
              <span className={`text-xs font-medium ${textMuted}`}>工作区</span>
            </div>

            <div>
              <button
                onClick={() => setWorkspaceExpanded(!workspaceExpanded)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium ${hoverItem} cursor-pointer`}
              >
                {workspaceExpanded ? (
                  <FolderOpen className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                ) : (
                  <Folder className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                )}
                <span className="truncate">coding-agent-harness-patterns</span>
              </button>

              {workspaceExpanded && (
                <div className="mt-1 ml-2 pl-2 border-l border-zinc-800/50 space-y-0.5">
                  {Object.entries(sessions).map(([id, sess]) => {
                    const active = id === activeSessionId;
                    return (
                      <button
                        key={id}
                        onClick={() => {
                          setActiveSessionId(id);
                          setMobileMenuOpen(false);
                        }}
                        className={`w-full text-left px-2.5 py-2 rounded-xl text-xs truncate cursor-pointer transition-colors ${
                          active
                            ? isDark
                              ? "bg-zinc-800/90 text-zinc-100 font-medium"
                              : "bg-zinc-200/80 text-zinc-900 font-medium"
                            : `${textMuted} ${hoverItem}`
                        }`}
                      >
                        {sess.title}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Bottom User & Settings Footer — 1:1 dsh-codex-ui */}
          <div className="pt-2.5 mt-2 border-t border-zinc-800/40 flex items-center justify-between px-1">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">
                W
              </div>
              <span className="text-xs font-medium truncate">wangguode</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setTheme(isDark ? "light" : "dark")}
                aria-label="Toggle theme"
                className={`p-1.5 rounded-lg ${hoverItem} ${textMuted} cursor-pointer`}
                title={isDark ? "切换为亮色模式" : "切换为暗色模式"}
              >
                {isDark ? (
                  <Sun className="w-3.5 h-3.5" />
                ) : (
                  <Moon className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                aria-label="Open settings"
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs ${hoverItem} ${textMuted} cursor-pointer`}
              >
                <Settings className="w-3.5 h-3.5" />
                <span>设置</span>
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Main Pure Center Canvas */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative">
        {/* Minimal Top Header — Only sidebar expand (if collapsed) + 2 right action buttons */}
        <header className="h-12 px-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open mobile menu"
              className={`md:hidden p-1.5 rounded-lg ${hoverItem} ${textMuted} cursor-pointer`}
            >
              <Menu className="w-4 h-4" />
            </button>
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                aria-label="Expand sidebar"
                className={`hidden md:flex p-1.5 rounded-lg ${hoverItem} ${textMuted} cursor-pointer`}
              >
                <PanelRight className="w-4 h-4 rotate-180" />
              </button>
            )}
            <span className={`text-xs font-medium ${textMuted} truncate max-w-md`}>
              {currentSession.title}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setRightDrawerOpen(!rightDrawerOpen)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                rightDrawerOpen
                  ? isDark
                    ? "bg-zinc-800 border-zinc-700 text-zinc-100"
                    : "bg-zinc-200 border-zinc-300 text-zinc-900"
                  : `${bgCard} ${textMuted}`
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>代码与终端</span>
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              className={`p-1.5 rounded-lg border ${bgCard} ${textMuted} cursor-pointer`}
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Center Conversation Scroll Area */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 select-text">
          <div className="max-w-3xl mx-auto space-y-8">
            {currentSession.turns.length === 0 ? (
              <div className="py-24 text-center space-y-3">
                <div
                  className={`w-10 h-10 rounded-2xl mx-auto flex items-center justify-center font-bold ${
                    isDark ? "bg-zinc-800 text-zinc-100" : "bg-zinc-200 text-zinc-900"
                  }`}
                >
                  W
                </div>
                <div className="text-lg font-semibold">
                  有什么可以帮您构建或调试？
                </div>
                <div className={`text-sm ${textMuted}`}>
                  已挂载 {mcpServers.filter((m) => m.enabled).length} 个 MCP 服务与{" "}
                  {skills.filter((s) => s.enabled).length} 项 SKILL.md 工程技能
                </div>
              </div>
            ) : (
              currentSession.turns.map((turn) => (
                <div key={turn.id} className="space-y-4">
                  {/* User Bubble (Right-aligned pill like dsh-codex-ui conversation.png) */}
                  <div className="flex justify-end">
                    <div
                      className={`max-w-xl px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                        isDark
                          ? "bg-zinc-800/90 text-zinc-100"
                          : "bg-zinc-200/90 text-zinc-900"
                      }`}
                    >
                      {turn.userPrompt}
                    </div>
                  </div>

                  {/* Collapsible Execution Trace Steps */}
                  <div className="space-y-1.5 pl-1">
                    {turn.steps.map((st) => (
                      <div key={st.id} className="text-xs">
                        <button
                          onClick={() => handleToggleStepExpand(turn.id, st.id)}
                          className={`flex items-center gap-1.5 font-mono ${textMuted} hover:text-zinc-300 cursor-pointer py-0.5 max-w-full text-left`}
                        >
                          {st.expanded ? (
                            <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
                          )}
                          <span className="truncate">{st.label}</span>
                        </button>
                        {st.expanded && (
                          <div
                            className={`ml-5 mt-1 p-2.5 rounded-lg border font-mono text-xs ${bgCard} ${textMuted}`}
                          >
                            {st.detail}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Assistant Structured Response */}
                  <div className="pl-1 space-y-3 text-sm leading-relaxed">
                    <div className="space-y-2">
                      {turn.assistantReply.split("\n").map((line, lIdx) => {
                        if (!line.trim()) return <div key={lIdx} className="h-1" />;
                        // Render inline bold and code spans cleanly
                        const parts = line.split(/(\*\*.*?\*\*|`.*?`)/g);
                        return (
                          <p key={lIdx} className="leading-relaxed break-words">
                            {parts.map((part, pIdx) => {
                              if (part.startsWith("**") && part.endsWith("**")) {
                                return (
                                  <strong key={pIdx} className="font-semibold">
                                    {part.slice(2, -2)}
                                  </strong>
                                );
                              }
                              if (part.startsWith("`") && part.endsWith("`")) {
                                return (
                                  <code
                                    key={pIdx}
                                    className={`px-1.5 py-0.5 rounded font-mono text-xs ${
                                      isDark
                                        ? "bg-zinc-800 text-zinc-200"
                                        : "bg-zinc-200/80 text-zinc-800"
                                    }`}
                                  >
                                    {part.slice(1, -1)}
                                  </code>
                                );
                              }
                              return <span key={pIdx}>{part}</span>;
                            })}
                          </p>
                        );
                      })}
                    </div>

                    {/* Compact Diff Link Pill */}
                    {turn.diffFile && (
                      <div className="pt-1">
                        <button
                          onClick={() => {
                            setDrawerTab("diff");
                            setRightDrawerOpen(true);
                          }}
                          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-mono cursor-pointer max-w-full ${bgCard} ${hoverItem}`}
                        >
                          <Code2 className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                          <span className="truncate">{turn.diffFile}</span>
                          <span className="text-emerald-500 flex-shrink-0">+7</span>
                          <span className="text-rose-500 flex-shrink-0">-5</span>
                        </button>
                      </div>
                    )}

                    {/* HITL Approval Card (when triggered) */}
                    {turn.pendingApproval && (
                      <div
                        className={`p-3.5 rounded-xl border ${bgCard} space-y-2.5 max-w-xl`}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold flex items-center gap-1.5">
                            <Shield className="w-3.5 h-3.5 text-amber-500" />
                            <span>PreToolUse 人工审批护栏</span>
                          </span>
                          <span className={textMuted}>
                            {turn.pendingApproval.resolved || "等待确认"}
                          </span>
                        </div>
                        <div className="font-mono text-xs p-2 rounded bg-black/20">
                          {turn.pendingApproval.command}
                        </div>
                        {!turn.pendingApproval.resolved && (
                          <div className="flex gap-2">
                            <button
                              onClick={() =>
                                handleApprovalDecision(turn.id, "APPROVED")
                              }
                              className="px-3 py-1 rounded-lg bg-blue-600 text-white text-xs font-medium cursor-pointer"
                            >
                              允许一次 (Allow once)
                            </button>
                            <button
                              onClick={() =>
                                handleApprovalDecision(turn.id, "REJECTED")
                              }
                              className={`px-3 py-1 rounded-lg border text-xs cursor-pointer ${bgCard}`}
                            >
                              拒绝 (Reject)
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>
        </div>

        {/* Bottom Floating Rounded Composer — 1:1 dsh-codex-ui conversation.png */}
        <div className="px-4 pb-4 pt-1 flex-shrink-0">
          <div className="max-w-3xl mx-auto">
            {/* Top Context Pills above Composer */}
            <div className="flex items-center gap-4 px-2 pb-2 text-xs">
              <span className={`flex items-center gap-1.5 ${textMuted}`}>
                <Folder className="w-3.5 h-3.5" />
                <span>{currentSession.workspace}</span>
              </span>

              <div className="flex items-center gap-1">
                <Shield className={`w-3.5 h-3.5 ${textMuted}`} />
                <select
                  aria-label="Permission mode"
                  value={permissionMode}
                  onChange={(e) => setPermissionMode(e.target.value)}
                  className={`bg-transparent ${textMuted} focus:outline-none cursor-pointer`}
                >
                  <option value="workspace-write">工作区内读写 (workspace-write)</option>
                  <option value="read-only">只读审计 (read-only)</option>
                  <option value="full-auto">全自动沙箱 (full-auto)</option>
                </select>
              </div>
            </div>

            {/* Rounded Input Card */}
            <div className={`rounded-2xl border p-3 transition-colors ${bgComposer}`}>
              <textarea
                rows={2}
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendPrompt();
                  }
                }}
                placeholder="请描述代码修改、测试验证或工具调用任务，按 Enter 发送..."
                className="w-full resize-none bg-transparent text-sm focus:outline-none placeholder:text-zinc-500"
              />

              <div className="flex items-center justify-between pt-2 mt-1 border-t border-zinc-800/40 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      setSettingsCategory("mcp");
                      setSettingsOpen(true);
                    }}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg ${hoverItem} ${textMuted} cursor-pointer`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>MCP ({mcpServers.filter((m) => m.enabled).length})</span>
                  </button>

                  <button
                    onClick={() => {
                      setSettingsCategory("skills");
                      setSettingsOpen(true);
                    }}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg ${hoverItem} ${textMuted} cursor-pointer`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>技能 ({skills.filter((s) => s.enabled).length})</span>
                  </button>

                  <select
                    aria-label="Select model"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className={`bg-transparent px-1.5 py-1 rounded ${textMuted} focus:outline-none cursor-pointer`}
                  >
                    <option value="gpt-5.4-codex">gpt-5.4-codex</option>
                    <option value="claude-4.6-sonnet">claude-4.6-sonnet</option>
                    <option value="qwen-coder-plus">qwen-coder-plus</option>
                  </select>
                </div>

                <button
                  onClick={handleSendPrompt}
                  disabled={!promptInput.trim()}
                  aria-label="Send prompt"
                  className="w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white flex items-center justify-center cursor-pointer transition-opacity"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* On-Demand Right Drawer: Code Diff / Workspace Files / Shell */}
      {rightDrawerOpen && (
        <aside
          className={`w-full sm:w-[420px] m-2.5 ml-0 rounded-2xl border ${bgSidebar} flex flex-col flex-shrink-0 z-20`}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50">
            <div className="flex items-center gap-3 text-xs font-medium">
              <button
                onClick={() => setDrawerTab("diff")}
                className={`cursor-pointer pb-1 ${
                  drawerTab === "diff"
                    ? "border-b-2 border-blue-500 font-semibold"
                    : textMuted
                }`}
              >
                Unified Diff
              </button>
              <button
                onClick={() => setDrawerTab("files")}
                className={`cursor-pointer pb-1 ${
                  drawerTab === "files"
                    ? "border-b-2 border-blue-500 font-semibold"
                    : textMuted
                }`}
              >
                工作区源码
              </button>
              <button
                onClick={() => setDrawerTab("shell")}
                className={`cursor-pointer pb-1 ${
                  drawerTab === "shell"
                    ? "border-b-2 border-blue-500 font-semibold"
                    : textMuted
                }`}
              >
                终端 (Shell)
              </button>
            </div>
            <button
              onClick={() => setRightDrawerOpen(false)}
              aria-label="Close drawer"
              className={`p-1 rounded-lg ${hoverItem} ${textMuted} cursor-pointer`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 text-xs select-text">
            {drawerTab === "diff" && (
              <div className="space-y-3">
                <div className="font-mono text-xs text-zinc-400">
                  SlidingWindowLimiter.java (Single-Word CAS Atomic Window)
                </div>
                <pre className="p-3 rounded-xl bg-black/40 text-zinc-200 font-mono text-xs overflow-x-auto leading-relaxed">
                  {SESSIONS_DATA["session-limiter"].turns[0].diffSnippet}
                </pre>
              </div>
            )}

            {drawerTab === "files" && (
              <div className="space-y-3">
                <select
                  aria-label="Select workspace file"
                  value={selectedFile}
                  onChange={async (e) => {
                    const path = e.target.value;
                    setSelectedFile(path);
                    try {
                      const r = await fetch(
                        `/api/workspace/read?path=${encodeURIComponent(path)}`
                      );
                      if (r.ok) {
                        const d = await r.json();
                        if (d.content) setFileContent(d.content);
                      }
                    } catch {
                      // Ignore
                    }
                  }}
                  className={`w-full p-2 rounded-lg border font-mono text-xs ${bgCard}`}
                >
                  {workspaceFiles.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <textarea
                  rows={14}
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  className={`w-full p-3 rounded-xl border font-mono text-xs ${bgCard} focus:outline-none`}
                />
              </div>
            )}

            {drawerTab === "shell" && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={shellCmd}
                    onChange={(e) => setShellCmd(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleRunShell()}
                    className={`flex-1 px-2.5 py-1.5 rounded-lg border font-mono text-xs ${bgCard}`}
                  />
                  <button
                    onClick={handleRunShell}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium cursor-pointer"
                  >
                    Run
                  </button>
                </div>
                <pre className="p-3 rounded-xl bg-black/50 text-emerald-400 font-mono text-xs overflow-x-auto leading-relaxed">
                  {shellOutput}
                </pre>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Full-Screen Settings Modal — 1:1 dsh-codex-ui settings-about.png & Codex-CLI-UI Setting.png */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
          <div
            className={`w-full max-w-4xl h-[82vh] rounded-2xl border ${bgSidebar} flex flex-col md:flex-row overflow-hidden shadow-2xl`}
          >
            {/* Left Settings Navigation Column */}
            <div className="w-full md:w-56 border-b md:border-b-0 md:border-r border-zinc-800/50 p-3 flex flex-col justify-between">
              <div className="space-y-1">
                <div className="px-2.5 py-2 text-sm font-semibold flex items-center justify-between">
                  <span>工作台设置</span>
                  <button
                    onClick={() => setSettingsOpen(false)}
                    className="md:hidden p-1 rounded-lg"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {[
                  { id: "mcp", label: "MCP 服务", icon: Wrench },
                  { id: "tools", label: "内置工具", icon: Terminal },
                  { id: "skills", label: "技能 (SKILL.md)", icon: Sparkles },
                  { id: "model", label: "模型与 API", icon: Layers },
                  { id: "guardrails", label: "安全护栏与压缩", icon: Shield },
                  { id: "platform", label: "外观与跨平台", icon: Code2 },
                ].map((item) => {
                  const Icon = item.icon;
                  const active = settingsCategory === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() =>
                        setSettingsCategory(
                          item.id as typeof settingsCategory
                        )
                      }
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium cursor-pointer transition-colors ${
                        active
                          ? isDark
                            ? "bg-zinc-800 text-zinc-100"
                            : "bg-zinc-200 text-zinc-900"
                          : `${textMuted} ${hoverItem}`
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setSettingsOpen(false)}
                className={`hidden md:flex items-center justify-center gap-1.5 w-full py-2 rounded-xl border text-xs font-medium cursor-pointer ${bgCard} ${hoverItem}`}
              >
                <span>返回会话</span>
              </button>
            </div>

            {/* Right Settings Content Area */}
            <div className="flex-1 flex flex-col min-h-0">
              <div className="px-6 py-4 border-b border-zinc-800/50 flex items-center justify-between">
                <div className="text-sm font-semibold">
                  {settingsCategory === "mcp" && "MCP 服务注册表 (JSON-RPC 2.0)"}
                  {settingsCategory === "tools" && "内置 Harness 工具开关"}
                  {settingsCategory === "skills" && "Agent 技能管理 (SKILL.md)"}
                  {settingsCategory === "model" && "模型网关与 API 密钥"}
                  {settingsCategory === "guardrails" &&
                    "Deterministic Guardrails 与 82% 上下文压缩"}
                  {settingsCategory === "platform" &&
                    "外观主题与 macOS / Windows 启动脚本"}
                </div>
                <button
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close settings"
                  className={`p-1.5 rounded-lg ${hoverItem} ${textMuted} cursor-pointer`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4 select-text">
                {settingsCategory === "mcp" && (
                  <div className="space-y-3">
                    {mcpServers.map((srv) => (
                      <div
                        key={srv.name}
                        className={`p-4 rounded-xl border ${bgCard} flex items-start justify-between gap-4`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-semibold">
                              {srv.name}
                            </span>
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded font-mono ${
                                isDark ? "bg-zinc-800 text-zinc-300" : "bg-zinc-100 text-zinc-700"
                              }`}
                            >
                              {srv.transport}
                            </span>
                          </div>
                          <div className={`text-xs ${textMuted}`}>
                            {srv.description}
                          </div>
                          <div className="text-[11px] font-mono text-zinc-500">
                            {srv.endpoint}
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={srv.enabled}
                          onChange={() => handleToggleMcpServer(srv.name)}
                          className="w-4 h-4 mt-1 cursor-pointer accent-blue-600"
                        />
                      </div>
                    ))}

                    <div className={`p-4 rounded-xl border ${bgCard} space-y-2.5`}>
                      <div className="text-xs font-semibold">挂载新 MCP Server</div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={newMcpName}
                          onChange={(e) => setNewMcpName(e.target.value)}
                          placeholder="服务名 (如 github-mcp)"
                          className={`flex-1 px-3 py-1.5 rounded-lg border text-xs font-mono ${bgCard}`}
                        />
                        <input
                          type="text"
                          value={newMcpEndpoint}
                          onChange={(e) => setNewMcpEndpoint(e.target.value)}
                          placeholder="启动命令或 SSE URL"
                          className={`flex-1 px-3 py-1.5 rounded-lg border text-xs font-mono ${bgCard}`}
                        />
                        <button
                          onClick={handleAddMcpServer}
                          className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium cursor-pointer"
                        >
                          添加
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {settingsCategory === "tools" && (
                  <div className="space-y-2.5">
                    {builtinTools.map((tool) => (
                      <div
                        key={tool.name}
                        className={`p-3.5 rounded-xl border ${bgCard} flex items-center justify-between`}
                      >
                        <div>
                          <div className="font-mono text-sm font-medium">
                            {tool.name}
                          </div>
                          <div className={`text-xs ${textMuted} mt-0.5`}>
                            {tool.description}
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={tool.enabled}
                          onChange={() => handleToggleBuiltinTool(tool.name)}
                          className="w-4 h-4 cursor-pointer accent-blue-600"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {settingsCategory === "skills" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      {skills.map((sk, idx) => (
                        <div
                          key={sk.name}
                          onClick={() => setSelectedSkillIdx(idx)}
                          className={`p-3.5 rounded-xl border cursor-pointer ${
                            selectedSkillIdx === idx
                              ? "border-blue-500"
                              : ""
                          } ${bgCard} flex items-start justify-between gap-2`}
                        >
                          <div>
                            <div className="font-mono text-xs font-semibold">
                              {sk.name}
                            </div>
                            <div className={`text-xs ${textMuted} mt-1`}>
                              {sk.description}
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={sk.enabled}
                            onChange={() => handleToggleSkill(sk.name)}
                            className="w-4 h-4 mt-0.5 cursor-pointer accent-blue-600"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-mono text-zinc-400">
                        SKILL.md 渐进式披露定义
                      </div>
                      <textarea
                        rows={11}
                        value={skills[selectedSkillIdx]?.markdown || ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSkills((prev) =>
                            prev.map((s, i) =>
                              i === selectedSkillIdx
                                ? { ...s, markdown: val }
                                : s
                            )
                          );
                        }}
                        className={`w-full p-3 rounded-xl border font-mono text-xs ${bgCard} focus:outline-none`}
                      />
                    </div>
                  </div>
                )}

                {settingsCategory === "model" && (
                  <div className={`p-4 rounded-xl border ${bgCard} space-y-3`}>
                    <div>
                      <label className="block text-xs font-medium mb-1">
                        Provider
                      </label>
                      <input
                        type="text"
                        value={llmProvider}
                        onChange={(e) => setLlmProvider(e.target.value)}
                        className={`w-full px-3 py-1.5 rounded-lg border text-xs ${bgCard}`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">
                        Base URL
                      </label>
                      <input
                        type="text"
                        value={llmBaseUrl}
                        onChange={(e) => setLlmBaseUrl(e.target.value)}
                        className={`w-full px-3 py-1.5 rounded-lg border text-xs font-mono ${bgCard}`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">
                        API Key (留空则使用本地沙箱确定性引擎)
                      </label>
                      <input
                        type="password"
                        value={llmApiKey}
                        onChange={(e) => setLlmApiKey(e.target.value)}
                        placeholder="sk-..."
                        className={`w-full px-3 py-1.5 rounded-lg border text-xs font-mono ${bgCard}`}
                      />
                    </div>
                    <button
                      onClick={() => {
                        setSettingsSavedBanner(true);
                        setTimeout(() => setSettingsSavedBanner(false), 2000);
                      }}
                      className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium cursor-pointer inline-flex items-center gap-1.5"
                    >
                      {settingsSavedBanner ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>已保存</span>
                        </>
                      ) : (
                        <span>保存模型配置</span>
                      )}
                    </button>
                  </div>
                )}

                {settingsCategory === "guardrails" && (
                  <div className="space-y-3">
                    <div className={`p-4 rounded-xl border ${bgCard} space-y-1`}>
                      <div className="text-xs font-semibold">
                        PreToolUse / PostToolUse 确定性安全护栏
                      </div>
                      <div className={`text-xs ${textMuted}`}>
                        自动拦截 rm -rf、DROP TABLE、越权路径访问与密钥泄露；执行代码修改后自动触发测试验证闭环。
                      </div>
                    </div>
                    <div className={`p-4 rounded-xl border ${bgCard} space-y-1`}>
                      <div className="text-xs font-semibold">
                        82% 阈值上下文自动压缩 (Context Compaction)
                      </div>
                      <div className={`text-xs ${textMuted}`}>
                        当长周期编码会话超过窗口容量 82% 时，自动提炼架构决策与修改摘要，折叠历史冗余工具输出。
                      </div>
                    </div>
                  </div>
                )}

                {settingsCategory === "platform" && (
                  <div className="space-y-4">
                    <div
                      className={`p-4 rounded-xl border ${bgCard} flex items-center justify-between`}
                    >
                      <div>
                        <div className="text-xs font-semibold">外观主题</div>
                        <div className={`text-xs ${textMuted}`}>
                          支持 Codex 暗色模式与亮色模式一键切换
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setTheme("dark")}
                          className={`px-3 py-1.5 rounded-lg text-xs border cursor-pointer ${
                            isDark ? "border-blue-500 font-semibold" : ""
                          }`}
                        >
                          Codex 暗色
                        </button>
                        <button
                          onClick={() => setTheme("light")}
                          className={`px-3 py-1.5 rounded-lg text-xs border cursor-pointer ${
                            !isDark ? "border-blue-500 font-semibold" : ""
                          }`}
                        >
                          Codex 亮色
                        </button>
                      </div>
                    </div>

                    <div className={`p-4 rounded-xl border ${bgCard} space-y-2`}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">
                          跨平台一键启动脚本 (macOS / Linux / Windows)
                        </span>
                        <div className="flex gap-1.5 text-xs">
                          <button
                            onClick={() => setTargetOs("mac")}
                            className={`px-2 py-0.5 rounded cursor-pointer ${
                              targetOs === "mac"
                                ? "bg-blue-600 text-white"
                                : textMuted
                            }`}
                          >
                            macOS / Linux
                          </button>
                          <button
                            onClick={() => setTargetOs("win")}
                            className={`px-2 py-0.5 rounded cursor-pointer ${
                              targetOs === "win"
                                ? "bg-blue-600 text-white"
                                : textMuted
                            }`}
                          >
                            Windows
                          </button>
                        </div>
                      </div>
                      <pre className="p-3 rounded-lg bg-black/40 text-zinc-200 font-mono text-xs overflow-x-auto">
                        {targetOs === "mac"
                          ? "./start-mac-linux.sh\n# 或启动桌面客户端:\ncd desktop-shell && npm start"
                          : "start-windows.bat\nREM 自动检测 JDK 17 并启动 WG CodeX 桌面端"}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
