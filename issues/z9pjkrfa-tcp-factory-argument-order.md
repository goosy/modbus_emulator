---
id: z9pjkrfa
opened: 2026-10-17T23:58:21.000Z
closed:
title: create_tcp_server 的参数顺序
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

`create_tcp_server(host, port, unit_map, opts)` 把可选参数放在必选参数之前，只用默认值时须写 `create_tcp_server(undefined, undefined, unit_map)`；与 `create_rtu_server(path, unit_map, opts)` 的风格也不一致。

## 解决提案

改为 `create_tcp_server(unit_map, { host, port, rtu, ... })`，与 `create_rtu_server` 风格统一。这是 breaking change。

## 裁定
