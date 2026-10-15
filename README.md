# dsh-toolbox

一个编码智能体（DeepSeek Harness）在**受限网络**的 Windows 机器上干活时写的小工具集合。
三块内容：**让 GitHub 变得可用**、**看清 DSH 与 Electron 客户端的内部**、**一键搭 Hugo 博客**。

> 所有脚本都是"被真实问题逼出来的"，注释里写了每一步为什么必须存在。
> Token、密钥、浏览器配置、会话转储一律不进仓库（见文末"没有进仓库的东西"）。

---

## 一、github-automation/ —— 在没有直连的机器上操作 GitHub

这台机器上 `github.com` 直连被重置、`registry.npmjs.org` 超时、hosts 里也没有可用的兜底条目，
能出去的只有本地代理（曾经的 Clash `127.0.0.1:7897`）或第三方反代。这套脚本解决的是：

| 脚本 | 解决什么 |
|---|---|
| `gh-device-login.js` / `gh-device-code.js` / `gh-device-poll.js` / `submit-device-code.js` | **无浏览器完成 GitHub 设备码登录**：申请设备码 → 提示用户去 github.com/login/device 输入 → 轮询拿 token |
| `gh-tunnel.js` | **通过本地代理的 CONNECT 隧道调 GitHub API**。Node 的 https 不读 WinINET 代理设置、又会走 hosts，所以必须先隧道再手工套 TLS（含正确的 SNI） |
| `gitnet.ps1` | **给任意仓库跑的 git 包装器**：`http.proxy` + `sslBackend=openssl`（schannel 过代理握手失败）+ `HTTP/1.1`（约一半隧道 TLS 会被重置，必须重试）+ 文件型凭据助手（避免已失效的 gh keyring token 被优先使用） |
| `git-token-helper.js` | git 的 credential helper：从本地文件读 token，兼容 `get`/`store`/`erase` |
| `create-repo.js` / `set-repo-meta.js` / `set-qwq-meta.js` | 建仓库、写描述与 topics、批量改元数据 |
| `release-and-verify.js` / `finish-and-verify.js` / `verify-three.js` | 打 release、上传产物、回读校验 |
| `ci-watch.js` / `ci-watch-all.js` / `ci-status.js` / `joblog.js` | 盯 GitHub Actions 的运行状态与日志 |
| `token-audit.js` / `narrow-scopes.js` / `revoke-token.js` / `delete-token-step1.js` / `confirm-delete-token.js` | 审计 token 权限、收敛 scope、吊销与删除 |
| `dl.js` | 走反代下载 GitHub 文件（`gh-proxy.com` 前缀拼装 + 重试） |
| `probe-*.js` / `dump-device-form.js` / `find-delete-form.js` / `fill-token-form.js` / `click-token-delete.js` | 用无头 Edge 排查 GitHub 页面表单（设备码、token 删除流程）的探针 |
| `check-epipe.js` / `probe-req-close.js` | 排查 Node 子进程管道 EPIPE、请求提前关闭这类环境噪声 |

**用法要点**：这些脚本需要你自己提供 token（设备码登录或已有的 PAT），
仓库里只有"怎么拿到、怎么用、怎么吊销"的代码，没有任何凭据。

---

## 二、agent-inspectors/ —— 看清 DSH 会话与 Electron 客户端的内部

| 脚本 | 作用 |
|---|---|
| `zframes.mjs` | **DSH 会话文件解码器**。`session.v4.jsonl.zstd` 是**多个 zstd 帧拼接**的，`zstdDecompressSync` 只解第一帧（会得到 200 字节的元数据），必须扫魔数逐帧解压——这个坑花了不少时间才定位 |
| `zstream.mjs` / `zdump.mjs` / `ztail.mjs` / `zinfo.mjs` | 同一套解码的几种用法：流式全解、按关键词过滤、看尾部 N 条、只看结构概要 |
| `asar.mjs` | **Electron `app.asar` 读取/检索器**。自己解析 asar 的 pickle 头（注意：长度字段在偏移 4，字符串从偏移 8 开始），在 163 MB 的包里按关键词定位代码片段——用来搞清 Chatbox 的联网搜索与自定义提供方格式 |
| `bingtest.mjs` | 用 Chatbox 完全相同的请求头与选择器验证 **Bing SERP 抓取链路**（`#b_results > li.b_algo`），确认"自带联网搜索"可用 |

这些工具的效果：把一个打包好的 Electron 客户端的"联网搜索走哪个网、要什么 key、配置怎么写"全部问清楚，
并且确认了 `webSecurity: false` 让渲染层可以跨域抓 SERP。

---

## 三、hugo-blog-setup/ —— 一键 Hugo 博客脚手架

`bootstrap.ps1`（20 KB）+ `blog-template/`：从一个模板目录生成可部署的 Hugo 站点，
包含 PaperMod 主题配置、`config.toml`、部署脚本 `deploy.ps1`、Cloudflare Pages 的 `wrangler.toml`、
以及中文写作模板（Markdown 速查、部署笔记）。`run-bootstrap.cmd` 双击即用。

---

## 四、没有进仓库的东西（重要）

- **任何 token / 密钥**：`gh-token.txt` 之类一律排除（`.gitignore` 里也写了）
- **浏览器配置目录**：`edge-direct/`、`edge-profile/` 里是完整 Edge 配置（含 Cookie、Trust Tokens）
- **会话转储**：DSH 的原始 `*.jsonl`（几 MB 的私人对话记录）
- **二进制**：PortableGit、Hugo、PaperMod、npm 缓存等（几百 MB，且能重新下载）

## 五、运行环境

Windows 10/11 + Node.js（脚本用 `node`，无第三方依赖，除 Edge 探针需要本机 Edge）。
GitHub 相关脚本需要本机有可用的出网方式：本地 HTTP 代理（`http.proxy`）或第三方反代。
