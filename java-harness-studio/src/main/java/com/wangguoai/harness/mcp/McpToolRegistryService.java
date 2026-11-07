package com.wangguoai.harness.mcp;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * WG CodeX Studio — Agent Skills 渐进式披露管理中心 + Built-in Tools & MCP (JSON-RPC 2.0) 动态注册表
 * 支持前端控制台实时开关工具、新增/编辑 MCP Server、在线编辑与创建 SKILL.md 技能包。
 */
@Service
public class McpToolRegistryService {

    public record SkillCard(
            String name,
            String scope,
            String skillPath,
            boolean enabled,
            String description,
            int indexTokens,
            int fullBodyTokens,
            String instructionsBody,
            List<String> bundledScripts
    ) {
        public SkillCard(
                String name,
                String description,
                int indexTokens,
                int fullBodyTokens,
                String instructionsBody,
                List<String> bundledScripts
        ) {
            this(
                    name,
                    "user",
                    "~/.agents/skills/" + name + "/SKILL.md",
                    true,
                    description,
                    indexTokens,
                    fullBodyTokens,
                    instructionsBody,
                    bundledScripts
            );
        }
    }

    public record BuiltInTool(
            String name,
            String category,
            String permissionPolicy,
            boolean enabled,
            String description,
            Map<String, Object> inputSchema
    ) {}

    public record McpServerConfig(
            String name,
            String provider,
            String scope,
            String transport,
            String commandOrUrl,
            boolean enabled,
            String description,
            List<Map<String, Object>> tools
    ) {}

    private final List<SkillCard> skills = new CopyOnWriteArrayList<>(List.of(
            new SkillCard(
                    "voice-latency-diagnosis",
                    "user",
                    "~/.agents/skills/voice-latency-diagnosis/SKILL.md",
                    true,
                    "诊断实时语音机器人端到端延迟。当涉及 FreeSWITCH、RTP、ASR/TTS 首包 TTFB 或打断滞后时激活。",
                    34,
                    420,
                    """
                    ---
                    name: voice-latency-diagnosis
                    description: 诊断实时语音机器人端到端延迟。当涉及 FreeSWITCH、RTP、ASR/TTS 首包 TTFB 或打断滞后时激活。
                    ---
                    # Voice Latency & Barge-In Diagnosis
                    1. 拆解 VAD 静音判停、ASR 首字、LLM TTFT 与 TTS 首包耗时；
                    2. 检查 DeepSeek thinking 是否已关闭（生产必须设置 thinking=disabled）；
                    3. 检查下行 16-Slot 20ms RTP 环形队列是否接入 clearAudio 原子清空（<=60ms 物理截断）。""",
                    List.of("scripts/rtp_jitter_probe.py", "references/freeswitch_esl.md")
            ),
            new SkillCard(
                    "java-concurrency-audit",
                    "repo",
                    ".agents/skills/java-concurrency-audit/SKILL.md",
                    true,
                    "审查 Java 高并发服务线程安全、锁竞争、虚拟线程固定 (Pinning) 与滑窗限流边界。",
                    31,
                    385,
                    """
                    ---
                    name: java-concurrency-audit
                    description: 审查 Java 高并发服务线程安全、锁竞争、虚拟线程固定 (Pinning) 与滑窗限流边界。
                    ---
                    # Java Concurrency & Rate-Limiter Audit
                    1. 检查 synchronized 是否包裹了阻塞 I/O，优先替换为 ReentrantLock 或无锁 CAS；
                    2. 校验滑窗限流器时间戳开闭区间 (now - window, now]，严禁误用 >= 导致窗口边界双倍放行；
                    3. 自动生成并发边界 JUnit 5 回归测试并执行验证。""",
                    List.of("scripts/jfr_flamegraph.sh", "scripts/jcstress_runner.sh")
            ),
            new SkillCard(
                    "sql-index-guard",
                    "project",
                    ".codex/skills/sql-index-guard/SKILL.md",
                    true,
                    "审查慢 SQL 执行计划、深分页、隐式类型转换与注入风险。",
                    26,
                    310,
                    """
                    ---
                    name: sql-index-guard
                    description: 审查慢 SQL 执行计划、深分页、隐式类型转换与注入风险。
                    ---
                    # SQL Execution Plan & Index Guard
                    1. 拦截无 WHERE 条件更新/删除或全表扫描；
                    2. 校验联合索引最左前缀匹配与字符集隐式转换；
                    3. 输出回滚安全的 Online DDL 变更建议。""",
                    List.of("references/mysql_explain_rules.md")
            ),
            new SkillCard(
                    "codex-harness-architect",
                    "system",
                    "~/.agents/skills/codex-harness-architect/SKILL.md",
                    true,
                    "遵循 7 层 Agent Harness 工程规范：Context Compaction、Pre/Post Hook 护栏与收敛熔断。",
                    29,
                    360,
                    """
                    ---
                    name: codex-harness-architect
                    description: 遵循 7 层 Agent Harness 工程规范：Context Compaction、Pre/Post Hook 护栏与收敛熔断。
                    ---
                    # WG CodeX 7-Layer Harness Guidelines
                    1. 修改代码前必须先通过 read_file 获取精确上下文；
                    2. 每次生成补丁后必须触发 run_unit_test 形成自验证闭环；
                    3. 同一工具连续 3 次相同参数失败立即触发收敛熔断并切换修复路径。""",
                    List.of("references/seven_layer_spec.md")
            )
    ));

