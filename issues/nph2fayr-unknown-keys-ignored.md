---
id: nph2fayr
opened: 2026-10-17T23:58:09.000Z
closed:
title: 描述文件中的未知键被静默忽略
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

描述文件中拼错的键（如把 `start` 写成 `sart`、`unit_id` 写成 `unitid`）不报错，块按默认值挂载（例如挂在偏移 0）。

## 解决提案

未知键作为错误收入 `errors`。

## 裁定
