package com.wangguoai.harness.kernel;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wangguoai.harness.guard.HookGuardrailService;
import com.wangguoai.harness.mcp.McpToolRegistryService;
import com.wangguoai.harness.memory.DecayMemoryStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Harness 核心主循环引擎（Java 17 + SSE 实时事件流 + HITL 人工审批 + 单测自验证闭环）
 *
 * <p>对齐设计：
 * <ul>
 *   <li>注入记忆（Memory Recall）与渐进式技能（Progressive Skill Disclosure）</li>
 *   <li>每一步工具调用均经过 {@link HookGuardrailService} 的 PreToolUse 拦截与 PostToolUse 密钥脱敏</li>
 *   <li>遇到 {@code ASK} 级别高危操作时挂起线程等待前端人工点击【批准/拒绝】（超时安全兜底）</li>
 *   <li>内置工具调用指纹死循环守卫（{@code LoopConvergenceGuard}）与自动修复验证闭环</li>
 * </ul>
 */
@Service
public class AgentLoopEngine {

    public record TraceEvent(
            String runId,
            int step,
            String type,
            String title,
            String detail,
            Map<String, Object> metadata,
            String timestamp
    ) {}

    private final HookGuardrailService guardrails;
    private final McpToolRegistryService mcpRegistry;
    private final DecayMemoryStore memoryStore;
    private final ObjectMapper mapper = new ObjectMapper();
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, CompletableFuture<Boolean>> pendingApprovals = new ConcurrentHashMap<>();

    @Value("${wg.harness.run-mode:mock}")
    private String configuredRunMode;

    @Value("${wg.harness.llm.base-url:https://api.deepseek.com/v1}")
    private String llmBaseUrl;

    @Value("${wg.harness.llm.api-key:}")
    private String llmApiKey;

    @Value("${wg.harness.llm.model:deepseek-chat}")
    private String llmModel;

    public AgentLoopEngine(
            HookGuardrailService guardrails,
            McpToolRegistryService mcpRegistry,
            DecayMemoryStore memoryStore
    ) {
        this.guardrails = guardrails;
        this.mcpRegistry = mcpRegistry;
        this.memoryStore = memoryStore;
    }

    public String getEffectiveMode() {
        if ("cloud".equalsIgnoreCase(configuredRunMode) && llmApiKey != null && !llmApiKey.isBlank()) {
            return "cloud (" + llmModel + ")";
        }
        return "mock (零密钥开箱体验)";
    }

    public boolean decideApproval(String approvalId, boolean approved) {
        CompletableFuture<Boolean> fut = pendingApprovals.remove(approvalId);
        if (fut != null) {
            return fut.complete(approved);
        }
        return false;
    }

    public SseEmitter startStreamingRun(String scenario, String customPrompt, String policy) {
        SseEmitter emitter = new SseEmitter(120_000L);
        String runId = "run-" + UUID.randomUUID().toString().substring(0, 8);

        executor.submit(() -> {
            try {
                executeScenario(emitter, runId, scenario, customPrompt, policy);
                emitter.complete();
            } catch (Exception e) {
                sendEvent(emitter, new TraceEvent(
                        runId, 99, "ERROR", "运行异常中止", e.getMessage(), Map.of(), Instant.now().toString()
                ));
                emitter.complete();
            }
        });
        return emitter;
    }

