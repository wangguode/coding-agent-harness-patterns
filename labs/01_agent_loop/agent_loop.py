"""
Lab 01 · 最小编码智能体主循环（Codex / Claude Code 式 Agent Loop）

核心思想（参考 openai/codex、anthropics/claude-code、anomalyco/opencode 的公开设计，脱敏重写）：
    1. 模型输出 = 文本回复 或 工具调用（tool_call）
    2. Harness 执行工具，把观察结果（observation）回填进上下文
    3. 循环直到模型不再调用工具，或触发最大轮次 / 审批拒绝
    4. 沙箱审批策略：read-only / workspace-write / full-access 三档

零依赖，内置 MockModel，可直接运行：python3 agent_loop.py
"""
from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, field
from typing import Callable

# ---------------------------------------------------------------------------
# 1. 工具注册表：每个工具声明自己是否会“写”，供审批策略判断
# ---------------------------------------------------------------------------


@dataclass
class Tool:
    name: str
    description: str
    writes: bool  # 是否产生副作用（写文件 / 执行命令）
    fn: Callable[..., str]


class ToolRegistry:
    def __init__(self, workspace: str):
        self.workspace = workspace
        self.tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        self.tools[tool.name] = tool

    def _safe_path(self, rel: str) -> str:
        # 路径逃逸防护：禁止访问工作区之外的文件
        full = os.path.realpath(os.path.join(self.workspace, rel))
        if not full.startswith(os.path.realpath(self.workspace)):
            raise PermissionError(f"路径越界: {rel}")
        return full

    def schema(self) -> list[dict]:
        """给模型看的工具清单（真实系统里是 JSON Schema）"""
        return [{"name": t.name, "description": t.description} for t in self.tools.values()]


def build_default_tools(reg: ToolRegistry) -> None:
    def read_file(path: str) -> str:
        with open(reg._safe_path(path), encoding="utf-8") as f:
            return f.read()

    def write_file(path: str, content: str) -> str:
        with open(reg._safe_path(path), "w", encoding="utf-8") as f:
            f.write(content)
        return f"已写入 {path}（{len(content)} 字符）"

    def list_dir(path: str = ".") -> str:
        return json.dumps(sorted(os.listdir(reg._safe_path(path))), ensure_ascii=False)

    reg.register(Tool("read_file", "读取工作区文件", False, read_file))
    reg.register(Tool("write_file", "写入工作区文件", True, write_file))
    reg.register(Tool("list_dir", "列出目录", False, list_dir))


# ---------------------------------------------------------------------------
# 2. 审批策略（Approval Policy）
# ---------------------------------------------------------------------------

POLICIES = ("read-only", "workspace-write", "full-access")


def approve(policy: str, tool: Tool) -> bool:
    if policy == "full-access":
        return True
    if policy == "workspace-write":
        return True  # 写操作已被 _safe_path 限定在工作区内
    return not tool.writes  # read-only：只放行无副作用工具


# ---------------------------------------------------------------------------
# 3. MockModel：用规则模拟 LLM 的“思考 -> 工具调用”，便于离线演示
# ---------------------------------------------------------------------------


class MockModel:
    """模拟任务：读取 bug.py，修复除零错误，写回文件。"""

    def __call__(self, messages: list[dict], tools: list[dict]) -> dict:
        observations = [m for m in messages if m["role"] == "tool"]
        step = len(observations)
        if step == 0:
            return {"tool_call": {"name": "list_dir", "args": {"path": "."}}}
        if step == 1:
            return {"tool_call": {"name": "read_file", "args": {"path": "bug.py"}}}
        if step == 2:
            src = observations[-1]["content"]
            fixed = src.replace("return a / b", "return a / b if b else 0.0")
            return {"tool_call": {"name": "write_file", "args": {"path": "bug.py", "content": fixed}}}
        return {"text": "已修复 bug.py 中的除零问题：b 为 0 时返回 0.0。"}


# ---------------------------------------------------------------------------
# 4. Agent Loop 本体
# ---------------------------------------------------------------------------


@dataclass
class AgentLoop:
    model: Callable[[list[dict], list[dict]], dict]
    registry: ToolRegistry
    policy: str = "workspace-write"
    max_turns: int = 8
    messages: list[dict] = field(default_factory=list)

    def run(self, user_task: str) -> str:
        self.messages.append({"role": "user", "content": user_task})
        for turn in range(1, self.max_turns + 1):
            out = self.model(self.messages, self.registry.schema())
            if "text" in out:  # 模型不再调用工具 -> 循环自然结束
                self.messages.append({"role": "assistant", "content": out["text"]})
                print(f"✅ [Turn {turn}] 最终回复: {out['text']}")
                return out["text"]

            call = out["tool_call"]
            tool = self.registry.tools.get(call["name"])
            self.messages.append({"role": "assistant", "tool_call": call})
            if tool is None:
                obs = f"错误：未知工具 {call['name']}"
            elif not approve(self.policy, tool):
                obs = f"拒绝：当前策略 {self.policy} 不允许执行 {tool.name}"
            else:
                try:
                    obs = tool.fn(**call["args"])
                except Exception as e:  # 工具异常也作为观察回填，让模型自我纠错
                    obs = f"工具异常：{e}"
            print(f"🔧 [Turn {turn}] {call['name']}({list(call['args'])}) -> {obs[:60]!r}")
            self.messages.append({"role": "tool", "name": call["name"], "content": obs})
            if obs.startswith("拒绝"):
                return "任务因审批策略中止"
        return "达到最大轮次，强制停止"


def main() -> None:
    with tempfile.TemporaryDirectory() as ws:
        with open(os.path.join(ws, "bug.py"), "w", encoding="utf-8") as f:
            f.write("def div(a, b):\n    return a / b\n")
        for policy in ("read-only", "workspace-write"):
            print("=" * 72)
            print(f"🛡️  审批策略 = {policy}")
            print("=" * 72)
            reg = ToolRegistry(ws)
            build_default_tools(reg)
            AgentLoop(MockModel(), reg, policy=policy).run("修复 bug.py 的除零错误")
        print("\n📄 修复后的 bug.py:\n" + open(os.path.join(ws, "bug.py"), encoding="utf-8").read())


if __name__ == "__main__":
    main()
