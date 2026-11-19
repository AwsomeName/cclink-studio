# Ibex 源码入门卡

Ibex 是用 SystemVerilog 编写的开源 32 位 RISC-V CPU 核，支持参数化配置，适合嵌入式控制应用。[项目 README](https://github.com/lowRISC/ibex/blob/3d524f19ee8e464b3fb0e29c77dc9ff45934815a/README.md#L8-L10)

## 默认流水线怎么分工

| 级 | 职责 |
|---|---|
| IF · 取指 | 通过预取缓冲从存储器取指。指令侧存储系统允许时，每周期可取一条。 |
| ID/EX · 译码与执行 | 对取来的指令译码并执行，寄存器堆的读写也在这一级完成。多周期指令会让该级停顿，直到执行完成。 |

默认配置采用这两级。Ibex 也支持通过配置加入第三级 Writeback（写回）。[两级职责](https://github.com/lowRISC/ibex/blob/3d524f19ee8e464b3fb0e29c77dc9ff45934815a/doc/03_reference/pipeline_details.rst#L11-L18) · [默认配置与可选写回级](https://github.com/lowRISC/ibex/blob/3d524f19ee8e464b3fb0e29c77dc9ff45934815a/doc/03_reference/pipeline_details.rst#L32-L36)

## 初读选 IF，追一个有效位

从一个问题入手：**IF 送来的指令，到哪一拍才算在 ID 级有效？** 这个问题只需跟踪一个比特，就能看懂两级怎样交接指令。阅读路径是 `rtl/ibex_if_stage.sv` → 模块 `ibex_if_stage` → 下一状态 `instr_valid_id_d` → 寄存器 `instr_valid_id_q` → 输出 `instr_valid_id_o`。[模块入口](https://github.com/lowRISC/ibex/blob/3d524f19ee8e464b3fb0e29c77dc9ff45934815a/rtl/ibex_if_stage.sv#L7-L17) · [有效位逻辑](https://github.com/lowRISC/ibex/blob/3d524f19ee8e464b3fb0e29c77dc9ff45934815a/rtl/ibex_if_stage.sv#L610-L624)

```systemverilog
  assign instr_valid_id_d = (if_instr_valid & id_in_ready_i & ~pc_set_i) |
                            (instr_valid_id_q & ~instr_valid_clear_i);
  assign instr_new_id_d   = if_instr_valid & id_in_ready_i & ~pc_set_i;

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      instr_valid_id_q <= 1'b0;
      instr_new_id_q   <= 1'b0;
    end else begin
      instr_valid_id_q <= instr_valid_id_d;
      instr_new_id_q   <= instr_new_id_d;
    end
  end

  assign instr_valid_id_o = instr_valid_id_q;
```

复位释放后，每个 `clk_i` **上升沿**，`instr_valid_id_q` 都采样 `instr_valid_id_d`。先读表达式左项：`if_instr_valid=1`、`id_in_ready_i=1` 且 `pc_set_i=0` 时，本拍接收新指令。再读右项：清除请求控制旧有效位能否保留。两项按位或，得到下表。[下一状态与采样](https://github.com/lowRISC/ibex/blob/3d524f19ee8e464b3fb0e29c77dc9ff45934815a/rtl/ibex_if_stage.sv#L610-L622)

| 上升沿接收新指令 | `instr_valid_clear_i` | 沿后 `instr_valid_id_q` |
|---|---|---|
| 是 | 0 或 1 | 写 1。即使同拍请求清除，新指令仍使 ID 有效。 |
| 否 | 1 | 写 0。旧有效位被清除。 |
| 否 | 0 | 采样旧的 `instr_valid_id_q`，值保持不变。 |

**复位单独看。** `rst_ni` 从 1 拉到 0 时，寄存器异步清零，无需等待时钟沿。复位持续为低时，时钟上升沿仍写 0。复位释放后的下一个上升沿才重新采样下一状态。输出 `instr_valid_id_o` 直接反映寄存器当前值。[复位、采样与输出](https://github.com/lowRISC/ibex/blob/3d524f19ee8e464b3fb0e29c77dc9ff45934815a/rtl/ibex_if_stage.sv#L614-L624)

本卡依据固定提交 `3d524f19ee8e464b3fb0e29c77dc9ff45934815a` 的文档与 RTL 静态阅读。
