import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WG CodeX — Coding Agent & Harness Engineering Workbench",
  description:
    "Production Coding Agent & Harness Workbench with MCP Servers, SKILL.md Registry, Guardrails, Context Compaction, and Mac/Windows support.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
