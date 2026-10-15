---
title: "{{ replace .File.ContentBaseName "-" " " | title }}"
date: {{ .Date }}
lastmod: {{ .Date }}
draft: true
summary: ""
tags: []
categories: []
ShowToc: true
TocOpen: false
---

在这里写正文。二级标题（`##`）会自动进入右侧目录。

## 小标题示例

正文段落。

```bash
# 代码块示例
hugo server -D
```
