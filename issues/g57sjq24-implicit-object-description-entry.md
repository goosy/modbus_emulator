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

构造函数接受对象形式的描述（也可以与路径混在一个列表中），控制器项目依赖它，但 spec 与类型声明都未包含它，代码注释还称它“不公开”。隐性契约在重构时容易被破坏。对象中相对的 `layouts_file` 按当前目录解析，这一规则也没有写明。

## 解决提案

在 spec（含中文版）与 `src/index.d.ts` 中公开现有行为，并去掉代码注释中“不公开”的说法：

- `source` 可以是描述文件的路径、描述对象，或二者混合的列表；对象与描述文件的结构相同。
- 对象中相对的 `layouts_file` 按当前目录解析。需要其他基准目录时，调用方传入绝对路径；或按 issue#cxh7ygz3 的做法单独注册布局，对象中不写 `layouts_file`。

测试：路径与对象混合的列表；对象中相对的 `layouts_file` 按当前目录解析。

## 裁定
