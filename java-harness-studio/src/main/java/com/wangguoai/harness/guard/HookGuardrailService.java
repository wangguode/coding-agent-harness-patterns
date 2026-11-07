package com.wangguoai.harness.guard;

import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Pattern;

/**
 * Hooks 安全护栏与三档沙箱审批服务（PreToolUse 拦截 + PostToolUse 密钥脱敏 + 审计账本）
 */
@Service
public class HookGuardrailService {

    public enum Action {
        ALLOW, ASK, DENY
    }

    public record Rule(Pattern pattern, Action action, String reason) {}

    public record HookDecision(
            Action action,
            String reason,
            String policy,
            String toolName,
            String sanitizedPreview
    ) {}

    public record AuditRecord(
            String timestamp,
            String toolName,
            String commandOrTarget,
            String policy,
            Action decision,
            String reason
    ) {}

    private static final List<Rule> RULES = List.of(
            new Rule(Pattern.compile("\\brm\\s+-rf\\s+/(?:\\s|$|\\*)"), Action.DENY, "禁止删除操作系统根目录"),
            new Rule(Pattern.compile("curl[^|]*\\|\\s*(ba)?sh"), Action.DENY, "禁止通过管道直接执行远程未签名脚本"),
            new Rule(Pattern.compile("git\\s+push\\s+.*--force"), Action.DENY, "禁止向保护分支执行强制推送 (--force)"),
            new Rule(Pattern.compile("(?i)\\bdrop\\s+table\\b"), Action.DENY, "禁止在生产/沙箱库执行删表操作"),
            new Rule(Pattern.compile("\\bkubectl\\s+(delete|apply)\\b"), Action.ASK, "变更 Kubernetes 集群资源需人工审批确认"),
            new Rule(Pattern.compile("\\b(mvn\\s+deploy|npm\\s+publish)\\b"), Action.ASK, "发布制品包到公共仓库需人工审批确认")
    );

    private static final Pattern SECRET_PATTERN = Pattern.compile(
            "(sk-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{16}|(?i)(password|api_key|secret|token)\\s*[=:]\\s*[^\\s\"',]+)"
    );

    private final List<AuditRecord> auditLog = new CopyOnWriteArrayList<>();

    /**
     * PreToolUse：结合当前审批档位（read-only / workspace-write / full-access）与危险特征规则裁决工具调用
     */
    public HookDecision evaluatePreToolUse(String policy, String toolName, boolean writesState, Map<String, Object> args) {
        String normalizedPolicy = (policy == null || policy.isBlank()) ? "workspace-write" : policy;
        String rawTarget = String.valueOf(args.getOrDefault("command", args.getOrDefault("path", args.toString())));

        // 1. 路径越界检查
        if (args.containsKey("path")) {
            String path = String.valueOf(args.get("path"));
            if (path.contains("..") || path.startsWith("/etc") || path.startsWith("/root")) {
                return record(normalizedPolicy, toolName, rawTarget, Action.DENY, "拦截工作区目录逃逸访问: " + path);
            }
        }

        // 2. 高危命令模式匹配（即使在 full-access 模式下，毁灭性命令依然走 DENY）
        for (Rule r : RULES) {
            if (r.pattern().matcher(rawTarget).find()) {
                Action act = (r.action() == Action.ASK && "full-access".equals(normalizedPolicy))
                        ? Action.ALLOW
                        : r.action();
                String why = r.reason() + ("full-access".equals(normalizedPolicy) && r.action() == Action.ASK ? "（full-access 自动放行）" : "");
                return record(normalizedPolicy, toolName, rawTarget, act, why);
            }
        }

        // 3. read-only 策略拦截一切写操作
        if ("read-only".equals(normalizedPolicy) && writesState) {
            return record(normalizedPolicy, toolName, rawTarget, Action.DENY, "当前策略为 read-only，禁止执行会产生副作用的工具");
        }

        return record(normalizedPolicy, toolName, rawTarget, Action.ALLOW, "通过安全策略与沙箱边界检查");
    }

    /**
     * PostToolUse：对工具输出做敏感凭据脱敏，防止 API Key / 数据库密码流入大模型上下文或日志
     */
    public String redactSecrets(String rawOutput) {
        if (rawOutput == null || rawOutput.isEmpty()) {
            return "";
        }
        return SECRET_PATTERN.matcher(rawOutput).replaceAll("[REDACTED_BY_HOOK]");
    }

    private HookDecision record(String policy, String tool, String target, Action action, String reason) {
        AuditRecord rec = new AuditRecord(
                Instant.now().toString(),
                tool,
                redactSecrets(target),
                policy,
                action,
                reason
        );
        auditLog.add(0, rec);
        while (auditLog.size() > 50) {
            auditLog.remove(auditLog.size() - 1);
        }
        return new HookDecision(action, reason, policy, tool, redactSecrets(target));
    }

    public List<AuditRecord> getRecentAuditLog() {
        return Collections.unmodifiableList(new ArrayList<>(auditLog));
    }
}
