package com.wangguoai.harness.api;

import com.wangguoai.harness.context.ContextCompactorService;
import com.wangguoai.harness.guard.HookGuardrailService;
import com.wangguoai.harness.kernel.AgentLoopEngine;
import com.wangguoai.harness.mcp.McpToolRegistryService;
import com.wangguoai.harness.memory.DecayMemoryStore;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;
import java.util.Map;

/**
 * WG Harness Studio REST & SSE 统一控制面接口
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
        return Map.of(
                "application", "wg-harness-studio",
                "version", "0.3.0",
                "javaVersion", System.getProperty("java.version"),
                "effectiveMode", loopEngine.getEffectiveMode(),
                "policies", List.of("workspace-write", "read-only", "full-access"),
                "skillsCount", mcpRegistry.listSkills().size(),
                "memoriesCount", memoryStore.listAll().size(),
                "auditCount", guardrails.getRecentAuditLog().size()
        );
    }

    @GetMapping(value = "/run/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamAgentRun(
            @RequestParam(defaultValue = "bugfix") String scenario,
            @RequestParam(defaultValue = "") String prompt,
            @RequestParam(defaultValue = "workspace-write") String policy
    ) {
        return loopEngine.startStreamingRun(scenario, prompt, policy);
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

    @GetMapping("/skills")
    public List<McpToolRegistryService.SkillCard> listSkills() {
        return mcpRegistry.listSkills();
    }

    @PostMapping("/mcp/rpc")
    public Map<String, Object> callMcpRpc(@RequestBody Map<String, Object> rpcRequest) {
        return mcpRegistry.handleJsonRpc(rpcRequest);
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