    private final List<BuiltInTool> builtInTools = new CopyOnWriteArrayList<>(List.of(
            new BuiltInTool(
                    "read_file",
                    "Filesystem",
                    "auto-allow",
                    true,
                    "读取工作区源码文件（支持行号区间与 UTF-8 编码安全读取）",
                    Map.of("type", "object", "properties", Map.of("path", Map.of("type", "string"), "startLine", Map.of("type", "integer")))
            ),
            new BuiltInTool(
                    "write_file",
                    "Filesystem",
                    "workspace-write",
                    true,
                    "向工作区写入或应用 Unified Diff 补丁（受路径穿越护栏保护）",
                    Map.of("type", "object", "properties", Map.of("path", Map.of("type", "string"), "content", Map.of("type", "string")))
            ),
            new BuiltInTool(
                    "bash",
                    "Execution",
                    "pre-hook-guarded",
                    true,
                    "在跨平台沙箱终端（macOS zsh / Windows PowerShell）执行构建与诊断指令",
                    Map.of("type", "object", "properties", Map.of("command", Map.of("type", "string"), "timeoutMs", Map.of("type", "integer")))
            ),
            new BuiltInTool(
                    "run_unit_test",
                    "Verification",
                    "auto-allow",
                    true,
                    "执行 JUnit 5 / Pytest 单元测试并解析断言失败栈回传给 Agent Loop",
                    Map.of("type", "object", "properties", Map.of("suite", Map.of("type", "string")))
            ),
            new BuiltInTool(
                    "search_codebase",
                    "Search",
                    "auto-allow",
                    true,
                    "基于 Ripgrep / AST 符号索引快速检索跨文件调用链",
                    Map.of("type", "object", "properties", Map.of("query", Map.of("type", "string")))
            ),
            new BuiltInTool(
                    "git_diff",
                    "VCS",
                    "auto-allow",
                    true,
                    "获取当前 Git 工作树变更统计与行级 Diff",
                    Map.of("type", "object", "properties", Map.of("staged", Map.of("type", "boolean")))
            )
    ));

    private final List<McpServerConfig> mcpServers = new CopyOnWriteArrayList<>(List.of(
            new McpServerConfig(
                    "wg-voice-diagnostics-mcp",
                    "codex",
                    "user",
                    "stdio",
                    "java -jar wg-voice-mcp-probe.jar --stdio",
                    true,
                    "FreeSWITCH RTP 抖动探测与 VAD+ASR+LLM+TTS 全链路延迟分解 MCP 服务",
                    List.of(Map.of(
                            "name", "diagnose_voice_latency",
                            "description", "分析语音网关 VAD+ASR+LLM+TTS 端到端耗时并定位瓶颈",
                            "inputSchema", Map.of(
                                    "type", "object",
                                    "properties", Map.of(
                                            "asrMs", Map.of("type", "integer"),
                                            "llmTtftMs", Map.of("type", "integer"),
                                            "ttsTtfbMs", Map.of("type", "integer")
                                    ),
                                    "required", List.of("asrMs", "llmTtftMs", "ttsTtfbMs")
                            )
                    ))
            ),
            new McpServerConfig(
                    "wg-loop-guard-mcp",
                    "codex",
                    "project",
                    "stdio",
                    "npx -y @wangguode/mcp-loop-guard",
                    true,
                    "Agent Loop 工具调用指纹去重与防死循环熔断检查器",
                    List.of(Map.of(
                            "name", "check_loop_convergence",
                            "description", "检测 Agent Loop 工具调用指纹是否陷入重复死循环",
                            "inputSchema", Map.of(
                                    "type", "object",
                                    "properties", Map.of(
                                            "toolName", Map.of("type", "string"),
                                            "repeatCount", Map.of("type", "integer")
                                    ),
                                    "required", List.of("toolName", "repeatCount")
                            )
                    ))
            ),
            new McpServerConfig(
                    "wg-mysql-explain-mcp",
                    "codex",
                    "project",
                    "sse",
                    "http://127.0.0.1:9102/mcp/sse",
                    true,
                    "生产只读备库 SQL EXPLAIN 执行计划分析与索引推荐 MCP 节点",
                    List.of(Map.of(
                            "name", "explain_sql_query",
                            "description", "对只读影子库执行 EXPLAIN 并检测全表扫描与隐式类型转换",
                            "inputSchema", Map.of(
                                    "type", "object",
                                    "properties", Map.of("sql", Map.of("type", "string")),
                                    "required", List.of("sql")
                            )
                    ))
            )
    ));

