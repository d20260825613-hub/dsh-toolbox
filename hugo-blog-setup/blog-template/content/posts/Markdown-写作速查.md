---
title: "Markdown 写作速查"
date: 2026-01-08T09:30:00+08:00
lastmod: 2026-01-08T09:30:00+08:00
draft: false
summary: "在这个博客里写文章会用到的 Markdown 语法与 front matter 字段速查。"
tags: ["Markdown", "写作"]
categories: ["指南"]
ShowToc: true
TocOpen: false
---

## front matter 字段说明

每篇文章开头 `---` 之间的部分是元信息：

```yaml
---
title: "文章标题"                  # 必填，显示在列表和页面大标题
date: 2026-01-08T09:30:00+08:00    # 必填，决定归档与排序
lastmod: 2026-01-08T09:30:00+08:00 # 选填，显示“最后更新”
draft: false                       # true = 草稿，不会上线
summary: "列表页显示的摘要"         # 选填，留空由正文自动截取
tags: ["Markdown", "写作"]          # 选填，生成 /tags/xxx/ 页面
categories: ["指南"]               # 选填
ShowToc: true                      # 是否显示右侧目录
TocOpen: false                     # 目录是否默认展开
---
```

## 常用语法

### 标题与目录

`##` 二级标题会自动进入右侧目录（本站配置为 h2 ~ h4）。

### 强调、链接与行内代码

`**加粗**` 变成 **加粗**，`*斜体*` 变成 *斜体*，
行内代码写作 `` `hugo server` ``，链接写作 `[文字](https://example.com)`。

### 列表

无序列表用 `-`，有序列表用 `1.`，都支持嵌套缩进两格。

### 引用

> 这是一段引用文字，用 `>` 开头。

### 代码块

三个反引号加语言名即可高亮：

```js
export function hello(name) {
  return `你好，${name}`;
}
```

### 表格

管道符分隔，第二行决定对齐：

| 列 A | 列 B | 列 C |
| :--- | :---: | ---: |
| 左对齐 | 居中 | 右对齐 |

### 图片

把图片放到 `static/images/` 下，然后这样引用：

```markdown
![图片说明](/images/示例.png)
```

## 一个容易踩的坑

中文标题会**直接作为网址路径**（例如本页是 `/posts/markdown-写作速查/`）。
所以标题尽量简短、稳定；发布之后改标题等于改网址，旧链接会失效。
