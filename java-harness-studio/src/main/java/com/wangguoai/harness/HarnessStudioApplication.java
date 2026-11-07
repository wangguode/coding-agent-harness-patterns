package com.wangguoai.harness;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * WG Harness Studio · 编码智能体工程平台启动入口
 *
 * <p>启动后默认监听 {@code http://localhost:8090}，无需配置任何外部密钥即可通过内置
 * Mock 引擎体验完整的 Agent Loop、Hooks 护栏、人工审批 (HITL)、上下文压缩 (/compact)、
 * MCP 工具协议与单测自我验证闭环；配置 {@code LLM_API_KEY} 后自动切换真实大模型。
 */
@SpringBootApplication
public class HarnessStudioApplication {

    public static void main(String[] args) {
        SpringApplication.run(HarnessStudioApplication.class, args);
    }
}
