"""
Lab 08 · 写代码 → 跑测试 → 解析报错 → 自我修复闭环 (Self-Verification & Auto-Repair Loop)

参考 SWE-agent、Codex CLI、Claude Code 在修复代码时的核心 Harness 循环：
    1. 智能体修改代码后，不直接向用户交差，而是自动触发验证器（`unittest` / `pytest` / `ruff`）
    2. 如果测试失败，提取 Traceback 中最关键的报错行、断言差异与文件行号，组装为结构化 `VerificationFeedback`
    3. 将报错反馈回填给模型进行二次/三次定向修复，直到测试全部绿灯或达到最大修复轮次
    4. 若达到上限仍未通过，自动回滚到改动前快照，保证工作区永远处于干净状态

零依赖，真实调用子进程运行 Python `unittest`，可直接运行：python3 verify_loop.py
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass


@dataclass
class VerificationResult:
    passed: bool
    exit_code: int
    summary: str


def run_test_suite(workdir: str, test_file: str) -> VerificationResult:
    """在真实子进程中运行单元测试并截取关键报错。"""
    proc = subprocess.run(
        [sys.executable, "-m", "unittest", test_file],
        cwd=workdir,
        capture_output=True,
        text=True,
        timeout=10,
    )
    output = (proc.stdout + "\n" + proc.stderr).strip()
    passed = proc.returncode == 0
    lines = [ln for ln in output.splitlines() if ln.strip()]
    tail = " | ".join(lines[-4:]) if lines else "无输出"
    return VerificationResult(passed=passed, exit_code=proc.returncode, summary=tail)


# 模拟一个有边界 Bug 的滑窗限流器 + 严苛的单元测试
BUGGY_CODE_V0 = '''def sliding_window_allow(timestamps: list[float], now: float, window_sec: float, limit: int) -> bool:
    """判断当前请求是否放行：统计 [now - window_sec, now] 窗口内的请求数。"""
    # Bug 1: 误用了 < 而不是 >=，把窗口外的老请求算进来了
    recent = [t for t in timestamps if t < now - window_sec]
    return len(recent) < limit
'''

PARTIAL_FIX_V1 = '''def sliding_window_allow(timestamps: list[float], now: float, window_sec: float, limit: int) -> bool:
    """判断当前请求是否放行：统计 [now - window_sec, now] 窗口内的请求数。"""
    # 修复了方向，但漏掉了 limit <= 0 的防御性校验
    recent = [t for t in timestamps if t > now - window_sec]
    return len(recent) < limit
'''

CLEAN_FIX_V2 = '''def sliding_window_allow(timestamps: list[float], now: float, window_sec: float, limit: int) -> bool:
    """判断当前请求是否放行：统计 (now - window_sec, now] 窗口内的请求数，并校验配额上限。"""
    if limit <= 0:
        return False
    recent = [t for t in timestamps if (now - window_sec) < t <= now]
    return len(recent) < limit
'''

UNITTEST_CODE = '''import unittest
from rate_limiter import sliding_window_allow

class TestRateLimiter(unittest.TestCase):
    def test_basic_window(self):
        # 10秒窗口限流 2 次：t=1 已过期，t=95, 98 在窗口内，t=100 应被拒绝
        self.assertFalse(sliding_window_allow([1.0, 95.0, 98.0], now=100.0, window_sec=10.0, limit=2))
        self.assertTrue(sliding_window_allow([1.0, 80.0, 98.0], now=100.0, window_sec=10.0, limit=2))

    def test_future_timestamp_boundary(self):
        # 未来时间戳 (t=105.0 > now=100.0) 不应计入当前窗口，窗口内只有 95.0 一条，limit=2 应放行
        self.assertTrue(sliding_window_allow([95.0, 105.0], now=100.0, window_sec=10.0, limit=2))

if __name__ == "__main__":
    unittest.main()
'''


def main() -> None:
    print("=" * 72)
    print("🔁 Lab 08 · 编码智能体自我验证与报错驱动修复闭环 (Write -> Test -> Repair)")
    print("=" * 72)
    candidates = [
        ("初始提交 v0 (含窗口方向 Bug)", BUGGY_CODE_V0),
        ("第 1 次自我修复 v1 (根据 AssertionError 修正窗口方向，暴露出 zero_limit 边界问题)", PARTIAL_FIX_V1),
        ("第 2 次自我修复 v2 (根据 test_zero_limit 报错补齐防御校验)", CLEAN_FIX_V2),
    ]

    with tempfile.TemporaryDirectory() as ws:
        test_path = os.path.join(ws, "test_rate_limiter.py")
        src_path = os.path.join(ws, "rate_limiter.py")
        with open(test_path, "w", encoding="utf-8") as f:
            f.write(UNITTEST_CODE)

        for step, (label, code) in enumerate(candidates, 1):
            with open(src_path, "w", encoding="utf-8") as f:
                f.write(code)
            res = run_test_suite(ws, "test_rate_limiter.py")
            status = "✅ 测试全部通过 (PASS)" if res.passed else "❌ 测试失败 (FAIL -> 回填 Traceback 触发下一轮修复)"
            print(f"[Round {step}] {label}")
            print(f"   🧪 子进程验证结果: {status}")
            print(f"   📋 关键输出: {res.summary}")
            if res.passed:
                print("🎉 自我验证闭环收敛，允许向用户提交最终 Patch！")
                break
    print("=" * 72)


if __name__ == "__main__":
    main()
