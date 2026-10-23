---
id: zfdne38j
opened: 2026-10-17T23:58:15.000Z
closed: 2026-10-23T14:39:05.000Z
title: 未映射地址警告的集合无上限
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：`src/unit_map.js` 的 `reported`。

每个 (类型, 单元, 地址) 记一项。主站扫描整个地址空间时，理论上可达 65536 × 3 × 256 项。

## 解决提案

设上限：已报告的地址最多记 1024 个，满时再报告一次“不再报告”的警告，之后的地址既不报告也不记录。

改为事件方式后（issue#mnwdf2fy），未映射地址由 vector 发出事件，去重仍由本包负责，作用于事件的发出：同一地址只发一次。

放弃的方案：

- 每次访问都发出事件、由订阅方去重：主站轮询时会持续淹没监听器。
- 按区间去重：扫描整个地址空间时区间数仍可能很多，且合并区间的实现复杂，换来的只是警告更紧凑。

## 裁定

问题成立，按解决提案修复：设上限 1024，集合有界，超出时明确告知不再报告。
