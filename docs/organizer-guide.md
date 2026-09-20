# 主办方操作指南

**日常运维全部在网页上点，不需要命令行。**

管理后台：https://bh3gei.github.io/agent-observer/admin
（用管理员账号登录后，顶部导航最右边会出现「管理」入口。）

后台有 9 个标签页：概览 · 阶段 · 场景 · 提交 · 队伍 · 用户 · 公告 · 额度 · 设置。

---

## 1 · 比赛现在能不能报名？开关在哪

练习赛（practice）常开，学员随时能提交。正式比赛（online）只在 10 月 4–7 日窗口内接受智能体提交。

**「管理」→「阶段」** 页上每个阶段一张表单，直接改：

| 想做的事 | 改哪个 |
|---|---|
| 临时关掉某个阶段 | 取消勾选「启用」，点保存 |
| 改比赛起止时间 | 「开始时间 (UTC)」「结束时间 (UTC)」 |
| 改每天提交次数 | 「每日上限」 |
| 只允许传结果文件 / 只允许传智能体 | 「允许结果文件」「允许智能体运行」 |
| 藏起排行榜 | 「榜单模式」改成 `hidden` 或 `frozen` |
| 重算这个阶段的所有分数 | 「重新评分」按钮 |

关闭后学员仍然能看到页面和历史成绩，只是不能再提交。

## 2 · 查看排队 / 评测 / 分数

**「管理」→「概览」** 一眼看全：用户数、队伍数、提交数、排队中、已评分、失败，下面是最近 15 条提交和审计日志。

**「管理」→「提交」** 可以按状态筛选，每条能重新评分、作废、排除出排行榜。

`status` 取值：`queued`（排队）→ `running`（评测中）→ `scored` / `invalid` / `failed`。

## 3 · 比赛期间的 worker（谁在跑学员的程序）

**「管理」→「概览」** 页上的「评测 Worker」面板直接显示：在线 / 离线、当前排队数、本次已处理数、距上次心跳多少秒。每 15 秒自动刷新。

worker 在 GitHub Actions 上自动接力运行（`.github/workflows/worker.yml`），每个最多在线 5.5 小时，结束前自动拉起下一个，正常情况下你不用管。

**如果面板显示「离线」超过 30 分钟**：到 GitHub Actions 手动运行一次 "Evaluation worker" 工作流即可。

> 一个 worker 处理一个场景最多 1 小时（eval-a/b 的全局时钟 3600 秒）。10 支队伍同时提交会排队约 10 小时。想缩短排队：在「场景」页把 wallclock 临时调小，或临时改 `worker.yml` 里的 `concurrency` 组名多开一个 worker。

## 4 · 换正式比赛的场景种子

**为什么要换**：知道种子就能在本地重建出完整的"隐藏天气"，把最优解提前算好。**每次正式开赛前都应该换一次新种子。**

**「管理」→「场景」** → 找到 `eval-a` / `eval-b` → 点「**轮换种子**」。

点下去之后：系统生成一个新的随机种子，交给正在运行的 worker 重建场景并上传，页面上显示「排队中 → 生成中 → 已完成」，通常一分钟内完成。种子只写进数据库，不会出现在代码仓库里，学员也读不到。

> 轮换会一并重抽隐藏真值：`weather_events.csv` 里的 `instrument_fault` 故障事件和 `tile_anomalies.csv` 里的 nova/reddening 标签都由场景种子派生。

**必须在该场景所属阶段开放之前操作。** 比赛进行中轮换会让正在评测的提交对不上。

> 种子不再写在仓库里，也不再通过网站 API 暴露给学员。想查当前种子，只能在这个页面上看（管理员可见）。

## 4.5 · 异常事件与上报的校准旋钮

异常上报机制（protocol v2 / snapshot v3 / weather v2）的全部数值都在版本化配置里，改完配置需要重建场景（见第 4 节）并回归测试：

| 旋钮 | 位置 | 占位值 |
|---|---|---|
| 效率抖动区间 | `weather_config.json` → `quality.instrument_efficiency.jitter_minimum/maximum` | 0.90 / 1.00 |
| 故障事件（次数、持续、范围权重、乘数下限） | `weather_config.json` → `events.instrument_fault` | 1 次、持续至修复或巡天结束（`persists_until_survey_end`）、恒 REGION_SET、×0.10 |
| 故障效率乘数带（直接抽取区间） | `weather_config.json` → `events.instrument_fault.instrument_efficiency_multiplier_range` | [0.40, 0.70]（缺席则退回 severity 缩放旧行为） |
| 隐藏标签数量 | `tile_config.json` → `anomaly_tags.nova_count / reddening_count` | 2 / 2 |
| 标签乘数 | `score_config.json` → `anomaly_tags.nova_factor / reddening_factor` | 1.5 / 0.8 |
| 标签上报赏罚 | `score_config.json` → `reporting.reward_correct / penalty_wrong` | +100 / −150 |
| 故障误报免费额度与罚分 | `score_config.json` → `reporting.fault_misreport_free_allowance / fault_misreport_penalty` | 1 / 100 |
| 故障响应延迟 x1 / 修复时长 x2（模拟日） | `score_config.json` → `fault_response.response_latency_days / repair_duration_days` | 1 / 2 |
| 参考智能体的检测阈值 | 环境变量 `SAC_ANOMALY_*`（见 `agent/anomaly_detection.py` 头部注释） | 见代码默认值 |

注意事项：

