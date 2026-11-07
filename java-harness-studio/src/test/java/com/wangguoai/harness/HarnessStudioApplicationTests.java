package com.wangguoai.harness;

import com.wangguoai.harness.context.ContextCompactorService;
import com.wangguoai.harness.guard.HookGuardrailService;
import com.wangguoai.harness.mcp.McpToolRegistryService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class HarnessStudioApplicationTests {

    @Autowired
    private HookGuardrailService guardrails;

    @Autowired
    private ContextCompactorService compactor;

    @Autowired
    private McpToolRegistryService mcpRegistry;

    @Test
    void shouldDenyDestructiveCommandAndRedactApiKey() {
        var decision = guardrails.evaluatePreToolUse(
                "workspace-write", "bash", true, Map.of("command", "rm -rf / ")
        );
        assertThat(decision.action()).isEqualTo(HookGuardrailService.Action.DENY);

        String redacted = guardrails.redactSecrets("DEEPSEEK_API_KEY=sk-abcdef1234567890");
        assertThat(redacted).contains("[REDACTED_BY_HOOK]").doesNotContain("sk-abcdef");
    }

    @Test
    void shouldCompactLongSessionOverNinetyPercent() {
        var report = compactor.simulateLongRefactoringSession(2000);
        assertThat(report.triggered()).isTrue();
        assertThat(report.savedPercent()).isGreaterThan(85.0);
    }

    @Test
    void shouldServeStandardMcpToolsCall() {
        Map<String, Object> resp = mcpRegistry.handleJsonRpc(Map.of(
                "jsonrpc", "2.0",
                "id", 7,
                "method", "tools/call",
                "params", Map.of(
                        "name", "diagnose_voice_latency",
                        "arguments", Map.of("asrMs", 70, "llmTtftMs", 210, "ttsTtfbMs", 80)
                )
        ));
        assertThat(resp).containsKey("result");
    }
}
