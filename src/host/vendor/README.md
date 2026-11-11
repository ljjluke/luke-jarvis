# vendor: dsh-superagent 复用代码

来源：https://github.com/deepseek-ai/dsh-superagent-prototype （MIT，见 LICENSE-dsh-superagent-MIT.txt）

| 文件 | 用途 | 是否需要改 |
|---|---|---|
| `superagent-background.ts` | 后台存活 + 完成唤醒：回合结束但 shell 作业/子代理仍在跑时保持 slot，完成时唤醒；30 分钟上限；停止时杀死作业、释放子代理 | 原样复用（仅类型依赖，逻辑不改） |

**未复用**（与 jarvis 场景不符）：GitHub/Feishu Source、Trigger/Eval/Mandate 授权模型、内存仓储 memory.ts。
