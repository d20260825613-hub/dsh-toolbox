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
| `dl.js` | 走本地代理 CONNECT 隧道下载 GitHub 文件并手工跟随 302 重定向（每个新主机各自开隧道，共 8 次重试） |
| `probe-*.js` / `dump-device-form.js` / `find-delete-form.js` / `fill-token-form.js` / `click-token-delete.js` | 用无头 Edge 排查 GitHub 页面表单（设备码、token 删除流程）的探针 |
| `check-epipe.js` / `probe-req-close.js` | 排查 Node 子进程管道 EPIPE、请求提前关闭这类环境噪声 |
| `publish-to-github.mjs` | **在不支持 `git push` 的机器上发布仓库**：api.github.com 可达而 github.com 被墙时，用 Git Data API（blobs → tree → commit → ref）一次提交推上完整目录，并自动建仓库、写描述与 topics。新仓库要先 bootstrap 一次提交，否则 GitHub 会对建 blob 返回 409 "Git Repository is empty"。发布清单**遵循 `.gitignore`**（有 git 仓库时用 `git ls-files -co --exclude-standard`，否则本地解析 `.gitignore`），任何像凭据的路径都会拒绝上传；`--dry-run` 先打印将要上传的清单与将要保留/删除的远端文件，tree 默认带 `base_tree` 合并到分支（远端独有文件不会被删，除非显式 `--delete-remote`） |
| `check-repos.mjs` | 发布后审计：列出仓库里可疑的二进制/垃圾文件（.exe/.zip/.log/日志目录等） |

> **一个实测结论**：这台机器上 `github.com:443` 被重置，但 `api.github.com`、`raw.githubusercontent.com`、
> `codeload.github.com`、`objects.githubusercontent.com` **都能直连**，而且直连时 Authorization 是被真正校验的
> （拿无效 token 请求 `/user` 返回 401）。所以"GitHub 完全不可用"是错的——**不能用的是网页与 git 协议，能用的是 API**。
> 相比之下，第三方反代 `gh-proxy.com` 的 API 通道会**用反代自己的账号**发请求（拿无效 token 请求 `/user` 竟然返回
> 另一个用户 `aeroheaven1` 的资料），因此**绝不能用它提交代码或传 token**。

**用法要点**：这些脚本需要你自己提供 token（设备码登录或已有的 PAT），
环境变量同时接受 `GITHUB_TOKEN` 和 `GH_TOKEN`（隧道系列与 `publish-to-github.mjs` 都认这两个名字，
另外都支持 `--token` 与 `gh auth token` 兜底），
仓库里只有"怎么拿到、怎么用、怎么吊销"的代码，没有任何凭据。

---

## 二、agent-inspectors/ —— 看清 DSH 会话与 Electron 客户端的内部

| 脚本 | 作用 |
|---|---|
| `zstd-frames.mjs` | **共用解码库**（不是命令行工具）：把多帧 zstd 文件逐帧解开。帧边界取自解码器自己报告的已消费字节数；末尾有无法解码的字节时抛错，而不是静默返回半截内容 |
| `zframes.mjs` | **DSH 会话文件解码器（帧级诊断）**。`session.v4.jsonl.zstd` 是**多个 zstd 帧拼接**的，`zstdDecompressSync` 只解第一帧（会得到 200 字节的元数据）——帧边界必须用解码器自己报告的已消费字节数，**不能扫魔数**：压缩块内部也会出现 `28 b5 2f fd`，按它切会提前截断。这个坑花了不少时间才定位 |
| `zstream.mjs` / `zdump.mjs` / `ztail.mjs` / `zinfo.mjs` | 同一套逐帧解码（共用 `zstd-frames.mjs`）的几种用法：全解写文件、按关键词过滤、看尾部/头部 N 条、只看结构概要。四者都解**全部帧**；若末尾还有字节解不出来，会打印剩余偏移并**以退出码 1 结束**，不再把「部分成功」当成功 |
| `asar.mjs` | **Electron `app.asar` 读取/检索器**。自己解析 asar 的 pickle 头（注意：长度字段在偏移 4，字符串从偏移 8 开始），在 163 MB 的包里按关键词定位代码片段——用来搞清 Chatbox 的联网搜索与自定义提供方格式。`unpacked` 条目改从 `app.asar.unpacked/` 读，`link` 条目跳过，被 40 MB 阈值跳过的文件会在结尾列出来 |
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

- **任何 token / 密钥**：`gh-token.txt`、`.env`、`*.token`、`cookies*.txt`、`*-challenge.txt` 一律排除
  （本仓库根目录的 `.gitignore` 里确实写了这些规则；`publish-to-github.mjs` 另有独立的凭据文件名兜底检查，
  即使某个目录没有 `.gitignore` 也不会把凭据推上去）
- **浏览器配置目录**：`edge-direct/`、`edge-profile/` 里是完整 Edge 配置（含 Cookie、Trust Tokens）
- **会话转储**：DSH 的原始 `*.jsonl`（几 MB 的私人对话记录）
- **二进制**：PortableGit、Hugo、PaperMod、npm 缓存等（几百 MB，且能重新下载）

## 五、运行环境

Windows 10/11 + Node.js（脚本用 `node`，无第三方依赖，除 Edge 探针需要本机 Edge）。
GitHub 相关脚本需要本机有可用的出网方式：本地 HTTP 代理（`http.proxy`）或第三方反代。

## 六、自检

仓库没有 `package.json`，自检也是零依赖的纯 node：

```
node tests/run-tests.mjs          # 全部
node tests/run-tests.mjs zstd     # 只跑文件名含 zstd 的用例
```

覆盖三件最容易再犯的事：

- **zstd 多帧解码**：`agent-inspectors/*` 必须拿到全部帧的正文（含只出现在第 2、3 帧里的内容），
  截断文件必须以非 0 退出；
- **publish-to-github 的发布清单**：`.env`、`secret.txt`、`*.log`、`node_modules/`、`dist/` 必须被忽略，
  `!keep.tmp` 这类负向规则必须生效，没有 `.gitignore` 时凭据文件名也必须被拦下；
- **ci-watch-all 的参数解析**：带不带 `--timeout-min` 都要收集到全部仓库名，只给一个仓库时不得报
  「all repositories green」。

测试**不打真实网络**：`publish-to-github.mjs` 由一个本地 mock API（`tests/mock-github-api.mjs`）
接住请求并记录全部请求体，GitHub 客户端逻辑也可以直接对纯函数（`listPublishFiles` 等）单测。

