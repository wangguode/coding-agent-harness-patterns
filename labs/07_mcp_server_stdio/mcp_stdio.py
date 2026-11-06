"""
Lab 07 · MCP (Model Context Protocol) Server & Client 最小完整实现 (JSON-RPC 2.0 over stdio)

参考 anthropics/mcp、github/github-mcp-server 的公开协议规范（JSON-RPC 2.0）：
    1. 完整实现 MCP 三大核心原语：
       - `initialize`：协议版本协商与服务端能力声明 (capabilities)
       - `tools/list`：自动从 Python 函数类型注解生成 JSON Schema 工具清单
       - `tools/call`：动态派发工具调用并包装标准 `content: [{"type": "text", "text": ...}]`
       - `resources/list` & `resources/read`：暴露结构化知识库资源 (`wg://docs/...`)
    2. 两种运行方式：
       - 默认自检模式 (`python3 mcp_stdio.py`)：单进程内通过内存管道演练完整 Client ⇄ Server 握手、工具发现、工具调用与资源读取
       - 真实 stdio 模式 (`python3 mcp_stdio.py --stdio`)：可被 Claude Code / Cursor / Codex 直接挂载为标准 MCP Server！
"""
from __future__ import annotations

import inspect
import json
import sys
from dataclasses import dataclass
from typing import Any, Callable


@dataclass
class McpTool:
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[..., Any]


@dataclass
class McpResource:
    uri: str
    name: str
    mime_type: str
    content: str


class MinimalMcpServer:
    """支持工具装饰器自动注册与 JSON-RPC 2.0 路由的轻量级 MCP Server。"""

    def __init__(self, name: str = "wg-harness-mcp", version: str = "0.2.0"):
        self.name = name
        self.version = version
        self.tools: dict[str, McpTool] = {}
        self.resources: dict[str, McpResource] = {}

    def tool(self, description: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """装饰器：根据 Python 函数签名自动提取 JSON Schema 并注册为 MCP 工具。"""

        def _decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
            sig = inspect.signature(fn)
            props: dict[str, Any] = {}
            required: list[str] = []
            for param_name, param in sig.parameters.items():
                py_type = param.annotation
                json_type = "integer" if py_type is int else "number" if py_type is float else "string"
                props[param_name] = {"type": json_type}
                if param.default is inspect.Parameter.empty:
                    required.append(param_name)

            self.tools[fn.__name__] = McpTool(
                name=fn.__name__,
                description=description,
                input_schema={"type": "object", "properties": props, "required": required},
                handler=fn,
            )
            return fn

        return _decorator

    def add_resource(self, uri: str, name: str, content: str, mime_type: str = "text/markdown") -> None:
        self.resources[uri] = McpResource(uri=uri, name=name, mime_type=mime_type, content=content)

    def handle_rpc(self, raw_request: str) -> str | None:
        """处理单条 JSON-RPC 2.0 请求并返回序列化后的响应字符串。"""
        req = json.loads(raw_request)
        method = req.get("method", "")
        req_id = req.get("id")
        params = req.get("params") or {}

        # Notification（无 id，无需回复）
        if req_id is None:
            return None

        try:
            if method == "initialize":
                result = {
                    "protocolVersion": "2024-11-05",
                    "serverInfo": {"name": self.name, "version": self.version},
                    "capabilities": {"tools": {}, "resources": {}},
                }
            elif method == "tools/list":
                result = {
                    "tools": [
                        {
                            "name": t.name,
                            "description": t.description,
                            "inputSchema": t.input_schema,
                        }
                        for t in self.tools.values()
                    ]
                }
            elif method == "tools/call":
                tool_name = params.get("name", "")
                args = params.get("arguments") or {}
                if tool_name not in self.tools:
                    raise KeyError(f"未知的 MCP 工具: {tool_name}")
                out = self.tools[tool_name].handler(**args)
                result = {
                    "content": [{"type": "text", "text": json.dumps(out, ensure_ascii=False)}],
                    "isError": False,
                }
            elif method == "resources/list":
                result = {
                    "resources": [
                        {"uri": r.uri, "name": r.name, "mimeType": r.mime_type}
                        for r in self.resources.values()
                    ]
                }
            elif method == "resources/read":
                uri = params.get("uri", "")
                if uri not in self.resources:
                    raise KeyError(f"未知的 MCP 资源: {uri}")
                r = self.resources[uri]
                result = {
                    "contents": [{"uri": r.uri, "mimeType": r.mime_type, "text": r.content}]
                }
            else:
                raise ValueError(f"不支持的 JSON-RPC 方法: {method}")

            return json.dumps({"jsonrpc": "2.0", "id": req_id, "result": result}, ensure_ascii=False)
        except Exception as e:
            return json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32602, "message": str(e)},
                },
                ensure_ascii=False,
            )

    def serve_stdio(self) -> None:
        """阻塞监听 stdin 并向 stdout 输出 JSON-RPC 响应（标准 MCP stdio 传输）。"""
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            resp = self.handle_rpc(line)
            if resp:
                sys.stdout.write(resp + "\n")
                sys.stdout.flush()


