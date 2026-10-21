---
id: wxw1tbmx
opened: 2026-10-17T23:58:16.000Z
closed:
title: 模块级共享缓冲区
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：`src/unit_map.js` 的 `REGISTER_BYTES`。

依赖调用是同步的，且 `write_bytes` 立即复制，目前是安全的；属于隐含前提。

## 解决提案

改为批量写入（issue#0t1q0fs7）后去掉。

## 裁定
