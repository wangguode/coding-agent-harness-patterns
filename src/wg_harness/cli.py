"""
wg-harness 命令行工具：一键列出、运行全部 8 个编码智能体 Harness 设计模式，或启动标准 MCP Server。

用法：
    wg-harness list          # 列出全部 8 个 Harness 设计模式
    wg-harness run all       # 依次运行全部 8 个模式并输出验证报告
    wg-harness run 07        # 运行指定编号的模式（如 07 MCP Server）
    wg-harness mcp-stdio     # 启动标准 JSON-RPC 2.0 MCP Server (可挂载至 Claude Code / Cursor)
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

PATTERNS = [
    ("01", "labs/01_agent_loop/agent_loop.py", "Agent Loop 主循环与三档沙箱审批策略"),
    ("02", "labs/02_context_compaction/compaction.py", "上下文自动裁剪与结构化摘要压缩 (/compact)"),
    ("03", "labs/03_skills_progressive_disclosure/skills_loader.py", "Agent Skills 三层渐进式披露加载器"),
    ("04", "labs/04_subagent_orchestration/subagents.py", "Planner-Worker-Reviewer 并行子智能体编排"),
    ("05", "labs/05_hooks_guardrails/hooks.py", "Pre/PostToolUse 安全护栏、密钥脱敏与审计日志"),
    ("06", "labs/06_agent_memory/memory.py", "跨会话观察提炼与时间衰减记忆检索"),
    ("07", "labs/07_mcp_server_stdio/mcp_stdio.py", "MCP (Model Context Protocol) JSON-RPC 2.0 服务端与客户端"),
    ("08", "labs/08_self_verification_loop/verify_loop.py", "写代码 → 跑测试 → 读报错 → 自动修复闭环"),
]


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser(prog="wg-harness", description="编码智能体 Harness 设计模式工具箱")
    sub = parser.add_subparsers(dest="cmd")
    sub.add_parser("list", help="列出全部可运行的 Harness 设计模式")

    run_p = sub.add_parser("run", help="运行指定编号或全部模式 (01~08 或 all)")
    run_p.add_argument("target", nargs="?", default="all", help="模式编号 (如 01, 07) 或 all")

    sub.add_parser("mcp-stdio", help="以标准 stdio 模式启动内置 MCP Server")

    args = parser.parse_args()
    root = _repo_root()

    if args.cmd == "list":
        print("🧩 coding-agent-harness-patterns (v0.2.0) 模式清单：")
        for num, rel, desc in PATTERNS:
            print(f"  [{num}] {desc:44} -> python3 {rel}")
        return

    if args.cmd == "mcp-stdio":
        script = root / "labs/07_mcp_server_stdio/mcp_stdio.py"
        os.execv(sys.executable, [sys.executable, str(script), "--stdio"])

    target = getattr(args, "target", "all")
    selected = PATTERNS if target == "all" else [p for p in PATTERNS if p[0] == target.zfill(2)]
    if not selected:
        print(f"未找到编号为 {target} 的模式，请使用 `wg-harness list` 查看。")
        sys.exit(1)

    for num, rel, desc in selected:
        print(f"\n>>> 正在运行 [{num}] {desc} ({rel})")
        subprocess.run([sys.executable, str(root / rel)], check=True)


if __name__ == "__main__":
    main()
