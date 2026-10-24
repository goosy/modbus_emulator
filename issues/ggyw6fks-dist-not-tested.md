---
id: ggyw6fks
opened: 2026-10-17T23:58:25.000Z
closed: 2026-10-24T09:26:31.000Z
title: 构建产物未被测试
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

`pnpm test` 先构建 `dist`，但测试导入的是 `../src`，`dist/modbus_emulator.js` 从未被测试。

## 解决提案

补 dist 冒烟测试，或去掉测试前的构建步骤。

## 裁定

问题成立，补 dist 冒烟测试，保留测试前的构建步骤：发布的是 `dist`，打包配置（外部依赖、tree-shaking、导出）出错时只有测试 `dist` 才能发现。
