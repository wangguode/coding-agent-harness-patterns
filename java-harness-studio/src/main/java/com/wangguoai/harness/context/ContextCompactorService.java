package com.wangguoai.harness.context;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * 上下文工程与自动压缩引擎（对应编码智能体 /compact 核心机制）
 *
 * <p>两级降噪策略：
 * <ol>
 *   <li><b>Level 1 工具输出头尾裁剪</b>：超长日志只保留头部与尾部关键报错，剔除中间重复堆栈</li>
 *   <li><b>Level 2 结构化摘要折叠</b>：保留 System 指令 + 初始目标 + 最近 K 轮完整消息，将中段历史压缩为结构化检查点</li>
 * </ol>
 */
@Service
public class ContextCompactorService {

    public record ChatMessage(String role, String content, int estimatedTokens) {
        public static ChatMessage of(String role, String content) {
            return new ChatMessage(role, content, estimateTokens(content));
        }
    }

    public record CompactionReport(
            int windowLimit,
            int triggerThreshold,
            int beforeMessages,
            int afterMessages,
            int beforeTokens,
            int afterTokens,
            double savedPercent,
            boolean triggered,
            List<ChatMessage> compactedMessages
    ) {}

    /**
     * 中英混合 Token 估算：汉字约 1 字 ≈ 1 token，ASCII 字符约 4 字符 ≈ 1 token
     */
    public static int estimateTokens(String text) {
        if (text == null || text.isEmpty()) {
            return 0;
        }
        int cjk = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c >= '\u4e00' && c <= '\u9fff') {
                cjk++;
            }
        }
        return cjk + (text.length() - cjk) / 4 + 1;
    }

    public static String trimToolOutput(String text, int headChars, int tailChars) {
        if (text == null || text.length() <= headChars + tailChars) {
            return text == null ? "" : text;
        }
        int omitted = text.length() - headChars - tailChars;
        return text.substring(0, headChars)
                + "\n... [已由 Harness 裁剪中间冗余输出 " + omitted + " 字符] ...\n"
                + text.substring(text.length() - tailChars);
    }

    public CompactionReport compact(List<ChatMessage> rawMessages, int windowLimit, int keepRecent) {
        int beforeTokens = rawMessages.stream().mapToInt(ChatMessage::estimatedTokens).sum();
        int threshold = (int) (windowLimit * 0.80);

        // 第一步：先裁剪超长 tool 输出
        List<ChatMessage> trimmed = new ArrayList<>(rawMessages.size());
        for (ChatMessage m : rawMessages) {
            if ("tool".equals(m.role())) {
                trimmed.add(ChatMessage.of("tool", trimToolOutput(m.content(), 180, 180)));
            } else {
                trimmed.add(m);
            }
        }

        int afterTrimTokens = trimmed.stream().mapToInt(ChatMessage::estimatedTokens).sum();
        if (beforeTokens < threshold && afterTrimTokens < threshold) {
            double saved = beforeTokens == 0 ? 0.0 : (1.0 - (double) afterTrimTokens / beforeTokens) * 100.0;
            return new CompactionReport(
                    windowLimit, threshold, rawMessages.size(), trimmed.size(),
                    beforeTokens, afterTrimTokens, Math.round(saved * 10.0) / 10.0, false, trimmed
            );
        }

        // 第二步：固定保留头部（System + User 原始任务）与尾部最近 keepRecent 条，中段折叠为结构化检查点摘要
        int headCount = Math.min(2, trimmed.size());
        int safeKeep = Math.min(keepRecent, Math.max(0, trimmed.size() - headCount));
        List<ChatMessage> head = trimmed.subList(0, headCount);
        List<ChatMessage> tail = trimmed.subList(trimmed.size() - safeKeep, trimmed.size());
        List<ChatMessage> middle = trimmed.subList(headCount, trimmed.size() - safeKeep);

        List<String> actions = new ArrayList<>();
        List<String> findings = new ArrayList<>();
        for (ChatMessage m : middle) {
            String snippet = m.content().replace("\n", " ");
            if (snippet.length() > 48) {
                snippet = snippet.substring(0, 48) + "...";
            }
            if ("assistant".equals(m.role()) && actions.size() < 4) {
                actions.add(snippet);
            } else if ("tool".equals(m.role()) && findings.size() < 3) {
                findings.add(snippet);
            }
        }

        String summaryBlock = "【Harness 结构化上下文检查点 (/compact)】\n"
                + "• 已折叠历史消息数：" + middle.size() + " 条\n"
                + "• 已执行关键步骤：" + (actions.isEmpty() ? "无" : String.join(" ； ", actions)) + "\n"
                + "• 工具核心发现：" + (findings.isEmpty() ? "无异常" : String.join(" ； ", findings)) + "\n"
                + "• 约束继承：继续保持代码边界校验与单元测试绿灯验证。";

        List<ChatMessage> result = new ArrayList<>();
        result.addAll(head);
        result.add(ChatMessage.of("system", summaryBlock));
        result.addAll(tail);

        int afterTokens = result.stream().mapToInt(ChatMessage::estimatedTokens).sum();
        double savedPercent = beforeTokens == 0 ? 0.0 : (1.0 - (double) afterTokens / beforeTokens) * 100.0;
        return new CompactionReport(
                windowLimit, threshold, rawMessages.size(), result.size(),
                beforeTokens, afterTokens, Math.round(savedPercent * 10.0) / 10.0, true, result
        );
    }

    /**
     * 构造一份逼真的 28 轮长程重构会话，用于前端一键体验 /compact 压缩对比
     */
    public CompactionReport simulateLongRefactoringSession(int windowLimit) {
        List<ChatMessage> msgs = new ArrayList<>();
        msgs.add(ChatMessage.of("system", "你是企业级 Java 架构师编码智能体，严格遵守安全护栏与单测自验证规范。"));
        msgs.add(ChatMessage.of("user", "排查网关模块高并发下的滑窗限流器精度漂移，并把所有同步阻塞调用改造为异步非阻塞。"));
        for (int i = 1; i <= 13; i++) {
            msgs.add(ChatMessage.of("assistant", "Step #" + i + "：扫描 GatewayFilter_" + i + ".java 并重构时间窗口边界与异步调用链"));
            StringBuilder verboseTool = new StringBuilder("发现 GatewayFilter_" + i + ".java 存在时间边界比较错误与阻塞调用。\n");
            for (int line = 1; line <= 36; line++) {
                verboseTool.append("[Maven Surefire Trace ").append(i).append("-").append(line)
                        .append("] INFO com.wangguoai.gateway.FilterChain - Span latency=12.4ms thread=nio-worker-")
                        .append(line).append("\n");
            }
            verboseTool.append("Patch applied and verified on shard #").append(i);
            msgs.add(ChatMessage.of("tool", verboseTool.toString()));
        }
        return compact(msgs, windowLimit, 4);
    }
}
