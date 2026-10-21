---
id: 31epb8mc
opened: 2026-10-17T23:58:22.000Z
closed:
title: servers 与描述条目无对应关系
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

`servers` 是一个裸数组，调用方无法从 server 对应回描述文件中的条目，也不能按名称查找。

## 解决提案

`servers` 暴露与描述条目的对应关系（如 `{ protocol, label, server }` 或按名称查找）。服务标签与 issue#4rk8vyme 共用同一份数据。

同一标签还用于标明事件来源：模拟器转发 server 事件时，载荷带上该标签（见 issue#mnwdf2fy）。

## 裁定