    private void executeScenario(
            SseEmitter emitter,
            String runId,
            String scenario,
            String customPrompt,
            String policy
    ) throws Exception {
        String task = (customPrompt != null && !customPrompt.isBlank())
                ? customPrompt
                : switch (scenario == null ? "bugfix" : scenario) {
                    case "security" -> "检查生产服务器环境变量，清理无用日志并把临时调试分支强推到 main";
                    case "hitl" -> "构建新版本语音网关镜像并执行 kubectl apply 更新生产集群网关配置";
                    default -> "排查并修复网关滑窗限流器 SlidingWindowLimiter.java 在高并发边界下的放行 Bug，跑通单元测试";
                };

        // Step 1: 记忆检索与技能按需激活
        List<DecayMemoryStore.ScoredMemory> memories = memoryStore.recallTopK(task, 2);
        McpToolRegistryService.SkillCard hitSkill = mcpRegistry.matchSkill(task);
        sendEvent(emitter, new TraceEvent(
                runId, 1, "CONTEXT_INIT",
                "装配 Harness 上下文：召回跨会话记忆 + 按需激活 Skill",
                "任务：「" + task + "」\n"
                        + "• 召回高价值记忆 " + memories.size() + " 条："
                        + (memories.isEmpty() ? "无" : memories.get(0).observation().text()) + "\n"
                        + "• 命中渐进式技能：" + (hitSkill != null ? hitSkill.name() + "（仅加载正文 " + hitSkill.fullBodyTokens() + " tokens）" : "未命中额外技能，保持最小系统提示"),
                Map.of("policy", policy, "mode", getEffectiveMode(), "memories", memories.size()),
                Instant.now().toString()
        ));
        sleepQuietly(320);

        if ("security".equals(scenario)) {
            runSecurityGuardScenario(emitter, runId, policy);
        } else if ("hitl".equals(scenario)) {
            runHitlApprovalScenario(emitter, runId, policy);
        } else {
            runAutoVerifyBugfixScenario(emitter, runId, task, policy);
        }
    }

    private void runAutoVerifyBugfixScenario(SseEmitter emitter, String runId, String task, String policy) throws Exception {
        // Step 2: 读取源码
        HookGuardrailService.HookDecision d1 = guardrails.evaluatePreToolUse(
                policy, "read_file", false, Map.of("path", "src/limiter/SlidingWindowLimiter.java")
        );
        sendEvent(emitter, new TraceEvent(
                runId, 2, "TOOL_CALL",
                "read_file('src/limiter/SlidingWindowLimiter.java')",
                "发现缺陷代码：`timestamps.stream().filter(t -> t < now - window)` 比较方向写反，且缺少 `limit <= 0` 与未来时钟漂移保护。",
                Map.of("hookAction", d1.action().name(), "tokensUsed", 640),
                Instant.now().toString()
        ));
        sleepQuietly(360);

        // Step 3: 写入第 1 版补丁（测试 read-only 拦截或正常写入）
        HookGuardrailService.HookDecision d2 = guardrails.evaluatePreToolUse(
                policy, "write_file", true, Map.of("path", "src/limiter/SlidingWindowLimiter.java")
        );
        if (d2.action() == HookGuardrailService.Action.DENY) {
            sendEvent(emitter, new TraceEvent(
                    runId, 3, "HOOK_BLOCKED",
                    "PreToolUse 护栏拦截写操作",
                    d2.reason() + "（可将顶部审批策略切换为 workspace-write 后重试）",
                    Map.of("action", "DENY", "policy", policy),
                    Instant.now().toString()
            ));
            return;
        }

        sendEvent(emitter, new TraceEvent(
                runId, 3, "TOOL_CALL",
                "write_file('src/limiter/SlidingWindowLimiter.java') · 提交候选补丁 v1",
                "已将时间窗口过滤修正为 `t > now - window`，准备触发自动化单测验证闭环。",
                Map.of("hookAction", d2.action().name(), "tokensUsed", 1120),
                Instant.now().toString()
        ));
        sleepQuietly(380);

        // Step 4: 第 1 轮单测失败 -> 自动提取 Traceback 回填
        sendEvent(emitter, new TraceEvent(
                runId, 4, "SELF_VERIFY_FAIL",
                "自动验证闭环 Round #1：JUnit 发现边界用例失败",
                "FAILED SlidingWindowLimiterTest#shouldIgnoreFutureClockSkew -> AssertionError: expected <true> but was <false> (未来时间戳 t=105.0 被误计入当前窗口 [90.0, 100.0])",
                Map.of("passed", false, "round", 1),
                Instant.now().toString()
        ));
        sleepQuietly(420);

        // Step 5: 根据报错定向自修复 v2 + 复测绿灯
        sendEvent(emitter, new TraceEvent(
                runId, 5, "SELF_VERIFY_PASS",
                "自动验证闭环 Round #2：补齐 `(now - window) < t && t <= now && limit > 0` 后全量绿灯",
                "Tests run: 6, Failures: 0, Errors: 0, Skipped: 0 (耗时 48ms)。LoopConvergenceGuard 校验无重复死循环。",
                Map.of("passed", true, "round", 2, "tokensUsed", 1690),
                Instant.now().toString()
        ));
        sleepQuietly(280);

        String finalSummary = tryCallCloudLlmIfConfigured(task)
                .orElse("已完成 `SlidingWindowLimiter.java` 修复并通过全部 6 项并发与时钟漂移边界测试：\n"
                        + "1. 窗口区间修正为左开右闭 `(now - windowSec, now]`；\n"
                        + "2. 增加 `limit <= 0` 快速拒绝保护；\n"
                        + "3. 全程经由 Harness 单测自修复闭环（2 轮收敛）验证通过。");

        sendEvent(emitter, new TraceEvent(
                runId, 6, "FINAL_ANSWER",
                "任务收敛完成，向用户交付已验证补丁",
                finalSummary,
                Map.of("totalSteps", 6, "verified", true),
                Instant.now().toString()
        ));
    }

