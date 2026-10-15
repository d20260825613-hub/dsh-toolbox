# =====================================================================
#  Hugo 站点主配置（PaperMod 主题 · 中文界面）
#  部署方式：Wrangler CLI 直接上传 public/ 到 Cloudflare Pages
#  公网地址：https://__PROJECT__.pages.dev  （前缀 = Pages 项目名 = wrangler.toml 的 name）
# =====================================================================

# ---------------------------------------------------------------------
# 1. 站点基本配置
# ---------------------------------------------------------------------
baseURL = "https://__PROJECT__.pages.dev/"   # 结尾必须有斜杠
languageCode = "zh-cn"
defaultContentLanguage = "zh"
title = "我的个人博客"
theme = "PaperMod"

enableRobotsTXT = true
enableEmoji = true
hasCJKLanguage = true          # 中文按“字”统计字数 / 计算阅读时长
summaryLength = 80

# 文章永久链接：中文标题直接作为路径（/posts/我的第一篇文章/）
[permalinks]
  posts = "/posts/:contentbasename/"

# 分页
paginate = 10
paginatePath = "page"

# ---------------------------------------------------------------------
# 2. 输出格式：站点地图 + RSS（JSON 供站内搜索用）
# ---------------------------------------------------------------------
[sitemap]
  changefreq = "weekly"
  priority = 0.5
  filename = "sitemap.xml"

[outputs]
  home = ["HTML", "RSS", "JSON"]
  # section / term 的 RSS 是 Hugo 默认行为，无需声明

# ---------------------------------------------------------------------
# 3. 正文渲染：目录（TOC）+ 代码高亮
# ---------------------------------------------------------------------
[markup]
  [markup.goldmark]
    [markup.goldmark.renderer]
      unsafe = true
  [markup.highlight]
    noClasses = false
    codeFences = true
    guessSyntax = true
    lineNos = false
  [markup.tableOfContents]
    startLevel = 2
    endLevel = 4
    ordered = false

# ---------------------------------------------------------------------
# 4. 主题外观 / 功能参数（PaperMod）
# ---------------------------------------------------------------------
[params]
  description = "记录技术、生活与读书的个人空间"

  defaultTheme = "auto"            # auto / light / dark
  ShowReadingTime = true
  ShowShareButtons = false
  ShowPostNavLinks = true
  ShowBreadCrumbs = true
  ShowCodeCopyButtons = true
  ShowWordCount = true
  ShowRssButtonInSectionTermList = true
  ShowFullTextinRSS = false
  ShowToc = true                   # 文章页默认显示目录
  TocOpen = false                  # 目录默认折叠
  comments = false

  DateFormat = "2006-01-02"
  hideFooter = false

  # -------- 首页简介 --------
  [params.homeInfoParams]
    Title = "你好，欢迎来到我的博客 👋"
    Content = """
这里是我的个人空间，用来记录技术笔记、生活片段和读书心得。

- 想看全部文章 → 顶部导航「文章」
- 按时间浏览 → 顶部导航「归档」
- 按主题筛选 → 顶部导航「标签」
- 站内搜索 → 顶部导航「搜索」或按 <kbd>/</kbd>
"""

  # -------- 静态资源：使用 Hugo 自带高亮，不加载 highlight.js --------
  [params.assets]
    disableHLJS = true
    favicon = ""

[params.footer]
  text = '© 2026 我的个人博客 · Hugo + PaperMod + Cloudflare Pages'

# ---------------------------------------------------------------------
# 5. 顶部导航菜单（中文）
# ---------------------------------------------------------------------
[[menu.main]]
  name = "文章"
  url = "/posts/"
  weight = 10

[[menu.main]]
  name = "归档"
  url = "/archives/"
  weight = 20

[[menu.main]]
  name = "标签"
  url = "/tags/"
  weight = 30

[[menu.main]]
  name = "搜索"
  url = "/search/"
  weight = 40