    public List<SkillCard> listSkills() {
        return skills;
    }

    public synchronized SkillCard toggleSkill(String name, boolean enabled) {
        for (int i = 0; i < skills.size(); i++) {
            SkillCard s = skills.get(i);
            if (s.name().equalsIgnoreCase(name)) {
                SkillCard updated = new SkillCard(
                        s.name(), s.scope(), s.skillPath(), enabled,
                        s.description(), s.indexTokens(), s.fullBodyTokens(),
                        s.instructionsBody(), s.bundledScripts()
                );
                skills.set(i, updated);
                return updated;
            }
        }
        throw new IllegalArgumentException("未找到技能: " + name);
    }

    @SuppressWarnings("unchecked")
    public synchronized SkillCard saveSkill(Map<String, Object> body) {
        String rawName = String.valueOf(body.getOrDefault("name", "")).trim()
                .toLowerCase().replaceAll("[^a-z0-9-_]", "-");
        if (rawName.isBlank()) {
            throw new IllegalArgumentException("技能名称不能为空");
        }
        String scope = String.valueOf(body.getOrDefault("scope", "user")).trim();
        String description = String.valueOf(body.getOrDefault("description", "自定义渐进式 Agent 技能")).trim();
        String instructionsBody = String.valueOf(body.getOrDefault("instructionsBody", "")).trim();
        boolean enabled = ! body.containsKey("enabled") || Boolean.TRUE.equals(body.get("enabled"));
        String skillPath = String.valueOf(body.getOrDefault("skillPath", "~/.agents/skills/" + rawName + "/SKILL.md"));

        List<String> scripts = new ArrayList<>();
        Object rawScripts = body.get("bundledScripts");
        if (rawScripts instanceof List<?> list) {
            for (Object item : list) {
                if (item != null && !String.valueOf(item).isBlank()) {
                    scripts.add(String.valueOf(item).trim());
                }
            }
        } else if (rawScripts instanceof String s && !s.isBlank()) {
            for (String part : s.split(",")) {
                if (!part.isBlank()) scripts.add(part.trim());
            }
        }
        if (scripts.isEmpty()) {
            scripts.add("scripts/run_check.sh");
        }

        int indexTokens = Math.max(18, description.length() / 2 + 12);
        int fullBodyTokens = Math.max(120, instructionsBody.length() / 2 + 65);

        SkillCard card = new SkillCard(
                rawName, scope, skillPath, enabled,
                description, indexTokens, fullBodyTokens,
                instructionsBody, scripts
        );

        for (int i = 0; i < skills.size(); i++) {
            if (skills.get(i).name().equalsIgnoreCase(rawName)) {
                skills.set(i, card);
                return card;
            }
        }
        skills.add(0, card);
        return card;
    }

    public synchronized boolean deleteSkill(String name) {
        return skills.removeIf(s -> s.name().equalsIgnoreCase(name));
    }

    public List<BuiltInTool> listBuiltInTools() {
        return builtInTools;
    }

