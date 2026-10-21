---
id: a9rjgz00
opened: 2026-10-17T23:58:06.000Z
closed:
title: 校验失败会用掉“每进程只能注册一次”的机会
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：`src/emulator.js` 中 `register_layout(layout_sources)` 的调用。

布局在 blocks 和 servers 校验之前就注册到 layout-data 的全局表中。之后的校验一旦失败，构造失败，但注册已经发生。

复现：描述因 `unit_id: 300` 失败；修正后在同一进程再次构造，报 `register_layout can be called only once`。热重载、GUI 等场景下无法重试。

## 解决提案

所有校验完成之后再调用 `register_layout`。随 issue#7w2awj10 的构造函数拆分一并解决。

## 裁定
