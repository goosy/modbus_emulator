---
id: 6w441q89
opened: 2026-10-17T23:58:04.000Z
closed:
title: 多寄存器写入出现中间值（撕裂）
status: accepted        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：`src/unit_map.js` 的 `set_register`。

es-modbus 对 FC16 的每个寄存器单独调用一次 vector，本包每次调用一次 `write_bytes`，每次都会检测变化并发出事件。一个跨两个寄存器的 tag（如 Real）因此会收到一次中间值的 `change`。design 中“调用方用 `setImmediate` 合并通知”的说法只能合并事件，消除不了中间值。

## 解决提案

在请求层用 transaction 解决，不依赖 es-modbus 增加批量能力。

- es-modbus 中 `serve(request)` → `this.dispatch(request)` → 逐个调用 vector，全程同步；`dispatch` 是 JSDoc 中公开的方法，不是 `#` 私有成员。本包继承 `Modbus_Server` 并覆盖 `dispatch`：对 FC15 / FC16，按 `unit_id`、起始地址和数量算出请求写到的块，把这些块的 `transaction` 逐层嵌套，在最内层调用 `super.dispatch(request)`。读请求和 FC5 / FC6 直接交给 `super.dispatch`。
- 原型已验证：一次 FC16 写 8 个寄存器、跨两个块，每个 tag 只有一次 `change`，值为最终值（`1.5→1234.5`）；每个块只有一次 `write`；一个块的监听器抛出异常，不影响另一个块提交。

随之确定的语义（先写入 spec / design，含中文版）：

- 一次请求，对写到的每个块各发出一次 `write`（现为每个寄存器一次）；FC5 / FC6 的表现不变。
- 请求是原子的：vector 在请求中途抛出异常时，涉及的块全部回滚，主站收到 0x04（现为前半部分已写入）。
- 提交阶段监听器抛出的异常：数据已写入，不回滚，也不影响其他块；在覆盖的 `dispatch` 中捕获后，由 server 自己发出 `vector_error` 事件报告（模拟器照常转发，见 issue#mnwdf2fy），主站照常收到正常应答。若不捕获，它不是 `Vector_Error`，`serve` 会重新抛出，可能在 socket 的 data 回调中成为未捕获异常，导致进程崩溃。
- 嵌套时内层先提交。把块按地址倒序嵌套，使事件按地址顺序发出。
- 只有 `create_tcp_server` / `create_rtu_server` 创建的服务具有此行为。调用方用 `create_vector` 自行构造 `Modbus_Server` 时没有此保护，需在 spec 中写明。
- 删去 design 中 `setImmediate` 合并的说法。

测试：跨块 FC16、Real 无中间值、中途异常回滚、监听器异常。

放弃的方案：在 vector 层做不到，`Ldata.transaction(fn)` 要求在回调内同步完成全部写入，而 vector 每次只收到一个寄存器，不知道请求的边界。

遗留：覆盖 `dispatch` 依赖 es-modbus 当前的调用结构，宜在 es-modbus 中把 `dispatch` 明确为可覆盖的扩展点。性能问题另见 issue#0t1q0fs7。

## 裁定

问题成立，需修复：主站一次写入多寄存器的值时，tag 会收到错误的中间值。采用解决提案的方案，在请求层覆盖 `dispatch`，用 `transaction` 使一次请求对每个块原子写入。
