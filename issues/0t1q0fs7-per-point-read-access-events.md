---
id: 0t1q0fs7
opened: 2026-10-17T23:58:14.000Z
closed:
title: 逐点读取使 access 事件重复且不精确
status: open        # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title: 问题描述
proposal_title: 解决提案
decision_title: 裁定
---

## 问题描述

位置：`src/unit_map.js` 的 `get_holding_register` / `get_input_register` / `get_coil`。

es-modbus 对 FC3 / FC4 的每个寄存器、FC1 / FC2 的每个线圈单独调用一次 handler，handler 每次调用一次 `Ldata.read_bytes`，`read_bytes` 每次都发出一次 `access("read", tags)`。`access` 是 layout-data 的诊断手段，例如核对一条规则声明的依赖与它实际的依赖；对模拟器而言，主站的一次请求才是一次读，下面两点使诊断失真。

- 重复：一次请求读几个点，就发出几次 `access`。实测：FC3 读 `id`（UInt）、`status`（Word）、`pressure`（Real）共 4 个寄存器，发出 4 次，`pressure` 出现 2 次；FC1 读 `status` 的 16 个线圈，发出 16 次。
- 不精确：`read_bytes` 没有位掩码，读一个线圈时，同一字节里的所有 Bool 都被报为被读。实测：读线圈 17（不是 `alarm` 的位）也报告了 `alarm`。写方向的 `write_bit` 带掩码，是精确的；layout-data 0.2.0 没有对应的按位读取。

layout-data 0.2.0 的 `Ldata.transaction` 解决不了：它只推迟 `change` 和 `write`，`access` 在每次读写调用时立即发出，事务内被回滚的写入也照样发出了 `access write`（实测）。layout-data 0.3.0 已把 `access` 纳入 `transaction`，并增加了按位读取 `read_bit`，见解决提案。

次要影响是开销：每个点线性扫描段、分配结果对象与 Buffer 副本。实测（4 个块，读最后一个块）FC3 读 125 个寄存器，逐点约 10 µs，一次 `read_bytes` 约 0.2 µs；相比通信耗时（局域网 TCP 往返百微秒到毫秒级，RTU 9600 波特传输 255 字节约 265 ms）可以忽略，单独不值得修。

写方向见 issue#6w441q89。

## 解决提案

让一次读请求对每个块只发出一次精确的 `access`。需要三处配合：

- 外部依赖 es-modbus（es-modbus#yjaww5qx）：0.3.0-beta.4 已提供可选的批量读方法 `get_holding_registers` / `get_input_registers` / `get_coils`，各自对一次 FC3 / FC4 / FC1 请求只调用一次；handler 没有离散输入方法时，FC2 也调用 `get_coils`。本包的线圈与离散输入是同一内容，不提供离散输入方法。本包已锁定该版本（issue#61qwgnt5）。逐点调用不知道请求的边界，本包无法把一次请求包进一个事务，所以批量方法是必需的。
- 外部依赖 layout-data：0.3.0 已提供以下两项。
  - 与 `write_bit` 对称的按位读取 `read_bit(offset, mask)`（layout-data#dy6d5xgj），使读线圈时 `access` 只报告被读的 Bool。
  - `access` 纳入 `transaction`（layout-data#jt0zxgth）：事务内按 `read` / `write` 分别累积涉及的 tag，提交时每种发出一次；回滚时丢弃 `access write`。回滚时照常发出 `access read`；推迟后监听器不再能通过抛出异常否决读取；语义详见该 issue。
- 本包：handler 实现批量读方法，按块切分请求，每个块的部分在该块的 `transaction` 中读取（寄存器一次 `read_bytes`，线圈逐位 `read_bit`），块之间的空隙照旧读为 0 / false 并报告未映射地址。开销问题随之消除。

两项外部依赖都已发布（es-modbus 0.3.0-beta.4、layout-data 0.3.0），剩下本包这一侧的实现。

放弃的方案：

- 在逐点调用中用 `transaction` 包住读取：逐点调用不知道请求的边界，一次请求无法包进一个事务（layout-data 0.2.0 的 `transaction` 也不推迟 `access`）。
- 线圈读改为一次 `read_bytes` 整个字节范围：次数对了，但仍按字节报告，不精确。
- 只按开销裁定为 wontfix：开销确实可以忽略，但 `access` 的重复与不精确是正确性问题。

## 裁定
