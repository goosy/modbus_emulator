---
id: 2jdmx0kw
opened: 2026-10-17T23:58:11.000Z
closed: 2026-10-23T14:07:46.000Z
title: 端口校验不完整
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [a14a08c]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：`src/emulator.js` 的 `#read_servers`。

TCP 端口只检查是否为整数，没有检查 0..65535 的范围（issue#4rk8vyme 复现中的 99999 即由此通过校验）；多个服务使用同一端口也没有检查。

## 解决提案

TCP 端口校验范围 0..65535；多个服务使用同一端口时报错：

- `tcp` 与 `rtu_over_tcp` 按 `host` 与 `port` 比较（缺省值参与比较），不同 `host` 使用同一端口不算冲突；
- 端口 0 由系统分配，每次不同，不参与重复检查；
- 两个 `rtu` 服务不得使用同一串口路径。

## 裁定

问题成立，按解决提案修复：TCP 端口须为 0..65535；同一 `host` 与 `port` 不得重复（端口 0 除外，不同 `host` 可用同一端口），串口路径不得重复。
