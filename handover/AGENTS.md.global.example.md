# 用户全局指令（~/.dsh/AGENTS.md，对所有会话生效）

> 用法：复制本文件为 `~/.dsh/AGENTS.md`（Windows：`C:\Users\<用户名>\.dsh\AGENTS.md`）。

## OpenViking 长期记忆
- 当工具列表中存在 mcp__openviking__* 工具时：会话开始先 recall/find 检索与本任务相关的记忆；会话收尾把重要结论、用户偏好、关键决策用 remember 写入 OpenViking。
- 会话默认隔离；跨会话衔接靠 OpenViking 记忆 + 工作区 AGENTS.md / .dsh/HANDOFF.md，两者互为补充。
- 写入记忆要精炼（一两句话一条），不要把大段上下文搬进去。

## 工作区衔接
- 开工先读工作区的 AGENTS.md 与 .dsh/HANDOFF.md（若存在），再看 git 状态与最近提交。
- 大任务用 subagent 委托以减轻主会话上下文压力；跨轮次长期目标用 goal 工具。
