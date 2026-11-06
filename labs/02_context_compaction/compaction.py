"""
Lab 02 · 上下文压缩（Context Compaction，对应 /compact 能力）

长任务里上下文会被工具输出撑爆。主流编码智能体的通用做法：
    1. 估算 token 占用，超过阈值（如窗口的 80%）自动触发压缩
    2. 保留：系统提示 + 最近 N 轮原文 + 用户原始任务
    3. 中间历史 -> 结构化摘要（目标 / 已完成 / 关键发现 / 待办）
    4. 大块工具输出先“裁剪”（只留头尾），再考虑摘要

零依赖，可直接运行：python3 compaction.py
"""
from __future__ import annotations

from dataclasses import dataclass


def estimate_tokens(text: str) -> int:
    """粗略估算：中文约 1 字 ≈ 1 token，英文约 4 字符 ≈ 1 token"""
    cjk = sum(1 for c in text if "\u4e00" <= c <= "\u9fff")
    return cjk + (len(text) - cjk) // 4 + 1


def trim_tool_output(text: str, head: int = 200, tail: int = 200) -> str:
    """大块工具输出只保留头尾，中间用省略标记替代"""
    if len(text) <= head + tail:
        return text
    return f"{text[:head]}\n...[已裁剪 {len(text) - head - tail} 字符]...\n{text[-tail:]}"


@dataclass
class Msg:
    role: str
    content: str


class Compactor:
    def __init__(self, window: int = 2000, trigger_ratio: float = 0.8, keep_recent: int = 4):
        self.window = window
        self.trigger = int(window * trigger_ratio)
        self.keep_recent = keep_recent

    def usage(self, msgs: list[Msg]) -> int:
        return sum(estimate_tokens(m.content) for m in msgs)

    def summarize(self, middle: list[Msg]) -> str:
        """真实系统中由 LLM 生成；这里用规则抽取，演示结构化摘要格式"""
        done = [m.content[:30] for m in middle if m.role == "assistant"]
        findings = [m.content[:40] for m in middle if m.role == "tool" and "发现" in m.content]
        return (
            "【上下文摘要】\n"
            f"- 已完成步骤：{len(done)} 步，例如：{'; '.join(done[:3])}\n"
            f"- 关键发现：{'; '.join(findings[:3]) or '无'}\n"
            f"- 被压缩的消息数：{len(middle)}"
        )

    def maybe_compact(self, msgs: list[Msg]) -> list[Msg]:
        # 第一步：先裁剪超长工具输出（便宜、无信息损失风险低）
        msgs = [Msg(m.role, trim_tool_output(m.content)) if m.role == "tool" else m for m in msgs]
        if self.usage(msgs) < self.trigger:
            return msgs
        # 第二步：系统提示 + 首条用户任务固定保留，中间摘要，最近 N 条原文保留
        head = [m for m in msgs[:2] if m.role in ("system", "user")]
        tail = msgs[-self.keep_recent:]
        middle = msgs[len(head): len(msgs) - self.keep_recent]
        return head + [Msg("system", self.summarize(middle))] + tail


def main() -> None:
    msgs = [Msg("system", "你是编码智能体，遵守仓库规范。"), Msg("user", "把项目中所有同步 HTTP 调用改为异步")]
    for i in range(1, 16):
        msgs.append(Msg("assistant", f"第{i}步：搜索并修改 service_{i}.py 中的 requests 调用"))
        log = f"发现 service_{i}.py 有 {i} 处同步调用。" + "日志行 " * 300
        msgs.append(Msg("tool", log))

    c = Compactor()
    before = c.usage(msgs)
    after_msgs = c.maybe_compact(msgs)
    after = c.usage(after_msgs)
    print("=" * 72)
    print(f"📦 压缩前：{len(msgs)} 条消息 / ≈{before} tokens（窗口 {c.window}，阈值 {c.trigger}）")
    print(f"✂️  压缩后：{len(after_msgs)} 条消息 / ≈{after} tokens，节省 {100 - after * 100 // before}%")
    print("=" * 72)
    for m in after_msgs:
        print(f"[{m.role:9}] {m.content[:90].replace(chr(10), ' | ')}")


if __name__ == "__main__":
    main()
