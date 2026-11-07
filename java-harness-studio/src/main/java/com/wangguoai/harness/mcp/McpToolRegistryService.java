package com.wangguoai.harness.mcp;

import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Agent Skills 三层渐进式披露加载器 + MCP (JSON-RPC 2.0) 工具与资源协议栈
 */
@Service
public class McpToolRegistryService {

    public record SkillCard(
            String name,
            String description,
            int indexTokens,
            int fullBodyTokens,
            String instructionsBody,
            List<String> bundledScripts
    ) {}

    private final List<SkillCard> skills = List.of(
            new SkillCard(
                    "voice-latency-diagnosis",
                    "诊断实时语音机器人端到端延迟。当涉及 FreeSWITCH、RTP、ASR/TTS 首包 TTFB 或打断滞后时激活。",
                    34,
                    420,
                    "1. 拆解 VAD 静音判停、ASR 首字、LLM TTFT 与 TTS 首包耗时；\n2. 检查 DeepSeek thinking 是否已关闭；\n3. 检查下行 RTP 环形队列是否接入 clearAudio 原子清空。",
                    List.of("scripts/rtp_jitter_probe.py", "references/freeswitch_esl.md")
            ),
            new SkillCard(
                    "java-concurrency-audit",
                    "审查 Java 高并发服务线程安全、锁竞争、虚拟线程固定 (Pinning) 与滑窗限流边界。",
                    31,
                    385,
                    "1. 检查 synchronized 是否包裹了阻塞 I/O；\n2. 校验滑窗限流器时间戳开闭区间 (now - window, now]；\n3. 自动生成并发边界 JUnit 单元测试。",
                    List.of("scripts/jfr_flamegraph.sh")
            ),
            new SkillCard(
                    "sql-index-guard",
                    "审查慢 SQL 执行计划、深分页、隐式类型转换与注入风险。",
                    26,
                    310,
                    "1. 拦截无 WHERE 条件更新或全表扫描；\n2. 校验联合索引最左前缀匹配；\n3. 输出回滚安全的 DDL 变更建议。",
                    List.of("references/mysql_explain_rules.md")
            )
    );

    public List<SkillCard> listSkills() {
        return skills;
    }

    public SkillCard matchSkill(String userTask) {
        if (userTask == null) {
            return null;
        }
        String lower = userTask.toLowerCase();
        if (lower.contains("语音") || lower.contains("rtp") || lower.contains("tts") || lower.contains("打断")) {
            return skills.get(0);
        }
        if (lower.contains("并发") || lower.contains("限流") || lower.contains("线程") || lower.contains("bug")) {
            return skills.get(1);
        }
        if (lower.contains("sql") || lower.contains("慢查询") || lower.contains("索引")) {
            return skills.get(2);
        }
        return null;
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
                        "serverInfo", Map.of("name", "wg-java-harness-mcp", "version", "0.3.0"),
                        "capabilities", Map.of("tools", Map.of(), "resources", Map.of())
                );
                case "tools/list" -> Map.of(
                        "tools", List.of(
                                Map.of(
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
                                ),
                                Map.of(
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
                                )
                        )
                );
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
