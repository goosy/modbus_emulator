---
id: cxh7ygz3
opened: 2026-10-17T23:58:20.000Z
closed: 2026-10-24T16:18:10.000Z
title: 布局注册每进程一次的约束未写入 spec
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

`register_layout` 每进程只能成功一次，这是 layout-data 的设计。由此，带有布局（`layouts` 或 `layouts_file`）的描述，每个进程只能构造一次模拟器，不论成功还是失败。spec 没有写出这一约束，也没有说明需要多个实例、或在同一进程内重建实例时该怎么做。

## 解决提案

在 spec（含中文版）中写明：

- 带布局的描述，每个进程只能构造一次模拟器；描述有误时，改正后重启进程。
- 需要在同一进程中运行多个模拟器，或不动布局只重建实例（如换端口、IP）时，让布局独立于实例：先用本包转发的 `register_layout` 单独注册全部布局，描述中不带布局、只引用布局名；这样的描述在同一进程中可以多次构造。

## 裁定

问题成立，按解决提案修复：spec（含中文版）写明带布局的描述每进程只能构造一次、出错改正后重启进程，以及单独注册布局、描述只引用布局名的用法；design 中“每进程一个模拟器”的说法一并改为准确的约束。
