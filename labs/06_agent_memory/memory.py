"""
Lab 06 · 跨会话 Agent 记忆（Observation → 压缩 → 检索注入）

参考 thedotmack/claude-mem 与 AGENTS.md / CLAUDE.md 项目记忆约定（脱敏重写）：
    - 会话中把工具调用结果提炼为“观察记录”（类型：决策 / 踩坑 / 偏好 / 事实）
    - 会话结束时持久化到本地 JSON（真实系统多用 SQLite + 向量索引）
    - 新会话启动时按任务相关度 + 时间衰减检索 Top-K，注入系统提示
    - 用“重要度 × 时间衰减 × 相关度”打分，避免记忆无限膨胀

零依赖，可直接运行：python3 memory.py
"""
from __future__ import annotations

import json
import math
import os
import re
import tempfile
import time
from dataclasses import asdict, dataclass

HALF_LIFE_DAYS = 14  # 记忆半衰期


@dataclass
class Observation:
    kind: str  # decision / pitfall / preference / fact
    text: str
    importance: float  # 0~1
    ts: float


def tokenize(s: str) -> set[str]:
    return set(re.findall(r"[a-zA-Z_]+|[\u4e00-\u9fff]{2}", s.lower()))


class MemoryStore:
    def __init__(self, path: str):
        self.path = path
        self.items: list[Observation] = []
        if os.path.exists(path):
            self.items = [Observation(**o) for o in json.load(open(path, encoding="utf-8"))]

    def add(self, kind: str, text: str, importance: float, ts: float | None = None) -> None:
        # 简单去重：文本高度重合则只刷新时间戳
        for o in self.items:
            if len(tokenize(o.text) & tokenize(text)) / max(1, len(tokenize(text))) > 0.8:
                o.ts = ts or time.time()
                return
        self.items.append(Observation(kind, text, importance, ts or time.time()))

    def save(self) -> None:
        json.dump([asdict(o) for o in self.items], open(self.path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    def recall(self, task: str, k: int = 3) -> list[tuple[float, Observation]]:
        q = tokenize(task)
        now = time.time()
        scored = []
        for o in self.items:
            rel = len(q & tokenize(o.text)) / (len(q) ** 0.5 + 1e-6)
            decay = math.pow(0.5, (now - o.ts) / 86400 / HALF_LIFE_DAYS)
            scored.append((rel * o.importance * decay, o))
        return sorted([s for s in scored if s[0] > 0], key=lambda x: -x[0])[:k]


def main() -> None:
    day = 86400
    now = time.time()
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "memory.json")
        # —— 会话 1：工作中沉淀观察 ——
        s1 = MemoryStore(path)
        s1.add("decision", "订单服务统一使用 asyncio + httpx，不再用 requests", 0.9, now - 2 * day)
        s1.add("pitfall", "FreeSWITCH ESL 连接必须开启心跳，否则 30 分钟后静默断开", 0.95, now - 40 * day)
        s1.add("preference", "用户偏好中文注释与 pytest 风格测试", 0.7, now - 1 * day)
        s1.add("fact", "支付网关测试环境地址见 docs/payment.md", 0.5, now - 60 * day)
        s1.add("pitfall", "TTS 首包延迟主要卡在 LLM 首 token，需开启流式输出", 0.85, now - 5 * day)
        s1.save()
        print(f"💾 会话 1 结束，已持久化 {len(s1.items)} 条观察 -> memory.json")

        # —— 会话 2：新任务启动时检索注入 ——
        s2 = MemoryStore(path)
        for task in ["给订单服务新增一个 httpx 异步调用并补 pytest 测试", "电话机器人 TTS 首包延迟高，ESL 偶发断开"]:
            print("=" * 72)
            print(f"🧑 新会话任务：{task}")
            for score, o in s2.recall(task):
                print(f"   🧠 注入记忆 [{o.kind:10}] score={score:.3f} | {o.text}")


if __name__ == "__main__":
    main()
