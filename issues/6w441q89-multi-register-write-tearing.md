---
id: 6w441q89
opened: 2026-10-17T23:58:04.000Z
closed: 2026-10-24T09:55:55.000Z
title: 多寄存器写入出现中间值（撕裂）
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [f465cb4, d6dd46d]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：`src/unit_map.js` 的 `set_holding_register` / `set_coil`。

es-modbus 对 FC16 的每个寄存器、FC15 的每个线圈单独调用一次 handler，本包每次调用一次 `write_bytes` / `write_bit`，每次都会检测变化并发出事件。

- 一致性：一个跨两个寄存器的 tag（如 Real）会收到一次中间值的 `change`。design 中“调用方用 `setImmediate` 合并通知”的说法只能合并事件，消除不了中间值。
- 开销：一次请求写 n 个点，就做 n 次变化检测、发出 n 次块的 `write`；`write` 监听器的总开销随之放大 n 倍。实测 FC16 写 125 个寄存器、每次值都不同：逐点 13.5 µs，一次 `write_bytes` 7.7 µs；每个 tag 都有 `change` 监听器时为 18.9 µs 与 10.0 µs；逐点方式每次请求发出 125 次 `write`，批量方式 1 次。
- 诊断：每次 `write_bytes` / `write_bit` 都发出一次 `access("write", tags)`，一次请求写 n 个点就发出 n 次。

## 解决提案

实现 es-modbus 的可选批量方法 `set_holding_registers(addr, values, unit_id)` / `set_coils(addr, values, unit_id)`：es-modbus 对一次 FC16 / FC15 请求只调用一次，传入该请求的全部值。FC6 / FC5 仍调用 `set_holding_register` / `set_coil`，不变。

- handler 按块切分请求范围。每个块的部分在该块的 `transaction` 中写入：寄存器拼成字节后调用一次 `write_bytes`，线圈按字节调用 `write_bit`（保留按位的写入范围，`access` 只报告被写的 Bool）。一次请求跨几个块，就把这几个块的 `transaction` 逐层嵌套，在一次同步调用中完成。块之间的空隙照旧忽略并报告未映射地址。
- 原型已验证（以覆盖 `dispatch` 的形式，嵌套方式相同）：一次 FC16 写 8 个寄存器、跨两个块，每个 tag 只有一次 `change`，值为最终值（`1.5→1234.5`）；每个块只有一次 `write`；一个块的监听器抛出异常，不影响另一个块提交。
- `access`：layout-data 0.3.0 把 `access` 纳入 `transaction`（layout-data#jt0zxgth）：事务内的 `access` 在结束时按 `read` / `write` 各发出一次，回滚时不发出 `access write`。所以寄存器（每块一次 `write_bytes`）和线圈（每个字节一次 `write_bit`）都是一个块一次 `access`。
- 外部依赖都已发布：es-modbus 的批量方法在 0.3.0-beta.4 中（issue#61qwgnt5），layout-data 的 `access` 纳入 `transaction` 在 0.3.0 中。

随之确定的语义（先写入 spec / design，含中文版）：

- 一次 FC16 / FC15 请求，对写到的每个块各发出一次 `write`（现为每个点一次）；FC6 / FC5 不变。
- 请求是原子的：写入中途抛出异常时，涉及的块全部回滚，主站收到 0x04（现为前半部分已写入）。
- 提交阶段监听器抛出的异常：数据已写入，不回滚，也不影响其他块。handler 捕获后自行报告（报告方式随 issue#mnwdf2fy 确定），不抛给 es-modbus，主站照常收到正常应答；若抛出，es-modbus 会把已写入的请求答为 0x04，并发出 `handler_error`。
- 嵌套时内层先提交。把块按地址倒序嵌套，使事件按地址顺序发出。
- 由 handler 实现，所以调用方用 `create_handler` 自行构造的 `Modbus_Server` 同样具有此行为。
- `access`：一次 FC16 / FC15 请求，对写到的每个块各发出一次 `access write`。
- 删去 design 中 `setImmediate` 合并的说法。

测试：跨块 FC16 与 FC15、Real 无中间值、每块一次 `write`、寄存器与线圈写每块一次 `access`、中途异常回滚、监听器异常不影响应答。

放弃的方案：

- 逐点调用中使用 `transaction`：做不到，`Ldata.transaction(fn)` 要求在回调内同步完成全部写入，而逐点调用不知道请求的边界。
- 继承 `Modbus_Server` 并覆盖 `dispatch`，在请求层嵌套 `transaction`：可行，但依赖 es-modbus 的内部调用结构，且只保护本包工厂创建的服务；批量方法是 es-modbus 提供的正式扩展点。

读方向的 `access` 问题见 issue#0t1q0fs7。

## 裁定

问题成立，需修复：主站一次写入多寄存器的值时，tag 会收到错误的中间值，且每个点都触发一次变化检测和 `write`。采用解决提案的方案，实现 es-modbus 的批量写方法 `set_holding_registers` / `set_coils`，用 `transaction` 使一次请求对每个块原子写入。
