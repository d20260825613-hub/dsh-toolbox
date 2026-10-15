# 个人静态博客（Hugo + PaperMod + Cloudflare Pages / Wrangler CLI）

零服务器、零域名费用：本地写 Markdown → 跑一次 `deploy.ps1` → 公网 HTTPS 直接访问。

- 生成器：Hugo　主题：PaperMod（中文界面）　部署：Wrangler CLI 直传 Cloudflare Pages
- 公网地址：`https://__PROJECT__.pages.dev`（前缀 = Pages 项目名）
- 不使用 GitHub Actions，也不需要在 Cloudflare 网页端绑定仓库

---

## 一、首次使用（只需三步）

```
第 1 步：双击 run-bootstrap.cmd    自动装环境 + 建站 + 首次构建（已跑过可跳过）
第 2 步：在 PowerShell 里执行一次
         wrangler login            ← 弹出浏览器点 Allow 授权（全程仅此一次手工操作）
第 3 步：双击 run-deploy.cmd        构建并上传，公网地址立即生效
```

第 2 步如果浏览器没有自动弹出，就手动打开命令里打印的网址完成授权。

### 这几个文件分别在哪儿

初始化脚本和站点模板放在**本目录的上一级**（同一个安装文件夹里）：

```
hugo-blog-setup\                ← 安装文件夹（只管搭环境，不存放博客内容）
├─ run-bootstrap.cmd            ← ★ 双击这个开始（第 1 步）
├─ bootstrap.ps1                ← 它真正执行的脚本
└─ blog-template\               ← 站点源码样板（bootstrap 按它生成 blog\）
     ├─ config.toml.tpl         ┐ 带 .tpl 的三个文件里有占位符
     ├─ wrangler.toml.tpl       ├ __PROJECT__ / __TODAY__，
     ├─ README.md.tpl           ┘ 生成时会替换成真实值
     ├─ deploy.ps1              ← 复制成 blog\deploy.ps1
     └─ run-deploy.cmd          ← 复制成 blog\run-deploy.cmd
```

初始化跑完后，**你日常用的都是 `blog\` 里的文件**：

```
blog\                           ← 真正的博客站点（就是你现在看的这个目录）
├─ run-deploy.cmd               ← ★ 以后每次发文，双击这个（第 3 步）
├─ deploy.ps1                   ← run-deploy.cmd 调用的脚本
├─ config.toml                  ← 站点配置
├─ wrangler.toml                ← Pages 项目名 / 域名前缀
└─ content\posts\               ← 文章都放这里
```

> 需要用别的目录名或路径时，在 PowerShell 里这样运行（`-WorkDir` 决定站点建在哪）：
>
> ```powershell
> .\bootstrap.ps1 -WorkDir D:\sites\myblog -ProjectName wo-de-boke
> ```
>
> 脚本是幂等的：已经装好的 Hugo / Node / wrangler 会被跳过，已存在的文件不会被覆盖
> （除非显式加 `-Force`）。所以重复双击 `run-bootstrap.cmd` 是安全的。

### 想换一个更好看的地址前缀

编辑 `wrangler.toml`，把 `name` 改成你想要的前缀（只能用小写字母、数字、连字符），
例如 `name = "wo-de-boke"`，之后再部署，地址即 `https://wo-de-boke.pages.dev`。

> 前缀**全局唯一**，被占用会报错，换一个即可。
> 改 `name` 等于换一个新项目、新地址（旧的 `my-hugo-blog.pages.dev` 会保留原来的内容）。
>
> ⚠️ `wrangler.toml` 里**不要写中文**。`deploy.ps1` 要用 PowerShell 读取这个文件里的
> `name`，而 PowerShell 对「没有 BOM 的非 ASCII 文本」会按系统代码页（中文 Windows 是 GBK）
> 解码，可能把值读坏。这个文件出厂就是纯 ASCII，中文说明都在本文件里。

### 想换站点标题 / 简介

编辑 `config.toml`：

- `title = "我的个人博客"` → 站点名称
- `[params] description = "..."` → 简介（用于首页、RSS、SEO）
- `[params.homeInfoParams]` → 首页大字标题与介绍段落

---

## 二、目录结构

```
blog/
├─ config.toml            站点总配置（站名、简介、菜单、目录、分页）
├─ wrangler.toml          ★ Cloudflare Pages 项目配置（name = 域名前缀）
├─ deploy.ps1             ★ 一键部署：hugo 构建 + wrangler 上传
├─ run-deploy.cmd         双击入口（自动放行脚本执行策略 + 结束后暂停）
├─ archetypes/default.md  新文章模板
├─ content/
│  ├─ posts/              所有文章放这里
│  │  ├─ _index.md        文章列表页
│  │  └─ 三篇示例文章
│  ├─ archives.md         → /archives/
│  ├─ tags.md             → /tags/
│  ├─ search.md           → /search/
│  └─ about.md            → /about/
├─ static/                原样拷贝到网站根目录（图片放 static/images/）
├─ themes/PaperMod/       主题（Git 子模块）
└─ public/                构建产物（每次部署时重新生成，可随时删除）
```

> 环境初始化入口 `run-bootstrap.cmd` 不在这里：它在**上一级安装目录**里（和 `bootstrap.ps1` 一起），
> 只有第一次搭环境时才用得到。博客目录里没有它，也不需要有。

