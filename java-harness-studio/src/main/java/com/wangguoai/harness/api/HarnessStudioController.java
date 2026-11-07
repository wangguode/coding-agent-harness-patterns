package com.wangguoai.harness.api;

import com.wangguoai.harness.context.ContextCompactorService;
import com.wangguoai.harness.guard.HookGuardrailService;
import com.wangguoai.harness.kernel.AgentLoopEngine;
import com.wangguoai.harness.mcp.McpToolRegistryService;
import com.wangguoai.harness.memory.DecayMemoryStore;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * WG CodeX Studio REST & SSE 统一控制面接口（支持 Tools/MCP/Skills 动态增删改查与 Mac/Windows 跨平台终端）
 */
@RestController
@RequestMapping("/api")
public class HarnessStudioController {

    private final AgentLoopEngine loopEngine;
    private final HookGuardrailService guardrails;
    private final ContextCompactorService compactor;
    private final McpToolRegistryService mcpRegistry;
    private final DecayMemoryStore memoryStore;

    public HarnessStudioController(
            AgentLoopEngine loopEngine,
            HookGuardrailService guardrails,
            ContextCompactorService compactor,
            McpToolRegistryService mcpRegistry,
            DecayMemoryStore memoryStore
    ) {
        this.loopEngine = loopEngine;
        this.guardrails = guardrails;
        this.compactor = compactor;
        this.mcpRegistry = mcpRegistry;
        this.memoryStore = memoryStore;
    }

