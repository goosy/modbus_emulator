---
id: fxp6kvma
opened: 2026-10-17T23:58:26.000Z
closed:
title: 测试辅助函数 free_port 重复且有竞态
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

`free_port` 先探测再释放端口，释放后到被测服务监听之间，端口可能被别的进程占用，导致测试偶发失败。它在 `test/emulator_test.js` 与 `test/server_test.js` 中重复实现。

## 解决提案

合并为一个共享的测试辅助模块。让被测服务监听端口 0 并读取实际端口，以消除竞态。

## 裁定
