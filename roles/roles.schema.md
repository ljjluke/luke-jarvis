# Jarvis 数字员工公司 · 领域角色卡库 Schema v2

> 按领域组织的**参考角色库**。每个领域一个 JSON：`domains/<domain-id>.json`。
> 需求 → CEO 识别领域 → **现场 web 蒸馏该领域真人大佬作 CEO 人设** → CEO 立项（定步骤+现场蒸馏各下属角色卡）。
>
> ⚠️ **重要——本库是"去哪找真人/覆盖哪些职责"的参考目录，不是可直接复用的角色卡内容。**
> 系数 v2 铁律：**每次建队，所有角色卡（含 CEO 卡）都必须现场 web 搜索真实权威 → 写六段式 → `jarvis_distill` 校验后产出**；`.jarvis-roles/*.json` 与 `domains/*.json` 里的 `distilledFrom/source/persona/roleCard` 只作"该领域可考虑的真实人物方向 + 职责结构提示"，**绝不直接复制/注入**为本次成员的角色（否则就是"套旧卡"，违背"每次新蒸馏"的立项目标）。

## 领域 JSON 结构

```jsonc
{
  "id": "software-dev",          // 领域唯一 id
  "name": "软件开发",
  "description": "一句话描述",
  "ceo": {                        // 该领域动态 CEO（真人大佬蒸馏）
    "distilledFrom": "Linus Torvalds",
    "source": "公开方法论出处（防冒名关键）",
    "persona": "六段式 CEO 人设（身份/思维/方法论/红线/风格/出处声明）"
  },
  "roles": {                      // 该领域下属角色卡索引
    "engineer": {
      "name": "研发工程师",
      "distilledFrom": "Kent Beck",
      "source": "TDD 公开方法论",
      "file": "engineer.json"     // 完整卡存 roles/ 目录
    }
  },
  "triage": {                     // 该领域的分级规则
    "S": "…直接做",
    "M": "…精简公司",
    "L": "…全链公司"
  },
  "keywords": ["系统", "软件", …]  // 领域识别关键词
}
```

## 完整角色卡（roles/<file>）结构

沿用 v1 六段式 + 元数据：`{id, name, distilledFrom, source, whenToUse, failureModes, roleCard, operations, calibration, style}`

## 立项流程（CEO 协议，铁律=现场蒸馏不复用旧卡）

1. 收到需求 → 用 `jarvis_project` 工具识别领域（关键词匹配）
2. **现场 web 蒸馏 CEO 卡**：按本次需求的具体业务上下文，web 搜索该领域真实权威 → 六段式 + 协同架构 + source + 防冒名 → `jarvis_distill` 校验（本库 `ceo.distilledFrom` 仅提示"该领域可能往哪找真人"，不锁定人选）
3. CEO 立项：明确成功标准 → 定步骤（任务 DAG）→ **现场蒸馏各下属角色卡**（每个都 web 搜真人+写卡+校验；本库 `roles` 仅提示"该职责覆盖什么、可考虑哪位"）
4. 设计协同架构（各角色位置/依赖/介入时机/协同方式）→ 建队执行（agent_teams_*）
5. 建队时 `role` 字段写入**现场蒸馏的 roleCard**，非本库预置内容

## 防冒名铁律（不变）

- 每个 CEO/角色卡必须带 `source` 真实出处
- 产出只写"借鉴其方法"，不写"某大师认为"
- 汇总报告附脚注："本交付借鉴了以下公开方法论框架，非本人观点"