- 故障效率乘数带由两处配置共同决定：`events.instrument_fault.instrument_efficiency_multiplier_range`（[lo, hi]，直接均匀抽取最终乘数，不再经 severity 间接缩放）与绝对地板 `quality.instrument_efficiency.minimum`（0.10，clip 之后任何路径都不会低于它——带下限别再低于它，否则被截平）。其他事件仍支持可选 `severity_range`（缺席默认 [0.55, 1.0]），经 `1 + severity × (配置乘数 − 1)` 缩放。
- 占位值都是"待主办方校准"状态；改过任何一项后，用干净场景（无故障、无标签）跑一次参考智能体确认**零上报**，再跑一次正常场景确认标签与故障都被报出。
- 故障事件恒为 `REGION_SET` 作用域（`scope_weights` 只剩 REGION_SET）：参考智能体的维修期避让因此是完整的。生成器与其他事件仍支持全部 scope 类型（SKY_CAP_ICRS / HORIZON_SECTOR / ...），若未来给故障重新放开非 REGION_SET 作用域，注意参考智能体的避让只覆盖 REGION_SET 与 SKY_CAP_ICRS（HORIZON_SECTOR 需要选手端没有的挂载几何）。
- `weather.csv` 只含基线加全局事件；故障只经 `get_effective_conditions` 作用于评分器——选手快照永远看不到故障乘数，只能靠 `tile_last_finished` 的实现分偏差发现。快照天气同时**不含** `instrument_efficiency` 字段（preview 基线不乘效率）：抖动、故障乘数、标签乘数全部汇入"基线 vs 实现分"的偏差信号。注意 cold_wave 是公开可预报事件且也压效率——参考检测层会把预报覆盖 cold_wave 期间的读数排除出异常证据，改动相关参数后要复核这一补偿仍然有效。

## 5 · 给同事开权限

**比赛站管理员**（能看所有队伍、重跑评测、发公告、换种子）：
「管理」→「用户」→ 找到这个人 → 点「设为管理员」。

> 对方要先在比赛站注册过账号才能在这里找到。另外「管理」→「设置」里有一份管理员邮箱白名单，写进去的邮箱注册时会自动带管理员权限。

**Supabase 控制台权限**（能看数据库、改配置）：
https://supabase.com/dashboard/org/cosmos/team → Invite member。

## 6 · 学员端在哪

- **网址**：https://bh3gei.github.io/agent-observer/
- **新手教程**：站点「新手上路」页（顶部导航第一个）
- **入门包**：站点「资源」页 →「下载入门包」
- **完整文档**：站点「文档」页

## 7 · 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| 学员上传后一直 `queued` | worker 没在跑 | 「概览」页看 Worker 面板；离线就去 GitHub Actions 跑一次 "Evaluation worker" |
| 提交立刻 `invalid` | zip 根目录没有 `minimal_agent.py` / `agent.py` / `main.py` | 让学员按「新手上路」重新打包，或直接传 `my_strategy.py` 单文件 |
| 练习赛场景加载慢 | `dev-reference` 有 180 个观测夜，文件较大 | 正常，首次下载后 worker 会缓存 |
| 排行榜不更新 | 前端缓存 | 强制刷新（⌘⇧R） |
| 学员收不到密码重置邮件 | 项目用的是 Supabase 内置邮件，限流 2 封/小时（全站） | 在「管理」→「用户」里帮他改；长期方案是接一个自建 SMTP |

---

## 附：命令行兜底

网页覆盖不到的只有"新建一个场景"。需要时在仓库根目录执行：

```bash
source .secrets/supabase.env
source .venv/bin/activate

# 新建场景（不带 --seed 就是随机种子，推荐）
python -m worker.main gen-scenario --slug eval-c \
  --name "Competition scenario C" --days 30 --start-date 2026-12-01 \
  --wallclock 3600 --hidden-weather --hidden-forecasts
```

`.secrets/supabase.env` 里已经有 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`。key 换了的话，去 Supabase 控制台 → Project Settings → API 取新的 service_role 值贴回去。

## 重建正式比赛场景（异常机制版）

正式赛场景启用完整异常机制（隐藏 nova/reddening 标签、仪器故障、效率抖动、上报通道、覆盖均匀度 0.35）。
换种子重建（在配好 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 的机器上）：

```bash
python -m worker.main gen-scenario --slug eval-a --seed <新种子> --days 30 --start-date 2026-10-05 \
  --wallclock 3600 --regions 8 --tiles-per-region 200 --coverage-weight 0.35 \
  --nova-tags 10 --reddening-tags 10 --hidden-weather --hidden-forecasts
```

`tile_anomalies.csv` 会随场景上传，但不在任何公开文件名单里——存储策略按文件名放行，选手拿不到。
`--nova-tags 0 --reddening-tags 0` 可以生成不带异常机制的场景（旧合约）。

**不要重新执行 `seed`**：练习场景（demo-week / dev-fortnight / dev-reference）已在存储中冻结，
与入门包捆绑副本逐字节一致；生成模板升级后重新生成会破坏这一致性。入门包测试用固定校验值锁死了这两份副本。

## 两个新开关（设置页）

- **新机制是否公开**（`mechanics_public`）：关掉后，官网上的"正式赛新机制"教程章节、3 条 FAQ、新手页演练步、通关路线里的相关措辞会全部隐藏（内容保留，随时可开）。注意：入门包本身和规则/文档页的深处描述不受此开关控制。
- **报名截止时间**（`registration_deadline`）：到点后新用户注册自动停止（数据库层强制，绕过网页直接调接口也注册不了）；已注册用户登录、提交、组队完全不受影响。留空 = 不设截止。关闭期间管理端 API 也无法建号，要临时加人先把"开放报名"勾回来。
