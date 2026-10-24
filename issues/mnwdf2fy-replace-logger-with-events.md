---
id: mnwdf2fy
opened: 2026-10-23T13:15:47.067Z
closed:
title: 诊断信息通过注入的 logger 输出，调用方无法以事件方式处理
status: accepted    # open | accepted | fixed | rejected | wontfix
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

事件名与载荷：

- handler 发出：
  - `unmapped`，载荷 `{ kind, unit_id, addr }`，`kind` 为 `"holding_register"` / `"input_register"` / `"coil"`；按上述去重，同一地址只发一次。
  - `unmapped_limit`，载荷 `{ limit }`：已发出的地址达到上限（1024）时发出一次，之后的地址不再发出。
  - `listener_error`，载荷 `{ block, error }`：提交阶段块的监听器（`change` / `write` / `access`）抛出的异常；数据已写入，主站照常收到应答（issue#6w441q89、issue#0t1q0fs7）。
- 模拟器转发：
  - server 的事件统一加前缀 `server_`：`server_start`、`server_stop`、`server_socket_connect`、`server_socket_disconnect`、`server_socket_error`、`server_error`、`server_handler_error`。载荷为 `{ server, label, ... }`，es-modbus 原有的参数放入命名字段（`socket` / `error`）；`label` 即 `start()` 报错中的服务标签，如 `servers[1] (modbus://0.0.0.0:503)`。
  - handler 的事件按原名、原载荷转发。
- handler 返回无效值（批量读结果长度不符、寄存器值越界）由 es-modbus 校验，作为 `handler_error` 报告，主站收到 0x04，经模拟器转发为 `server_handler_error`，不另设事件。本包的 handler 由块的字节构造返回值，出现无效值只能是本包的缺陷。

现状：spec / design（含中文版）已是最终形态，目前的代码没有实现去掉 `logger`、变更接口（工厂与 `create_handler` 去掉 `logger` 选项、`Modbus_Emulator` 继承 `EventEmitter` 并转发事件、`warnings` 属性）等文档要求的功能，`src/index.d.ts` 与 README 也仍是旧接口。

过渡：issue#6w441q89、issue#0t1q0fs7 先于本 issue 实现时，handler 先改为 `EventEmitter`，只发出 `listener_error`（新增，不 breaking），模拟器暂时把它转给 `logger.error`；未映射地址仍经 `logger` 报告，到实现本 issue 时一并改为事件。

需同步 spec / design（含中文版）、`src/index.d.ts`、README。属 breaking change。

## 裁定

问题成立，需修复：调用方只能拿到格式化后的日志文本，无法按类型处理诊断信息，也无法得知其来源。采用解决提案的方案，去掉 `logger`，由 handler 与 server 发出事件，模拟器汇总转发；事件名与载荷见解决提案。
