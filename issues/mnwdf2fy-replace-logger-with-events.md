---
id: mnwdf2fy
opened: 2026-10-23T13:15:47.067Z
closed:
title: 诊断信息通过注入的 logger 输出，调用方无法以事件方式处理
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：`src/server.js` 的 `normalize_logger`、`log_events`，`src/unit_map.js` 的 `create_handler`，`src/emulator.js` 的构造函数。

本包把诊断信息格式化成文本，交给调用方注入的 `logger`（`info` / `warn` / `error`）：

- server 的 `start`、`stop`、`socket_*`、`error`、`handler_error` 事件被 `log_events` 转成日志文本；
- handler 发现的未映射地址通过 `logger.warn` 报告。

调用方因此只能拿到文本，无法按类型处理（例如统计未映射地址、对某个服务的错误作出反应），也无法得知事件来自哪个服务。logger 还要层层传递（模拟器 → 工厂 → handler），并被包装两次：`Modbus_Emulator` 已调用 `normalize_logger`，传给 server 工厂后又包装一次。

## 解决提案

去掉 `logger` 选项与 `normalize_logger`、`log_events`，改用事件。事件由来源发出，`Modbus_Emulator` 汇总：

- server 级：es-modbus 的 `Modbus_Server` 本身是 `EventEmitter`，已有上述事件。工厂不再包装，手工装配的调用方直接在 server 上订阅。
- handler 级：`create_handler` 返回的 handler 本身是 `EventEmitter`，发出未映射地址事件。handler 被多个 server 共享，调用时只有 `addr` 和 `unit_id`，无法归到某个 server，所以只能由 handler 发出。去重沿用现状，作用于事件的发出：同一地址只发一次，已发出的地址最多记 1024 个，满时发出一次“不再报告”的通知，之后的地址既不发出也不记录。
- `Modbus_Emulator` 继承 `EventEmitter`：转发各 server 与 handler 的事件，server 事件的载荷带上服务标签（issue#31epb8mc）。调用方使用模拟器时只需监听模拟器。
- `error` 事件：`EventEmitter` 在无监听器时发出 `error` 会抛出异常。去掉 `log_events` 后 server 的 `error` 不再有默认监听器，一个连接错误就可能使进程崩溃。因此模拟器始终监听每个 server 的 `error`，并改名转发（如 `server_error`，载荷 `{ server, error }`），不发出自己的 `error`。直接使用工厂的调用方须自行监听 server 的 `error`，在 spec 中写明。
- 构造期的诊断（如 issue#rks1v7pr 的警告）发生在调用方能挂监听器之前，不用事件，收入模拟器的 `warnings` 属性。

待定：各事件名与载荷格式。

需同步 spec / design（含中文版）、`src/index.d.ts`、README。属 breaking change。

放弃的方案：

- 只在 server 上发出事件：handler 级事件无法归属某个 server，且调用方要逐个订阅、自行维护与描述条目的对应关系。
- 只在模拟器上发出事件：手工装配的调用方没有模拟器，拿不到事件。
- 每次访问都发出未映射地址事件、由订阅方去重：主站轮询时会持续淹没监听器。
- 只去掉一侧的 logger 包装：工厂是公开函数，直接调用者依赖工厂内的包装，模拟器侧的包装又用于 handler，且整套 logger 即将去掉，单独修改没有意义。

## 裁定
