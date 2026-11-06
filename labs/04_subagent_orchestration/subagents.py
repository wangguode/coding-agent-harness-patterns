"""
Lab 04 · 子智能体编排（Planner → 并行 Worker → Reviewer）

参考 stablyai/orca、claude-code subagents、Codex 云端并行任务的公开设计思路（脱敏重写）：
    - 主智能体只负责拆解与汇总，不亲自读大量文件 → 保持主上下文干净
    - 每个子智能体拥有**独立上下文**与**独立工作区**（真实系统里常用 git worktree）
    - 并行执行，设置超时；失败的子任务可重试或降级
    - Reviewer 对结果做一致性校验后再合并

零依赖（asyncio），可直接运行：python3 subagents.py
"""
from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass, field


@dataclass
class SubTask:
    id: str
    goal: str
    files: list[str]


@dataclass
class SubResult:
    task_id: str
    ok: bool
    summary: str
    context_tokens: int  # 子智能体自己消耗的上下文，不会污染主智能体
    attempts: int = 1


@dataclass
class Worker:
    name: str
    workspace: str
    context: list[str] = field(default_factory=list)  # 独立上下文

    async def run(self, task: SubTask, fail_rate: float) -> SubResult:
        for f in task.files:
            self.context.append(f"读取 {f} 的 3000 tokens 内容")
        await asyncio.sleep(random.uniform(0.05, 0.2))  # 模拟模型推理与工具调用
        if random.random() < fail_rate:
            raise RuntimeError(f"{self.name} 在 {task.id} 上测试未通过")
        return SubResult(task.id, True, f"{task.goal} ✔（改动 {len(task.files)} 个文件）", 3000 * len(task.files))


class Orchestrator:
    def __init__(self, max_parallel: int = 3, timeout: float = 1.0, max_retry: int = 2):
        self.sem = asyncio.Semaphore(max_parallel)
        self.timeout = timeout
        self.max_retry = max_retry

    def plan(self, goal: str) -> list[SubTask]:
        """真实系统由 Planner 模型生成；这里固定拆解"""
        return [
            SubTask("T1", "给 user 模块补单元测试", ["user/service.py", "user/repo.py"]),
            SubTask("T2", "把 order 模块的同步 IO 改异步", ["order/api.py", "order/client.py", "order/db.py"]),
            SubTask("T3", "修复 payment 模块的类型错误", ["payment/gateway.py"]),
            SubTask("T4", "更新 README 的接口文档", ["README.md"]),
        ]

    async def _run_one(self, task: SubTask) -> SubResult:
        async with self.sem:
            for attempt in range(1, self.max_retry + 2):
                worker = Worker(f"worker-{task.id}-{attempt}", f".worktrees/{task.id}")
                try:
                    res = await asyncio.wait_for(worker.run(task, fail_rate=0.35), self.timeout)
                    res.attempts = attempt
                    return res
                except Exception as e:
                    print(f"   ⚠️  {task.id} 第 {attempt} 次失败：{e}，{'重试' if attempt <= self.max_retry else '放弃'}")
            return SubResult(task.id, False, f"{task.goal} ✘ 已降级为人工处理", 0, self.max_retry + 1)

    def review(self, results: list[SubResult]) -> bool:
        """Reviewer：全部成功才允许合并；否则只合并成功部分并给出报告"""
        return all(r.ok for r in results)

    async def run(self, goal: str) -> None:
        tasks = self.plan(goal)
        print(f"🧭 Planner 拆解为 {len(tasks)} 个子任务，最大并行 {self.sem._value}")
        t0 = time.perf_counter()
        results = await asyncio.gather(*(self._run_one(t) for t in tasks))
        cost = time.perf_counter() - t0
        for r in results:
            print(f"   {'✅' if r.ok else '❌'} {r.task_id} | 尝试 {r.attempts} 次 | 子上下文 {r.context_tokens} tokens | {r.summary}")
        sub_tokens = sum(r.context_tokens for r in results)
        main_tokens = sum(len(r.summary) for r in results)
        print(f"⏱️  并行总耗时 {cost:.2f}s")
        print(f"🧠 主智能体只接收摘要 ≈{main_tokens} 字符，而子智能体共读取 {sub_tokens} tokens（主上下文节省 >95%）")
        print("🔍 Reviewer：" + ("全部通过，合并所有 worktree" if self.review(results) else "存在失败任务，仅合并成功部分并生成报告"))


if __name__ == "__main__":
    random.seed(7)
    print("=" * 72)
    asyncio.run(Orchestrator().run("全仓库质量提升"))
    print("=" * 72)
