---
id: 2jdmx0kw
opened: 2026-10-17T23:58:11.000Z
closed:
title: 端口校验不完整
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：`src/emulator.js` 的 `#read_servers`。

TCP 端口只检查是否为整数，没有检查 0..65535 的范围（issue#4rk8vyme 复现中的 99999 即由此通过校验）；多个服务使用同一端口也没有检查。

## 解决提案

TCP 端口校验范围 0..65535；多个服务使用同一端口时报错。

## 裁定
