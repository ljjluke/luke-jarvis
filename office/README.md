# 像素办公室（PixOffice 内嵌）

## 来源与授权
- 代码：来自 [workbzw/pixoffice](https://github.com/workbzw/pixoffice)（**MIT**，见 `LICENSE-pixoffice-MIT.txt`）
- 美术素材（人物帧动画/场景图）：**未包含在 MIT 授权内**（原作者在 `THIRD_PARTY_NOTICES.txt` 明确排除 artwork）。
  → 当前仅用于**本地功能验证**；对外分发/商用前必须替换素材或取得作者授权。

## 访问
dsh 启动后打开：`http://<dsh 地址>/jarvis-office/`

## 数据
页面读取 `GET /api/luke-jarvis/company`（同源，由 luke-jarvis 提供），
数据源是当前工作区 `.jarvis/company-state.json`（由 `jarvis_company` 工具写入）。