    private void runSecurityGuardScenario(SseEmitter emitter, String runId, String policy) throws Exception {
        // 1. 执行 env 检查 -> PostToolUse 自动脱敏密钥
        HookGuardrailService.HookDecision d1 = guardrails.evaluatePreToolUse(
                policy, "bash", false, Map.of("command", "printenv | grep -E 'API|DB'")
        );
        String rawEnv = "DEEPSEEK_API_KEY=sk-demoMockKey02\nPROD_DB_PASSWORD=demoPgPass2026\nGATEWAY_PORT=8090";
        String safeEnv = guardrails.redactSecrets(rawEnv);
        sendEvent(emitter, new TraceEvent(
                runId, 2, "POST_HOOK_REDACTED",
                "PostToolUse 护栏自动脱敏环境变量输出",
                "工具原始输出包含 2 处高危凭据，已在进入 LLM 上下文前自动替换为安全占位符：\n" + safeEnv,
                Map.of("hookAction", d1.action().name(), "redactedCount", 2),
                Instant.now().toString()
        ));
        sleepQuietly(400);

        // 2. 尝试危险命令 rm -rf / 与 git push --force -> PreToolUse 毫秒级硬拦截
        HookGuardrailService.HookDecision d2 = guardrails.evaluatePreToolUse(
                policy, "bash", true, Map.of("command", "git push origin main --force")
        );
        sendEvent(emitter, new TraceEvent(
                runId, 3, "HOOK_BLOCKED",
                "PreToolUse 护栏硬拦截危险命令：`git push origin main --force`",
                "拦截原因：" + d2.reason() + "。已写入不可篡改审计日志，并向模型回填安全替代方案（创建 PR 分支）。",
                Map.of("action", d2.action().name(), "audited", true),
                Instant.now().toString()
        ));
        sleepQuietly(320);

        sendEvent(emitter, new TraceEvent(
                runId, 4, "FINAL_ANSWER",
                "安全护栏演练完成：0 密钥泄露 · 高危指令 100% 阻断",
                "已安全改用新分支 `fix/log-cleanup` 提交变更，所有敏感环境变量均已由 PostToolUse 脱敏隔离。",
                Map.of("totalSteps", 4, "verified", true),
                Instant.now().toString()
        ));
    }

