"""
Lab 03 · Agent Skills 渐进式披露（Progressive Disclosure）

参考 anthropics/skills、obra/superpowers、addyosmani/agent-skills 的公开约定（脱敏重写）：
    - 每个技能是一个目录，包含 SKILL.md（YAML frontmatter: name / description + 正文指令）
    - 第 1 层：启动时只把 name + description 放进系统提示（几十 token / 技能）
    - 第 2 层：任务命中某技能时，才把 SKILL.md 正文加载进上下文
    - 第 3 层：正文中引用的 scripts/、references/ 按需再读
    → 安装 100 个技能也不会撑爆上下文

零依赖，可直接运行：python3 skills_loader.py
"""
from __future__ import annotations

import os
import re
import tempfile
from dataclasses import dataclass

DEMO_SKILLS = {
    "pdf-report": (
        "生成 PDF 报告。当用户要求导出报告、PDF、周报时使用。",
        "1. 先收集数据\n2. 运行 scripts/render.py 渲染\n3. 校验页数与目录",
    ),
    "sql-review": (
        "审查 SQL 的性能与安全问题。当用户提交 SQL、慢查询、索引问题时使用。",
        "1. 检查是否全表扫描\n2. 检查注入风险\n3. 给出索引建议",
    ),
    "voice-latency": (
        "诊断语音机器人端到端延迟。当用户提到 ASR/TTS 延迟、打断、首包时间时使用。",
        "1. 拆解 VAD/ASR/LLM/TTS 各段耗时\n2. 对比首包 TTFB\n3. 输出优化清单",
    ),
}


@dataclass
class SkillMeta:
    name: str
    description: str
    path: str


def parse_frontmatter(text: str) -> tuple[dict, str]:
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        return {}, text
    meta = dict(line.split(":", 1) for line in m.group(1).splitlines() if ":" in line)
    return {k.strip(): v.strip() for k, v in meta.items()}, m.group(2)


class SkillRegistry:
    def __init__(self, root: str):
        self.skills: list[SkillMeta] = []
        for d in sorted(os.listdir(root)):
            p = os.path.join(root, d, "SKILL.md")
            if os.path.exists(p):
                meta, _ = parse_frontmatter(open(p, encoding="utf-8").read())
                self.skills.append(SkillMeta(meta["name"], meta["description"], p))

    def system_prompt_index(self) -> str:
        """第 1 层：只暴露索引"""
        lines = [f"- {s.name}: {s.description}" for s in self.skills]
        return "可用技能（命中时再加载正文）：\n" + "\n".join(lines)

    def match(self, task: str) -> SkillMeta | None:
        """真实系统由模型自行判断；这里用关键词重叠模拟"""
        def score(s: SkillMeta) -> int:
            keys = re.findall(r"[A-Za-z]+|[\u4e00-\u9fff]{2}", s.description)
            return sum(1 for k in keys if k in task)
        best = max(self.skills, key=score)
        return best if score(best) > 0 else None

    def load_body(self, s: SkillMeta) -> str:
        """第 2 层：按需加载正文"""
        return parse_frontmatter(open(s.path, encoding="utf-8").read())[1]


def main() -> None:
    with tempfile.TemporaryDirectory() as root:
        for name, (desc, body) in DEMO_SKILLS.items():
            os.makedirs(os.path.join(root, name))
            with open(os.path.join(root, name, "SKILL.md"), "w", encoding="utf-8") as f:
                f.write(f"---\nname: {name}\ndescription: {desc}\n---\n{body}\n")

        reg = SkillRegistry(root)
        index = reg.system_prompt_index()
        full = sum(len(open(s.path, encoding="utf-8").read()) for s in reg.skills)
        print("=" * 72)
        print(index)
        print(f"\n📉 索引 {len(index)} 字符 vs 全量加载 {full} 字符")
        print("=" * 72)
        for task in ["电话机器人的 TTS 首包延迟太高，打断不灵敏", "帮我看下这条慢查询 SQL", "今天天气怎么样"]:
            hit = reg.match(task)
            print(f"🧑 任务：{task}")
            if hit:
                print(f"   🎯 命中技能 {hit.name}，加载正文：{reg.load_body(hit).strip().replace(chr(10), ' / ')}")
            else:
                print("   ⏭️  无匹配技能，不加载任何正文")


if __name__ == "__main__":
    main()
