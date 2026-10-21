---
id: g57sjq24
opened: 2026-10-17T23:58:18.000Z
closed:
title: 隐性的对象描述入口
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

构造函数接受对象形式的描述，控制器项目依赖它，但 spec 与类型声明都未包含它。隐性契约在重构时容易被破坏。对象描述中的 `layouts_file` 只能相对于当前目录解析，无法指定基准目录。

## 解决提案

公开对象描述入口（如 `Modbus_Emulator.from_description(obj, { base_dir })`），取代现有的隐性内部入口，并让对象中的 `layouts_file` 可指定基准目录。

## 裁定
