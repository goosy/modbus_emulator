---
id: wxw1tbmx
opened: 2026-10-17T23:58:16.000Z
closed: 2026-10-24T01:40:33.000Z
title: 模块级共享缓冲区
status: rejected    # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：`src/unit_map.js` 的 `REGISTER_BYTES`。

`set_holding_register` 把寄存器值写入一个模块级共享的两字节数组，再交给 `write_bytes`。评估时认为这依赖“调用是同步的，且 `write_bytes` 立即复制”这一隐含前提。

## 解决提案

这个前提并非隐含，而是有依据的。

- `write_bytes` 先把源字节复制进块的缓冲区，再检测变化、发出事件；即使 `change` / `write` 监听器同步地再次调用 handler，此时共享数组也已复制完毕。
- design 和代码注释都已写明“`write_bytes` 立即复制”。

改用批量写（issue#6w441q89）后，FC6 仍调用 `set_holding_register`，这个数组照旧使用，不会去掉。

## 裁定

问题不成立（rejected）：`write_bytes` 在检测变化和发出事件之前就已复制源字节，共享数组的使用是安全的，且这一前提已写在 design 和代码注释中。
