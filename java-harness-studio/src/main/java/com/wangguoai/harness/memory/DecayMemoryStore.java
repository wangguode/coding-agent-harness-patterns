package com.wangguoai.harness.memory;

import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 跨会话记忆引擎（Observation 提炼 → 去重 → 重要度 × 半衰期时间衰减 × 语义词重叠检索）
 */
@Service
public class DecayMemoryStore {

    private static final double HALF_LIFE_DAYS = 14.0;
    private static final Pattern TOKEN_PATTERN = Pattern.compile("[a-zA-Z0-9_]+|[\\u4e00-\\u9fff]{2}");

    public record Observation(
            String id,
            String kind,       // DECISION / PITFALL / PREFERENCE / FACT
            String text,
            double importance, // 0.0 ~ 1.0
            long timestampEpochSec
    ) {}

    public record ScoredMemory(
            Observation observation,
            double score,
            double relevance,
            double decayFactor,
            long ageDays
    ) {}

    private final List<Observation> store = new CopyOnWriteArrayList<>();

    public DecayMemoryStore() {
        long now = Instant.now().getEpochSecond();
        long day = 86400L;
        store.add(new Observation("MEM-01", "DECISION", "网关与微服务间调用统一采用 Java 21 虚拟线程 + WebClient 非阻塞客户端，禁用阻塞式 RestTemplate", 0.92, now - 2 * day));
        store.add(new Observation("MEM-02", "PITFALL", "滑窗限流器比较窗口边界必须使用左开右闭 (now - window, now]，同时防御 limit <= 0 与未来时间戳漂移", 0.96, now - 3 * day));
        store.add(new Observation("MEM-03", "PITFALL", "FreeSWITCH ESL 长连接必须开启 15 秒心跳检测，并在收到 InterruptionFrame 时下发 clearAudio 清空下行环形缓冲", 0.95, now - 12 * day));
        store.add(new Observation("MEM-04", "PREFERENCE", "代码与文档注释统一使用简体中文，测试套件遵循 JUnit 5 与 AssertJ 断言规范", 0.82, now - 1 * day));
        store.add(new Observation("MEM-05", "FACT", "DeepSeek 实时语音交互场景需在请求参数中显式设置 thinking=disabled 以将 TTFT 控制在 280ms 以内", 0.88, now - 6 * day));
    }

    public List<Observation> listAll() {
        return new ArrayList<>(store);
    }

    public Observation addObservation(String kind, String text, double importance) {
        String id = String.format("MEM-%02d", store.size() + 1);
        Observation obs = new Observation(
                id,
                (kind == null || kind.isBlank()) ? "FACT" : kind.toUpperCase(),
                text,
                Math.max(0.1, Math.min(1.0, importance)),
                Instant.now().getEpochSecond()
        );
        store.add(0, obs);
        return obs;
    }

    public List<ScoredMemory> recallTopK(String query, int topK) {
        Set<String> qTokens = tokenize(query);
        long now = Instant.now().getEpochSecond();
        List<ScoredMemory> scored = new ArrayList<>();

        for (Observation obs : store) {
            Set<String> dTokens = tokenize(obs.text());
            int overlap = 0;
            for (String qt : qTokens) {
                if (dTokens.contains(qt)) {
                    overlap++;
                }
            }
            double relevance = qTokens.isEmpty()
                    ? 0.5
                    : (double) overlap / (Math.sqrt(qTokens.size()) + 0.25);
            long ageDays = Math.max(0L, (now - obs.timestampEpochSec()) / 86400L);
            double decay = Math.pow(0.5, (now - obs.timestampEpochSec()) / 86400.0 / HALF_LIFE_DAYS);
            double finalScore = relevance * obs.importance() * decay;
            if (finalScore > 0.01 || qTokens.isEmpty()) {
                scored.add(new ScoredMemory(
                        obs,
                        Math.round(finalScore * 1000.0) / 1000.0,
                        Math.round(relevance * 1000.0) / 1000.0,
                        Math.round(decay * 1000.0) / 1000.0,
                        ageDays
                ));
            }
        }
        scored.sort(Comparator.comparingDouble(ScoredMemory::score).reversed());
        return scored.subList(0, Math.min(topK, scored.size()));
    }

    private static Set<String> tokenize(String s) {
        Set<String> out = new HashSet<>();
        if (s == null) {
            return out;
        }
        String lower = s.toLowerCase();
        Matcher m = TOKEN_PATTERN.matcher(lower);
        while (m.find()) {
            out.add(m.group());
        }
        // 补充中文连续双字 Bigram，提高中文短语召回率
        String cjkOnly = lower.replaceAll("[^\\u4e00-\\u9fff]", "");
        for (int i = 0; i + 1 < cjkOnly.length(); i++) {
            out.add(cjkOnly.substring(i, i + 2));
        }
        return out;
    }
}
