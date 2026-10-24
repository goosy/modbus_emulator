---
id: t15w08bd
opened: 2026-10-17T23:58:27.000Z
closed: 2026-10-24T07:17:14.000Z
title: 依赖版本策略不一致
status: fixed       # open | accepted | fixed | rejected | wontfix
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

`package.json` 中把 `es-modbus` 锁定为精确版本。随 issue#61qwgnt5 升级 es-modbus 时一并处理，不再等到版本提交。

## 裁定

问题成立，已修复：随 issue#61qwgnt5 把 `es-modbus` 锁定为精确版本 `0.3.0-beta.4`，与其他依赖的版本策略一致。