    @GetMapping("/overview")
    public Map<String, Object> overview() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("application", "wg-codex-studio");
        out.put("version", "0.5.0");
        out.put("javaVersion", System.getProperty("java.version"));
        out.put("osName", System.getProperty("os.name"));
        out.put("osArch", System.getProperty("os.arch"));
        out.put("platforms", List.of("macOS (Apple Silicon / Intel)", "Windows 10/11 (PowerShell / WSL2)", "Linux (x64 / ARM64)"));
        out.put("effectiveMode", loopEngine.getEffectiveMode());
        out.put("policies", List.of("workspace-write", "read-only", "full-access"));
        out.put("skillsCount", mcpRegistry.listSkills().size());
        out.put("builtInToolsCount", mcpRegistry.listBuiltInTools().size());
        out.put("mcpServersCount", mcpRegistry.listMcpServers().size());
        out.put("memoriesCount", memoryStore.listAll().size());
        out.put("auditCount", guardrails.getRecentAuditLog().size());
        out.put("llmConfig", loopEngine.getLlmConfigSummary());
        return out;
    }

    @GetMapping("/settings/llm")
    public Map<String, Object> getLlmSettings() {
        return loopEngine.getLlmConfigSummary();
    }

    @PostMapping("/settings/llm")
    public Map<String, Object> updateLlmSettings(@RequestBody Map<String, Object> body) {
        String runMode = String.valueOf(body.getOrDefault("runMode", "cloud"));
        String baseUrl = String.valueOf(body.getOrDefault("baseUrl", "https://api.deepseek.com/v1"));
        String apiKey = String.valueOf(body.getOrDefault("apiKey", ""));
        String model = String.valueOf(body.getOrDefault("model", "deepseek-chat"));
        loopEngine.updateLlmConfig(runMode, baseUrl, apiKey, model);
        return loopEngine.getLlmConfigSummary();
    }

    @GetMapping("/workspace/files")
    public List<AgentLoopEngine.WorkspaceArtifact> listWorkspaceFiles(
            @RequestParam(defaultValue = "") String root
    ) {
        return loopEngine.getWorkspaceArtifacts(root);
    }

    @GetMapping("/workspace/read")
    public Map<String, Object> readWorkspaceFile(
            @RequestParam(defaultValue = "") String root,
            @RequestParam String path
    ) {
        return loopEngine.readRealWorkspaceFile(root, path);
    }

    @PostMapping("/workspace/write")
    public Map<String, Object> writeWorkspaceFile(@RequestBody Map<String, Object> body) {
        String root = String.valueOf(body.getOrDefault("root", ""));
        String path = String.valueOf(body.getOrDefault("path", ""));
        String content = String.valueOf(body.getOrDefault("content", ""));
        return loopEngine.writeRealWorkspaceFile(root, path, content);
    }

    @GetMapping(value = "/run/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamAgentRun(
            @RequestParam(defaultValue = "bugfix") String scenario,
            @RequestParam(defaultValue = "") String prompt,
            @RequestParam(defaultValue = "workspace-write") String policy,
            @RequestParam(defaultValue = "") String workspace
    ) {
        return loopEngine.startStreamingRun(scenario, prompt, policy, workspace);
    }

    @PostMapping("/approvals/{approvalId}/decide")
    public Map<String, Object> decideApproval(
            @PathVariable String approvalId,
            @RequestBody Map<String, Object> body
    ) {
        boolean approved = Boolean.TRUE.equals(body.get("approved"));
        boolean resolved = loopEngine.decideApproval(approvalId, approved);
        return Map.of("approvalId", approvalId, "approved", approved, "resolved", resolved);
    }

    @PostMapping("/compact/simulate")
    public ContextCompactorService.CompactionReport simulateCompaction(@RequestBody(required = false) Map<String, Object> body) {
        int window = body != null && body.containsKey("windowLimit")
                ? ((Number) body.get("windowLimit")).intValue()
                : 2400;
        return compactor.simulateLongRefactoringSession(window);
    }

    @PostMapping("/hooks/evaluate")
    public Map<String, Object> evaluateHook(@RequestBody Map<String, Object> body) {
        String policy = String.valueOf(body.getOrDefault("policy", "workspace-write"));
        String command = String.valueOf(body.getOrDefault("command", "pytest -q"));
        String mockOutput = String.valueOf(body.getOrDefault("sampleOutput", ""));
        HookGuardrailService.HookDecision decision = guardrails.evaluatePreToolUse(
                policy, "bash", true, Map.of("command", command)
        );
        return Map.of(
                "decision", decision,
                "redactedSampleOutput", guardrails.redactSecrets(mockOutput),
                "auditLog", guardrails.getRecentAuditLog()
        );
    }

    @GetMapping("/audit")
    public List<HookGuardrailService.AuditRecord> auditLog() {
        return guardrails.getRecentAuditLog();
    }

    // ==================== Skills 动态管理 API ====================

    @GetMapping("/skills")
    public List<McpToolRegistryService.SkillCard> listSkills() {
        return mcpRegistry.listSkills();
    }

    @PostMapping("/skills/toggle")
    public McpToolRegistryService.SkillCard toggleSkill(@RequestBody Map<String, Object> body) {
        String name = String.valueOf(body.getOrDefault("name", ""));
        boolean enabled = Boolean.TRUE.equals(body.get("enabled"));
        return mcpRegistry.toggleSkill(name, enabled);
    }

    @PostMapping("/skills/save")
    public McpToolRegistryService.SkillCard saveSkill(@RequestBody Map<String, Object> body) {
        return mcpRegistry.saveSkill(body);
    }

    @DeleteMapping("/skills/{name}")
    public Map<String, Object> deleteSkill(@PathVariable String name) {
        boolean removed = mcpRegistry.deleteSkill(name);
        return Map.of("name", name, "deleted", removed);
    }

    // ==================== Built-in Tools & MCP Servers 动态管理 API ====================

    @GetMapping("/mcp/tools")
    public List<McpToolRegistryService.BuiltInTool> listBuiltInTools() {
        return mcpRegistry.listBuiltInTools();
    }

    @PostMapping("/mcp/tools/toggle")
    public McpToolRegistryService.BuiltInTool toggleBuiltInTool(@RequestBody Map<String, Object> body) {
        String name = String.valueOf(body.getOrDefault("name", ""));
        boolean enabled = Boolean.TRUE.equals(body.get("enabled"));
        return mcpRegistry.toggleBuiltInTool(name, enabled);
    }

    @GetMapping("/mcp/servers")
    public List<McpToolRegistryService.McpServerConfig> listMcpServers() {
        return mcpRegistry.listMcpServers();
    }

    @PostMapping("/mcp/servers/toggle")
    public McpToolRegistryService.McpServerConfig toggleMcpServer(@RequestBody Map<String, Object> body) {
        String name = String.valueOf(body.getOrDefault("name", ""));
        boolean enabled = Boolean.TRUE.equals(body.get("enabled"));
        return mcpRegistry.toggleMcpServer(name, enabled);
    }

    @PostMapping("/mcp/servers/add")
    public McpToolRegistryService.McpServerConfig addMcpServer(@RequestBody Map<String, Object> body) {
        return mcpRegistry.upsertMcpServer(body);
    }

    @DeleteMapping("/mcp/servers/{name}")
    public Map<String, Object> deleteMcpServer(@PathVariable String name) {
        boolean removed = mcpRegistry.deleteMcpServer(name);
        return Map.of("name", name, "deleted", removed);
    }

    @PostMapping("/mcp/rpc")
    public Map<String, Object> callMcpRpc(@RequestBody Map<String, Object> rpcRequest) {
        return mcpRegistry.handleJsonRpc(rpcRequest);
    }

    // ==================== 跨平台终端模拟与护栏审计执行 API ====================

    @PostMapping("/shell/exec")
    public Map<String, Object> execShellCommand(@RequestBody Map<String, Object> body) {
        String command = String.valueOf(body.getOrDefault("command", "mvn -q test")).trim();
        String policy = String.valueOf(body.getOrDefault("policy", "workspace-write")).trim();
        String osType = String.valueOf(body.getOrDefault("osType", System.getProperty("os.name"))).trim();

        HookGuardrailService.HookDecision decision = guardrails.evaluatePreToolUse(
                policy, "bash", true, Map.of("command", command)
        );
        if (!"ALLOW".equals(decision.action())) {
            return Map.of(
                    "command", command,
                    "osType", osType,
                    "status", decision.action(),
                    "exitCode", 126,
                    "output", "[PreToolUse Guardrail " + decision.action() + "] " + decision.reason(),
                    "timestamp", Instant.now().toString()
            );
        }

        String output;
        if (command.contains("mvn") && command.contains("test")) {
            output = """
                    [INFO] Scanning for projects...
                    [INFO] ------------------< com.wangguoai:wg-harness-studio >-------------------
                    [INFO] Building WG CodeX Harness Studio (Java 17) 0.5.0
                    [INFO] --- surefire:3.2.5:test (default-test) @ wg-harness-studio ---
                    [INFO] Running com.wangguoai.harness.HarnessStudioApplicationTests
                    [INFO] Tests run: 5, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.42 s
                    [INFO] BUILD SUCCESS""";
        } else if (command.contains("pytest")) {
            output = """
                    ============================= test session starts ==============================
                    platform darwin -- Python 3.11.9, pytest-8.2.0
                    collected 6 items
                    tests/test_rate_limiter.py ......                                        [100%]
                    ============================== 6 passed in 0.14s ================================""";
        } else if (command.contains("git status")) {
            output = """
                    On branch main
                    Your branch is up to date with 'origin/main'.

                    Changes not staged for commit:
                      modified:   src/gateway/rate_limiter.py
                      modified:   src/agent/loop_runner.py
                      modified:   src/voice/rtp_ring_buffer.py""";
        } else {
            output = "$ " + command + "\n[WG CodeX Cross-Platform Sandbox (" + osType + ")] Command executed cleanly (exitCode=0).";
        }

        return Map.of(
                "command", command,
                "osType", osType,
                "status", "ALLOW",
                "exitCode", 0,
                "output", guardrails.redactSecrets(output),
                "timestamp", Instant.now().toString()
        );
    }

    @GetMapping("/memory/list")
    public List<DecayMemoryStore.Observation> listMemories() {
        return memoryStore.listAll();
    }

    @PostMapping("/memory/add")
    public DecayMemoryStore.Observation addMemory(@RequestBody Map<String, Object> body) {
        String kind = String.valueOf(body.getOrDefault("kind", "DECISION"));
        String text = String.valueOf(body.getOrDefault("text", ""));
        double importance = ((Number) body.getOrDefault("importance", 0.85)).doubleValue();
        return memoryStore.addObservation(kind, text, importance);
    }

    @GetMapping("/memory/recall")
    public List<DecayMemoryStore.ScoredMemory> recallMemory(
            @RequestParam(defaultValue = "网关滑窗限流器高并发边界") String query,
            @RequestParam(defaultValue = "4") int topK
    ) {
        return memoryStore.recallTopK(query, topK);
    }
}
