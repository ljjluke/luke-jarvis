# .jarvis-archive（历史归档）

**这里不是 jarvis 状态根。**

本目录是「指纹采集P0」早期残留（`docs/` 四件产物 + `gates.json`）的归档：
它们产生于插件仓库自身被误当作 jarvis 工作区时（T12 只读预演 OBS-2 实证：仓库内嵌第二个 `.jarvis` 被写入 5 个 stamped 闸，但无任何产物支撑 → 造成假 PASS 状态根）。

- 状态根规则：**一个工作区只有一个 `.jarvis` 状态根**；插件仓库自身不存 `.jarvis`（见 README「一个工作区只有一个状态根」）。
- 保留原因：历史审计痕迹（`gates.json` 里含旧闸记录），不删不改，仅移出状态根位置。
- 真实项目的状态根在项目工作区（例如 `/opt/work/first/.jarvis`）。
