---
id: 20b5rp25
opened: 2026-10-17T23:58:29.000Z
closed: 2026-10-23T13:32:37.000Z
title: README 示例不完整
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [e7d125a]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

“Without a description file”示例中 `block` 未定义，也没有演示注册布局与创建 Ldata。

## 解决提案

补全布局注册与 Ldata 创建。示例不传 `logger`：它将被事件取代（issue#mnwdf2fy）。

## 裁定

问题成立，按解决提案修复：示例照抄即可运行。