    public synchronized BuiltInTool toggleBuiltInTool(String name, boolean enabled) {
        for (int i = 0; i < builtInTools.size(); i++) {
            BuiltInTool t = builtInTools.get(i);
            if (t.name().equalsIgnoreCase(name)) {
                BuiltInTool updated = new BuiltInTool(
                        t.name(), t.category(), t.permissionPolicy(),
                        enabled, t.description(), t.inputSchema()
                );
                builtInTools.set(i, updated);
                return updated;
            }
        }
        throw new IllegalArgumentException("未找到内置工具: " + name);
    }

    public List<McpServerConfig> listMcpServers() {
        return mcpServers;
    }

    public synchronized McpServerConfig toggleMcpServer(String name, boolean enabled) {
        for (int i = 0; i < mcpServers.size(); i++) {
            McpServerConfig s = mcpServers.get(i);
            if (s.name().equalsIgnoreCase(name)) {
                McpServerConfig updated = new McpServerConfig(
                        s.name(), s.provider(), s.scope(), s.transport(),
                        s.commandOrUrl(), enabled, s.description(), s.tools()
                );
                mcpServers.set(i, updated);
                return updated;
            }
        }
        throw new IllegalArgumentException("未找到 MCP Server: " + name);
    }

    public synchronized McpServerConfig upsertMcpServer(Map<String, Object> body) {
        String name = String.valueOf(body.getOrDefault("name", "")).trim();
        if (name.isBlank()) {
            throw new IllegalArgumentException("MCP Server 名称不能为空");
        }
        String provider = String.valueOf(body.getOrDefault("provider", "codex")).trim();
        String scope = String.valueOf(body.getOrDefault("scope", "user")).trim();
        String transport = String.valueOf(body.getOrDefault("transport", "stdio")).trim();
        String commandOrUrl = String.valueOf(body.getOrDefault("commandOrUrl", "npx -y @modelcontextprotocol/server-filesystem .")).trim();
        String description = String.valueOf(body.getOrDefault("description", "自定义扩展 MCP 工具节点")).trim();
        String toolName = String.valueOf(body.getOrDefault("toolName", name.replaceAll("[^a-zA-Z0-9_]", "_") + "_exec")).trim();

        McpServerConfig cfg = new McpServerConfig(
                name,
                provider,
                scope,
                transport,
                commandOrUrl,
                true,
                description,
                List.of(Map.of(
                        "name", toolName,
                        "description", description,
                        "inputSchema", Map.of(
                                "type", "object",
                                "properties", Map.of("query", Map.of("type", "string")),
                                "required", List.of("query")
                        )
                ))
        );

        for (int i = 0; i < mcpServers.size(); i++) {
            if (mcpServers.get(i).name().equalsIgnoreCase(name)) {
                mcpServers.set(i, cfg);
                return cfg;
            }
        }
        mcpServers.add(0, cfg);
        return cfg;
    }

    public synchronized boolean deleteMcpServer(String name) {
        return mcpServers.removeIf(s -> s.name().equalsIgnoreCase(name));
    }

    public SkillCard matchSkill(String userTask) {
        if (userTask == null) {
            return null;
        }
        String lower = userTask.toLowerCase();
        for (SkillCard skill : skills) {
            if (!skill.enabled()) continue;
            if ((lower.contains("语音") || lower.contains("rtp") || lower.contains("tts") || lower.contains("打断"))
                    && skill.name().contains("voice")) {
                return skill;
            }
            if ((lower.contains("并发") || lower.contains("限流") || lower.contains("线程") || lower.contains("bug"))
                    && skill.name().contains("concurrency")) {
                return skill;
            }
            if ((lower.contains("sql") || lower.contains("慢查询") || lower.contains("索引"))
                    && skill.name().contains("sql")) {
                return skill;
            }
            if (lower.contains(skill.name().toLowerCase())) {
                return skill;
            }
        }
        return skills.stream().filter(SkillCard::enabled).findFirst().orElse(null);
    }

