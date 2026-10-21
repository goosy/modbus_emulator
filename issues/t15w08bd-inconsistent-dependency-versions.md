---
id: t15w08bd
opened: 2026-10-17T23:58:27.000Z
closed:
title: 依赖版本策略不一致
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

`es-modbus` 为 `^0.3.0-beta.2`（带插入号的 beta），`layout-data` 为精确版本。

## 解决提案

`package.json` 中把 `es-modbus` 锁定为精确版本。在版本提交时处理。

## 裁定