def build_demo_server() -> MinimalMcpServer:
    srv = MinimalMcpServer()

    @srv.tool("诊断实时语音网关端到端延迟并给出优化建议")
    def diagnose_voice_latency(asr_ms: int, llm_ttft_ms: int, tts_ttfb_ms: int) -> dict[str, Any]:
        total = asr_ms + llm_ttft_ms + tts_ttfb_ms
        bottleneck = max(
            [("ASR", asr_ms), ("LLM_TTFT", llm_ttft_ms), ("TTS_TTFB", tts_ttfb_ms)],
            key=lambda x: x[1],
        )[0]
        return {
            "total_e2e_ms": total,
            "grade": "EXCELLENT (<600ms)" if total < 600 else "NEEDS_TUNING",
            "bottleneck": bottleneck,
            "advice": "关闭 DeepSeek thinking 模式并开启 SOXR 8k->16k 流式重采样",
        }

    @srv.tool("检查 Agent Loop 是否存在重复工具调用死循环风险")
    def check_loop_convergence(tool_name: str, consecutive_repeats: int) -> dict[str, Any]:
        return {
            "tool": tool_name,
            "should_circuit_break": consecutive_repeats >= 3,
            "action": "FORCE_REFLECT_OR_ABORT" if consecutive_repeats >= 3 else "CONTINUE",
        }

    srv.add_resource(
        uri="wg://docs/seven-layer-agent",
        name="AI Agent 七层工程架构规范",
        content="# 七层架构：L1 原子计算 -> L2 智能算子 -> L3 增强接入 -> L4 控制流 -> L5 交互协同 -> L6 状态管理 -> L7 编排治理",
    )
    return srv


def main() -> None:
    srv = build_demo_server()
    if "--stdio" in sys.argv:
        srv.serve_stdio()
        return

    print("=" * 72)
    print("🔌 Lab 07 · MCP (JSON-RPC 2.0) 握手 → 工具发现 → 工具调用 → 资源读取")
    print("=" * 72)
    requests = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"clientInfo": {"name": "wg-cli"}}},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "diagnose_voice_latency",
                "arguments": {"asr_ms": 80, "llm_ttft_ms": 240, "tts_ttfb_ms": 95},
            },
        },
        {
            "jsonrpc": "2.0",
            "id": 4,
            "method": "resources/read",
            "params": {"uri": "wg://docs/seven-layer-agent"},
        },
    ]
    for req in requests:
        resp_str = srv.handle_rpc(json.dumps(req))
        resp = json.loads(resp_str or "{}")
        print(f"➡️  Request  #{req['id']} [{req['method']}]")
        print(f"⬅️  Response #{req['id']}: {json.dumps(resp.get('result'), ensure_ascii=False)[:115]}")
    print("=" * 72)


if __name__ == "__main__":
    main()
