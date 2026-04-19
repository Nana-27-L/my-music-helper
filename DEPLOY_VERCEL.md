# Vercel 部署指南（SingMyKey）

这份仓库已经做了 Vercel 适配：

- 根目录 `app.py` 作为 Python 入口（FastAPI）
- 根目录 `requirements.txt` 供 Vercel 安装 Python 依赖
- `vercel.json` 使用 `scripts/build-vercel.mjs` 自动构建前端到 `public/`

## 一、先把代码推到 GitHub

在项目根目录执行：

```bash
git add app.py requirements.txt .python-version vercel.json scripts/build-vercel.mjs backend/app/main.py backend/app/services/profiles.py
git commit -m "add Vercel deployment support"
```

如果你还没有 GitHub 远程仓库：

```bash
git remote add github https://github.com/<你的用户名>/<你的仓库名>.git
git push -u github main
```

如果已经配置过 `github` 远程：

```bash
git push github main
```

## 二、在 Vercel 创建项目

1. 打开 `https://vercel.com/new`
2. 选择你的 GitHub 仓库并 `Import`
3. Framework Preset 选 `Other`
4. Root Directory 保持仓库根目录（不要改成 `frontend`）
5. 点击 `Deploy`

Vercel 会自动读取仓库里的 `vercel.json`。

## 三、验证上线

部署完成后访问：

- `https://<你的项目>.vercel.app/`
- `https://<你的项目>.vercel.app/api/health`

健康检查期望返回：

```json
{"status":"ok","service":"SingMyKey API"}
```

## 四、重要限制（Vercel 免费版）

- 函数文件系统是临时的，重启后会丢失；本项目的音域档案会写入 `/tmp`，不保证长期保存。
- 函数有执行时长和请求体大小限制，长音频/大文件处理可能失败。

如果你希望“稳定保存档案 + 更大文件处理”，建议后端继续放 Render/Railway，Vercel 只放前端。
