---
id: ww7asdqc
opened: 2026-10-17T23:58:10.000Z
closed:
title: 读取错误不在 errors 中
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：`src/emulator.js` 中 `readFileSync(item, "utf8")`。

文件不存在时抛出原始的 `ENOENT`，没有 `errors` 属性，与“汇总所有违规一次性抛出”的约定不一致。

## 解决提案

文件不存在等读取错误也收入 `errors`。

## 裁定
