---
id: vidiwxw3
opened: 2026-10-28T17:28:21.928Z
closed: 2026-10-29T04:58:18.000Z
title: get_coil 用 read_bytes 读位，access 报出整个字节的 Bool
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

handler 的批量方法 `get_coils` 用 `block.read_bit(offset, bit_mask)` 读线圈，单个的 `get_coil` 却用 `(block.read_bytes(offset, 1)[0] & bit_mask) > 0`。两者的 `access` 事件不同：读同一个线圈，`read_bytes` 报出该字节中所有的 Bool（如 `c0,c1`），`read_bit` 只报出被读的那一个（`c0`），已用脚本验证。

es-modbus 在 handler 有 `get_coils` 时不调用 `get_coil`，所以 FC 1 / FC 2 请求不受影响；但 `get_coil` 是公开的 handler 方法，直接调用它的使用方看到的 `access` 与批量读不一致。

## 解决提案

`get_coil` 改为 `return block.read_bit(offset, bit_mask);`。`read_bit` 正是 layout-data 为此提供的（layout-data issue#dy6d5xgj：只报出被读位的 Bool），改后单读与批读的 `access` 一致，代码也少一个表达式。

## 裁定

修复。`get_coil` 改用 `read_bit`，单读与批读的 `access` 一致，都只报出被读位的 Bool。
