---
id: 4rk8vyme
opened: 2026-10-17T23:58:05.000Z
closed: 2026-10-23T14:43:50.000Z
title: 启动失败后部分服务仍在运行，且只报告第一个错误
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [69f738d]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：`src/emulator.js` 的 `start()`。

`Promise.all` 在第一个失败时就 reject，已经启动的服务不会回滚。

复现：两个服务中一个的端口填 99999，`start()` 被拒绝，另一个服务随后仍在监听。调用方拿到失败，进程里却留下了无人管理的 socket。

同时，`start()` 只抛出第一个错误，不标明是哪个服务失败，其余服务的失败被丢弃。

## 解决提案

可利用的 es-modbus 行为：每个服务的 `start` / `stop` 在内部排队执行；`stop()` 等前面的 `start` 结束后才执行，且从不 reject；对没有启动过的服务调用 `stop()` 立即返回；对运行中的服务调用 `start()` 会先停再启。

- `start(options)` 用 `Promise.allSettled` 等所有服务都有结果，再处理失败。
- 默认（全部或全部不）：有任一服务失败，就调用 `stop()` 停掉所有服务（包括调用前已在运行的，因为 `start()` 本身就是重启），然后抛出 `AggregateError`。`start()` 成功即表示所有服务都在运行，失败即表示都已停止。
- `{ partial: true }`（尽力启动）：启动成功的服务保持运行，不回滚。只要有失败，仍然抛出同样的 `AggregateError`，使失败不会被忽略；两种模式只在“是否停掉其他服务”上不同。适用于调试场景，例如串口没插，TCP 服务照样可用。
- `AggregateError` 列出所有失败。每项是一个 `Error`，消息标明服务，如 `servers[1] (modbus://0.0.0.0:503): EADDRINUSE`，原始错误放在 `cause`。
- 服务标签（描述中的位置 `servers[i]` 和地址）在构造时保存，与 issue#31epb8mc 共用同一份数据。
- `stop()` 保持 `Promise.all` 不变。
- 与 issue#2jdmx0kw 的关系：端口范围校验只能挡住配置错误，端口被占用（EADDRINUSE）、串口不存在等运行时失败仍会发生，所以这里的处理仍然需要。
- 先改 spec / design（含中文版）与 `src/index.d.ts`（`start(options?: { partial?: boolean })`）。

测试：占用一个端口，默认模式下另一个服务被停掉，partial 模式下另一个服务仍在监听，两种模式都抛出 `AggregateError`。

## 裁定

问题成立，需修复：`start()` 失败时会留下仍在运行的服务，且失败报告不完整。采用解决提案的方案：默认全部或全部不，`{ partial: true }` 时尽力启动；两种模式都抛出列出全部失败的 `AggregateError`。
