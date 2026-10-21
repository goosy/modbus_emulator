---
id: zfdne38j
opened: 2026-10-17T23:58:15.000Z
closed:
title: 未映射地址警告的集合无上限
status: open        # open | accepted | fixed | rejected | wontfix
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

设上限，或按区间去重。

改为事件方式后（issue#mnwdf2fy），未映射地址由 vector 发出事件，去重仍由本包负责，作用于事件的发出：同一地址只发一次。

放弃的方案：每次访问都发出事件、由订阅方去重。主站轮询时会持续淹没监听器。

## 裁定
