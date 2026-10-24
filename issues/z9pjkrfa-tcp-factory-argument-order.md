---
id: z9pjkrfa
opened: 2026-10-17T23:58:21.000Z
closed: 2026-10-24T18:28:29.000Z
title: create_tcp_server 的参数顺序
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [be513a3]        # commit IDs, backfilled at version commit time
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

问题成立，按解决提案修复：`create_tcp_server(unit_map, { host, port, rtu, unit_ids, handler, name })`，必选的单元表在前，其余都是选项，与 `create_rtu_server` 和 es-modbus 的 `Modbus_Server(handler, options)` 一致。
