# Vercel + Render 部署（推荐）

## 结论

该项目后端依赖（librosa/scipy/numba）体积较大，Vercel Functions 会超包大小限制。
最稳的方案是：

- Vercel：部署前端（手机访问）
- Render：部署后端 API

## 1) 部署后端到 Render

1. 打开 Render，新建 `Web Service`，选择仓库 `Nana-27-L/my-music-helper`
2. Runtime 选 `Docker`
3. Dockerfile Path 设为：`Dockerfile.render-free`
4. Health Check Path：`/api/health`
5. 部署后记下后端地址，例如：
   `https://your-backend.onrender.com`

## 2) 部署前端到 Vercel

1. 在 Vercel 项目里进入 `Settings -> Environment Variables`
2. 新增变量：
   - Name: `VITE_API_BASE_URL`
   - Value: `https://your-backend.onrender.com`
3. 保存后，`Redeploy`

## 3) 验证

- 前端：`https://your-frontend.vercel.app/`
- 后端：`https://your-backend.onrender.com/api/health`

如果两者都能打开，就可以在手机浏览器直接使用前端。