---

## 三、日常发文流程

```powershell
cd <博客目录>

# 1) 新建草稿
hugo new content posts/2026-02-01-文章名.md

# 2) 用任意编辑器打开写内容，写完把 front matter 里的 draft 改成 false

# 3) 本地预览（带草稿）
hugo server -D            # 浏览器打开 http://localhost:1313

# 4) 发布（双击 run-deploy.cmd 也行）
.\deploy.ps1
```

### front matter 速查

```yaml
---
title: "文章标题"                  # 必填 → 页面标题 + 网址路径
date: 2026-02-01T10:00:00+08:00    # 必填 → 排序 / 归档位置
lastmod: 2026-02-01T10:00:00+08:00 # 选填 → 「最后更新」
draft: false                       # ★ true = 草稿不上线
summary: "列表页显示的一句话"       # 选填
tags: ["Hugo", "教程"]              # 选填 → 生成标签聚合页
categories: ["技术笔记"]            # 选填
ShowToc: true                      # 是否显示右侧目录
TocOpen: false                     # 目录是否默认展开
---
```

### 常见操作

| 我想…… | 怎么做 |
| --- | --- |
| 临时下线某篇 | `draft` 改回 `true`，重新部署即消失 |
| 插入图片 | 图片放 `static/images/foo.png`，正文写 `![说明](/images/foo.png)` |
| 关掉某篇的目录 | 该篇 front matter 写 `ShowToc: false` |
| 改站点名 / 简介 | 改 `config.toml` 的 `title`、`[params] description` |
| 改导航菜单 | 改 `config.toml` 末尾的 `[[menu.main]]`，`weight` 决定顺序 |
| 每页显示文章数 | 改 `config.toml` 的 `paginate = 10` |
| 换地址前缀 | 改 `wrangler.toml` 的 `name`，再部署（等于新地址） |
| 看部署历史 | `wrangler pages deployment list --project-name <name>` |
| 回滚旧版本 | Cloudflare 控制台 → Workers & Pages → 项目 → Deployments → 选历史版本 Rollback |

---

## 四、`deploy.ps1` 做了什么

1. 检查 `hugo`、`wrangler` 是否可用，以及 `wrangler whoami` 是否已登录
2. 读取 `wrangler.toml` 的项目名，打印即将发布到的公网地址
3. 删除旧 `public/`，重新执行 `hugo --minify --gc`
4. 基础地址取值顺序：`wrangler.toml` 的 `[vars] PUBLIC_BASE_URL` → 若为空则用 `https://<项目名>.pages.dev/`
5. 执行 `wrangler pages deploy public --project-name <name> --branch main --commit-dirty=true`
   （项目不存在时 Wrangler 会自动创建，无需手工建项目）
6. 打印部署结果与公网地址

退出码：0 = 成功，非 0 = 失败（窗口里会显示错误原文）。

---

## 五、排错

| 现象 | 原因 / 解决 |
| --- | --- |
| 双击 `.ps1` 一闪而过 | 改用 `run-deploy.cmd`（已加 `-ExecutionPolicy Bypass` 并会暂停）；环境初始化入口在上一级安装目录的 `run-bootstrap.cmd` |
| `无法加载文件，因为在此系统上禁止运行脚本` | 同上；或执行 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `wrangler : 无法将"wrangler"项识别为 cmdlet` | 重开 PowerShell 窗口；或 `npm install -g wrangler` |
| `You are not authenticated` | 执行一次 `wrangler login` |
| 部署成功但内容没变 | 忘了重新构建；`deploy.ps1` 已内置构建，确认这一步没报错 |
| 项目名被占用 / `already exists` | 编辑 `wrangler.toml` 换一个 `name` |
| 中文文件名构建后 URL 404 | 给该文章 front matter 加 `url: "/posts/english-name/"` |
| 页面没有样式 | `themes/PaperMod` 是空目录：`git submodule update --init --recursive` |
| `hugo` 报版本相关配置错误 | `hugo version` 确认 ≥ 0.128.0，低了就升级 Hugo |
| 端口 1313 被占用 | `hugo server -D -p 1314` |

---

## 六、把源码备份到 Git（可选，但建议）

初始化时已建好本地 git 仓库。想备份到 GitHub / Gitee：

```powershell
git add .
git commit -m "post: 新文章"
git remote add origin <你的仓库地址>
git push -u origin main
```

注意：这**只是备份源码**，不会触发任何自动部署（本方案不使用 CI）。
发布永远由 `deploy.ps1` 完成。

---

## 七、这份方案为什么这样选

- **Hugo**：单文件二进制，无 Node / Ruby 运行时依赖，构建 1 秒级
- **PaperMod**：一个主题即覆盖「文章 / 目录 / 归档 / 标签 / 站内搜索」，自带中文界面
- **Wrangler CLI 直传**：不依赖 GitHub Actions、不需要网页端绑定仓库，
  本地一条命令即可发布；免费版 Cloudflare Pages 每月 500 次部署额度，个人博客绰绰有余
- **`*.pages.dev`**：Cloudflare 官方域名，自动 HTTPS、全球 Anycast 加速，无需购买域名
