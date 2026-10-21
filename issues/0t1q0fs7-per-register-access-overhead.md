---
id: 0t1q0fs7
opened: 2026-10-17T23:58:14.000Z
closed:
title: 逐寄存器访问的开销
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

es-modbus 每个寄存器调用一次 vector。每次调用：

- 线性扫描该单元的所有段；
- 分配一个 `{ block, offset }` 结果对象；
- `read_bytes` 分配一个 Buffer 副本；
- 有 `access` 监听器时发出一次 `access` 事件。

一个 125 个寄存器的请求即重复 125 次。规模小时影响不大。

## 解决提案

根本原因是缺少按请求批量访问的路径。需要 es-modbus 的 vector 增加可选的批量方法（如 `get_registers` / `set_registers` 及位的对应方法），之后本包按块切分请求，每块只调用一次 `read_bytes` / `write_bytes`，消除逐寄存器的线性扫描、对象与 Buffer 分配和 `access` 事件；段数组构建后按 `start` 排序并冻结。

issue#6w441q89 已在请求层用 transaction 解决了中间状态问题，但与此 issue 无关，这里只是性能优化。

## 裁定
