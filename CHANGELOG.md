# Changelog

仓库没有 `package.json`，也没有任何版本号标注（脚本各自是独立工具，没有整体发布物），
所以这里不发明版本号：变更按日期记录在 "Unreleased" 段里，直到确实需要对外发布时再打版本。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased] — 2026-10-15

针对一次代码审计（见 `_audit/dsh-toolbox.json`）的修复：3 个 high、10 个 medium，
以及若干确实不当且改动安全的 low。新增零依赖自检 `node tests/run-tests.mjs`。

### Security

- **`publish-to-github.mjs` 不再无视 `.gitignore`**。发布清单改为遵循 git 的忽略规则
  （git 工作树用 `git ls-files -co --exclude-standard`，非工作树则本地解析 `.gitignore`，
  支持 `!` 负向规则、`build/` 目录规则、前导 `/` 锚定、`*` `?` `[]` `**`）。
  此前 `.env`、`*.log` 等被忽略的文件会被当作 blob 推到**公开**仓库；另有独立的凭据文件名兜底检查
  （`.env*`、`*.pem`、`*token*`、`id_rsa`、`.npmrc`、`cookies*` …），命中即拒绝发布（exit 3）。
  新增 `--dry-run` 先打印上传清单与远端差异，`--allow-secrets` 才可显式越过兜底检查。
- 新增仓库根 `.gitignore`。README 第四节一直声称 token 由 `.gitignore` 排除，但仓库里从来没有这个文件。

### Fixed

- **z 系列 4 个脚本只解第一个 zstd 帧**（`zstream` / `zdump` / `ztail` / `zinfo`）。
  `zstdDecompressSync` / `createZstdDecompress` 解完第一帧就停下、既不报错也不提示，
  于是会话正文与尾部被静默截断且退出码为 0。新增共用解码库 `agent-inspectors/zstd-frames.mjs`，
  四个脚本全部改为逐帧解码；末尾仍有字节解不出来时打印剩余偏移并以退出码 1 结束。
- **`zframes.mjs` 不再用魔数猜帧边界**。压缩块内部也会出现 `28 b5 2f fd`，按它推进会提前收尾
  （实测丢掉第二帧且 exit 0）。帧边界改取解码器自己报告的已消费字节数；顺带支持 skippable 帧。
- **`ci-watch-all.js` 不再丢弃第一个仓库参数**。旧代码用 `i !== timeoutIndex + 1` 剔除选项值，
  而 `--timeout-min` 缺省时 `timeoutIndex` 是 -1，于是下标 0 的仓库也被剔掉：只传一个仓库时
  一个请求都不发，却打印 "all repositories green" 并 exit 0。改为显式分离选项与位置参数
  （新增 `github-automation/cli-flags.mjs`），仓库列表为空、`--timeout-min` 缺值或非数字均报用法并 exit 2。
- **`asar.mjs` 处理 `unpacked` / `link` 条目与 40 MB 阈值**。`unpacked` 条目改从
  `app.asar.unpacked/` 读取并标注（此前会拿包里别的文件的内容当成命中），`link` 条目跳过并在结尾
  汇总，越过阈值的文件逐一列出，不再让 "total hits" 看起来像完整结果。
- **`finish-and-verify.js` / `create-repo.js` 不再吞掉 push 失败**。前者无论 push 结果都打印
  "nameplate: pushed"；后者只在错误文案匹配 `rejected|non-fast-forward` 时才失败，鉴权/网络错误
  仍继续 PATCH 远端元数据。现在都按退出码判断，失败即报错并以非 0 结束。
- **`check-repos.mjs` 校验 token 与响应状态**。缺 `GH_TOKEN` 时不再以
  `Cannot read properties of undefined (reading 'filter')` 崩溃，401/404 会打印 HTTP 状态与响应正文。
- **`ci-status.js` 无参数时报用法并 exit 2**（此前无输出、exit 0，看起来像"检查通过"）；
  存在失败 job 或查询失败时以非 0 结束。
- **`gitnet.ps1` / `git-spacehog.ps1` 补上 `http.sslBackend=openssl`**。脚本注释与 README 都说明
  schannel 无法通过该代理完成握手，但 `-c` 列表里一直没有这一项，实际用到的是机器全局配置
  （本机恰好是 schannel）。
- **`gh-device-login.js` / `gh-device-poll.js` / `ci-watch.js` 校验选项缺值**。
  `--max-wait` 无值时 `Number(undefined)` 得到 NaN，deadline 变成 NaN，轮询循环一次都不进，
  只打印 "gave up after NaN minutes"；`--scopes` 无值会把 `scope=undefined` 发给 GitHub。
  数值选项统一走 `Number.isFinite` 校验，缺值即报用法并 exit 2。
- **`ztail.mjs` 校验计数与 mode**。`tail abc` / `tail 0` 曾因 `slice(-NaN)` 退化成"输出全部行"，
  未知 mode 会落到 else 分支输出全部；现在只接受 `tail|head|grep` 与正整数计数。
- **`dl.js` 的 `--asset` 形式校验参数个数**。少给 outFile 时曾一路走到
  `fs.createWriteStream(undefined)` 才崩，错误里看不出是参数少了。
- **z 系列与 `asar.mjs` 补参数校验**。无参、路径不存在、目录当文件时打印一行用法并 exit 2，
  不再抛裸 Node 堆栈。
- **z 系列默认输出改到输入文件同目录**，并支持 `-o/--out`；`zdump.mjs` 的 `ZOUT` 不再需要
  额外传一个关键词才生效（此前不带关键词时被静默忽略）。默认写死在 CWD 会把输出丢进仓库目录。
- **`set-repo-meta.js` 的临时 JSON 改写到 `%TEMP%`**（与 `set-qwq-meta.js`、`create-repo.js` 一致）。
  此前写在脚本目录（仓库内），进程被强杀就会留下未跟踪的 `.repo-*.json`。
- **`blog-template/run-bootstrap.cmd` 从模板中移除**。模板里没有 `bootstrap.ps1`，这个入口会被
  原样复制进生成的 `blog\` 并必然报"找不到脚本"；`README.md.tpl` 的目录结构与排错表同步更正。
- **`deploy.ps1` 部署后清理 `%TEMP%` 里的 `wrangler-deploy-*.txt`**，成功与失败两条出口都会删。
- **token 环境变量名统一**：隧道系列与 `publish-to-github.mjs` 现在都同时接受
  `GITHUB_TOKEN` 与 `GH_TOKEN`（另有 `--token` 与 `gh auth token` 兜底），README 已写明。

### Docs

- README 更正 `dl.js` 的描述（走本地代理 CONNECT 隧道 + 手工跟随 302，不是 `gh-proxy.com` 反代前缀）。
- README 更正 z 系列解码能力的描述：强调**逐帧解码**、帧边界**不能扫魔数**、截断时退出码非 0。
- README 新增"自检"一节，说明 `node tests/run-tests.mjs` 的跑法与覆盖范围。

### Added

- `tests/`：零依赖自检（纯 `node`、`node:assert`，不引入任何第三方包，不打真实网络）。
  `tests/run-tests.mjs` 汇总运行，`tests/harness.mjs` 是极简测试骨架，
  `tests/mock-github-api.mjs` 是本地 GitHub API 桩（记录全部请求体供断言）。
- `CHANGELOG.md`（本文件）。
