---
id: wj7pqv4h
opened: 2026-10-17T23:58:28.000Z
closed:
title: 发布配置不完整
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

- 已有 `files` 白名单，`.npmignore` 多余；它排除了 `src/`（会把 `src/index.d.ts` 一并排除），且写的是 `rollup.config.js`，不是 rolldown；
- 缺少 LICENSE、CHANGELOG，`author` 为空，也没有 `repository`、`homepage`、`bugs`。

## 解决提案

删除 `.npmignore`，由 `files` 白名单决定发布内容；补全 `package.json` 的 `author`、`repository`、`homepage`、`bugs`；补 LICENSE 文件（license 为 ISC）。在版本提交时处理。

## 裁定
