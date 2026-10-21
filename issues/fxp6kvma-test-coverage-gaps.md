---
id: fxp6kvma
opened: 2026-10-17T23:58:26.000Z
closed:
title: 测试覆盖缺口
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

缺少的用例：FC15、奇数 `offset`、块重叠、端口越界、文件不存在、启动失败回滚、RTU 广播。`free_port` 先探测再释放端口，存在竞态，且在两个测试文件中重复实现。

## 解决提案

补上述用例（可随各自的修复一起提交）；合并重复的 `free_port`。

## 裁定