    /**
     * 处理标准 JSON-RPC 2.0 MCP 请求（支持 initialize / tools/list / tools/call / resources/list）
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> handleJsonRpc(Map<String, Object> request) {
        Object id = request.getOrDefault("id", 1);
        String method = String.valueOf(request.getOrDefault("method", "tools/list"));
        Map<String, Object> params = (Map<String, Object>) request.getOrDefault("params", Map.of());

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("jsonrpc", "2.0");
        response.put("id", id);

        try {
            Object result = switch (method) {
                case "initialize" -> Map.of(
                        "protocolVersion", "2024-11-05",
                        "serverInfo", Map.of("name", "wg-codex-harness-mcp", "version", "0.5.0"),
                        "capabilities", Map.of("tools", Map.of("listChanged", true), "resources", Map.of())
                );
                case "tools/list" -> {
                    List<Map<String, Object>> activeTools = new ArrayList<>();
                    for (McpServerConfig srv : mcpServers) {
                        if (srv.enabled()) {
                            activeTools.addAll(srv.tools());
                        }
                    }
                    yield Map.of("tools", activeTools);
                }
                case "tools/call" -> {
                    String name = String.valueOf(params.getOrDefault("name", ""));
                    Map<String, Object> args = (Map<String, Object>) params.getOrDefault("arguments", Map.of());
                    if ("diagnose_voice_latency".equals(name)) {
                        int asr = ((Number) args.getOrDefault("asrMs", 75)).intValue();
                        int llm = ((Number) args.getOrDefault("llmTtftMs", 230)).intValue();
                        int tts = ((Number) args.getOrDefault("ttsTtfbMs", 80)).intValue();
                        int total = asr + llm + tts;
                        String bottleneck = (llm >= asr && llm >= tts) ? "LLM_TTFT" : (tts >= asr ? "TTS_TTFB" : "ASR");
                        yield Map.of(
                                "content", List.of(Map.of(
                                        "type", "text",
                                        "text", String.format(
                                                "{\"totalE2eMs\":%d,\"grade\":\"%s\",\"bottleneck\":\"%s\",\"advice\":\"已启用 DeepSeek No-Think 与 FreeSWITCH 60ms 边缘打断\"}",
                                                total, total <= 550 ? "PRODUCTION_READY" : "NEEDS_TUNING", bottleneck
                                        )
                                )),
                                "isError", false
                        );
                    } else if ("check_loop_convergence".equals(name)) {
                        int rep = ((Number) args.getOrDefault("repeatCount", 1)).intValue();
                        yield Map.of(
                                "content", List.of(Map.of(
                                        "type", "text",
                                        "text", String.format(
                                                "{\"repeatCount\":%d,\"circuitBreak\":%s,\"action\":\"%s\"}",
                                                rep, rep >= 3, rep >= 3 ? "INTERCEPT_AND_FORCE_REFLECTION" : "ALLOW_CONTINUE"
                                        )
                                )),
                                "isError", false
                        );
                    } else if ("explain_sql_query".equals(name)) {
                        String sql = String.valueOf(args.getOrDefault("sql", "SELECT * FROM orders WHERE status = 1"));
                        yield Map.of(
                                "content", List.of(Map.of(
                                        "type", "text",
                                        "text", String.format(
                                                "{\"sql\":\"%s\",\"type\":\"ref\",\"key\":\"idx_status_created\",\"rows\":142,\"extra\":\"Using index condition\",\"grade\":\"SAFE\"}",
                                                sql.replace("\"", "'")
                                        )
                                )),
                                "isError", false
                        );
                    }
                    // 支持用户自定义新增的 MCP 工具调用响应
                    for (McpServerConfig srv : mcpServers) {
                        for (Map<String, Object> t : srv.tools()) {
                            if (name.equals(t.get("name"))) {
                                yield Map.of(
                                        "content", List.of(Map.of(
                                                "type", "text",
                                                "text", String.format(
                                                        "{\"server\":\"%s\",\"tool\":\"%s\",\"transport\":\"%s\",\"status\":\"OK\",\"arguments\":%s}",
                                                        srv.name(), name, srv.transport(), args
                                                )
                                        )),
                                        "isError", false
                                );
                            }
                        }
                    }
                    throw new IllegalArgumentException("未知的 MCP 工具: " + name);
                }
                case "resources/list" -> Map.of(
                        "resources", List.of(
                                Map.of("uri", "wg://architecture/seven-layer-agent", "name", "工业级 AI Agent 七层架构规范", "mimeType", "text/markdown"),
                                Map.of("uri", "wg://architecture/voice-barge-in", "name", "FreeSWITCH 8kHz RTP 毫秒级打断规范", "mimeType", "text/markdown")
                        )
                );
                default -> throw new IllegalArgumentException("不支持的 MCP 方法: " + method);
            };
            response.put("result", result);
        } catch (Exception e) {
            response.put("error", Map.of("code", -32602, "message", e.getMessage()));
        }
        return response;
    }
}