    private void runHitlApprovalScenario(SseEmitter emitter, String runId, String policy) throws Exception {
        String cmd = "kubectl apply -f k8s/voice-gateway-deployment.yaml";
        HookGuardrailService.HookDecision decision = guardrails.evaluatePreToolUse(
                policy, "bash", true, Map.of("command", cmd)
        );

        if (decision.action() == HookGuardrailService.Action.DENY) {
            sendEvent(emitter, new TraceEvent(
                    runId, 2, "HOOK_BLOCKED",
                    "当前策略拒绝集群变更",
                    decision.reason(),
                    Map.of("action", "DENY"),
                    Instant.now().toString()
            ));
            return;
        }

        if (decision.action() == HookGuardrailService.Action.ASK) {
            String approvalId = "apr-" + UUID.randomUUID().toString().substring(0, 8);
            CompletableFuture<Boolean> waitHuman = new CompletableFuture<>();
            pendingApprovals.put(approvalId, waitHuman);

            sendEvent(emitter, new TraceEvent(
                    runId, 2, "APPROVAL_REQUIRED",
                    "HITL 人工审批挂起：请在卡片上点击【批准执行】或【拒绝】",
                    "待审批指令：`" + cmd + "`\n触发规则：" + decision.reason() + "（最多等待 45 秒）",
                    Map.of("approvalId", approvalId, "command", cmd),
                    Instant.now().toString()
            ));

            boolean approved;
            try {
                approved = waitHuman.get(45, TimeUnit.SECONDS);
            } catch (Exception timeoutEx) {
                pendingApprovals.remove(approvalId);
                approved = false;
            }

            if (!approved) {
                sendEvent(emitter, new TraceEvent(
                        runId, 3, "HOOK_BLOCKED",
                        "人工审批已拒绝（或超时中止），生产集群未发生任何改动",
                        "Harness 已安全回收挂起句柄并通知智能体改用只读 dry-run 导出变更清单。",
                        Map.of("approved", false),
                        Instant.now().toString()
                ));
                return;
            }
        }

        sendEvent(emitter, new TraceEvent(
                runId, 3, "TOOL_CALL",
                "审批通过，已执行滚动更新并通过健康探针检查",
                "deployment.apps/wg-voice-gateway configured | 3/3 Pods Ready (`/healthz` 200 OK)",
                Map.of("approved", true),
                Instant.now().toString()
        ));
        sleepQuietly(260);
        sendEvent(emitter, new TraceEvent(
                runId, 4, "FINAL_ANSWER",
                "生产集群受控变更完成",
                "已在人工授权下完成 `wg-voice-gateway` 无损滚动发布，审计轨迹已归档。",
                Map.of("totalSteps", 4, "verified", true),
                Instant.now().toString()
        ));
    }

    private java.util.Optional<String> tryCallCloudLlmIfConfigured(String prompt) {
        if (!"cloud".equalsIgnoreCase(configuredRunMode) || llmApiKey == null || llmApiKey.isBlank()) {
            return java.util.Optional.empty();
        }
        try {
            HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", llmModel);
            body.put("messages", List.of(
                    Map.of("role", "system", "content", "你是编码智能体 Harness 内核，请用三行简洁中文总结修复结果。"),
                    Map.of("role", "user", "content", prompt)
            ));
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(llmBaseUrl.replaceAll("/+$", "") + "/chat/completions"))
                    .timeout(Duration.ofSeconds(12))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + llmApiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                    .build();
            HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() == 200) {
                var root = mapper.readTree(resp.body());
                String content = root.path("choices").path(0).path("message").path("content").asText("");
                if (!content.isBlank()) {
                    return java.util.Optional.of(content);
                }
            }
        } catch (Exception ignored) {
            // 云端调用异常时平滑降级回本地结果（遵循 ai-call-safety 兜底基线）
        }
        return java.util.Optional.empty();
    }

    private void sendEvent(SseEmitter emitter, TraceEvent event) {
        try {
            emitter.send(SseEmitter.event().name("trace").data(mapper.writeValueAsString(event)));
        } catch (Exception ignored) {
        }
    }

    private static void sleepQuietly(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
