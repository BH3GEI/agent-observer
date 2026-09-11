## 1. 概览

平台按 **challenge v3** 合约（`challenge-score-v3`、`participant-agent-protocol-v1`）评测 DESI 式巡天的观测智能体。一个场景是一个目录：`config/` 下六个配置文件，`outputs/reference/` 下的参考数据（基于真实太阳历的 900 秒时隙日历；含 REQUIRED / FLEXIBLE 两类、只在时间窗内可用的天区与目标目录；带隐藏方向性事件的天气；每日修订、带不确定性的预报；临时观测请求）。智能体把场景变成 `decisions.csv`，冻结的评分器把 `decisions.csv` 变成 `score_report.json`。

获得分数有两条路径：

1. **结果文件。** 在天气公开的场景上自行运行智能体，上传 `decisions.csv`。只有天气公开的练习场景接受结果文件，因为评分器需要完整的天气真值。
2. **智能体程序包。** 以 `.zip` 上传智能体。平台在每个场景上启动一次，通过 JSON-Lines 协议逐条发送已发布的快照，对隐藏天气提交其动作，并对提交的轨迹评分。每个场景一个全局时钟，没有单次决策超时。

两条路径使用同一份 `scoring_core.py`。入门包包含 workflow、评分器、最小智能体与公开的场景文件。

赞助商 API 额度以兑换码形式发放：队伍注册后在控制台领取，每个服务商一个。平台运行允许联网，智能体可以在决策时调用模型 API；把密钥写进程序包的 `.env` 即可。

## 2. 入门包

### 最短路径（不需要任何工具）

1. 下载入门包并解压，双击 `run_baseline.command`（macOS）、`run_baseline.bat`（Windows，先从 python.org 安装 Python 3.12）或运行 `./run_baseline.sh`（Linux）。基线在自带场景上约 12287 分，回放会在浏览器里打开。
2. 修改 `agent/my_strategy.py`：`choose_action(candidates, snapshot, memory)` 收到按估计收益排好序的合法候选，返回要观测的那个，或返回 `None` 等待。再双击一次比较分数。
3. 在「提交」页选择「智能体运行」，把这一个文件拖进去即可，平台会自动补齐入门包其余文件；拖整个 `agent` 文件夹（浏览器内打包）或 `.zip` 也可以。

入门包里的 `QUICKSTART_ZH.md` / `QUICKSTART.md` 就是这三步。下面是给工程师看的完整版。

### 内容与命令


在「资源」页下载 `agent-observer-starter-kit.zip`。目录结构：`agent/`（要提交的智能体：`minimal_agent.py`、`decision_graph.py`、`model_factory.py`、`protocol.py`、`state.py`、`scoring_preview.py`、`requirements.txt`、`.env.example`）、`challenge/`（公开环境：契约、历法、瓦片几何、天气、请求、workflow、评分器、回放渲染器）、`scenarios/dev-reference/`（公开的 180 晚场景）、`local_runner.py`、`score_decisions.py`、`make_scenario.py`、`fetch_scenario.py`、`pack_agent.py`、`sac_submit.py`、`SKILL.md` 与 `README.md`。Python 3.9 及以上加标准库即可运行（macOS 自带的 `python3` 直接可用；Windows 请从 python.org 安装 Python 3.12）。

```
python3 local_runner.py --scenario scenarios/dev-reference --agent agent/minimal_agent.py --wallclock 600 --out run_output
python3 score_decisions.py --scenario scenarios/dev-reference --decisions run_output/decisions.csv
python3 make_scenario.py --out scenarios/mine --seed 7 --days 30 --start-date 2026-10-05
python3 pack_agent.py --agent agent --out my-agent.zip
python3 fetch_scenario.py --list && python3 fetch_scenario.py dev-fortnight   # 其它公开场景 -> scenarios/<slug>/
```

`run_output/decisions.csv` 就是可上传的结果文件；`run_output/score_report.json` 与平台生成的报告一致（场景天气与事件公开时逐字节相同）；`run_output/decision_replay.html` 就是提交页内嵌的那份回放。`fetch_scenario.py` 可把任一已发布场景（如 `dev-fortnight`）完整下载到 `scenarios/<slug>/` 并校验哈希；「资源」页也提供逐个文件的链接。最小智能体不需要任何依赖或密钥（`MODEL_PROVIDER=deterministic`），几秒钟即可跑完 180 晚的场景。

## 3. 数据格式

约定：UTF-8（允许 BOM），逗号分隔，表头必须严格按顺序包含列出的列。时间戳为 `YYYY-MM-DDTHH:MM:SSZ`（UTC）。区间为左闭右开 `[start, end)`。布尔值为小写 `true` / `false`。标识符：夜 `N20260907`，时隙 `N20260907-S001`，天区 `T00001`，分区 `R00`–`R07`，请求 `RQ0001`，目标 `TG00000001`。

### 场景目录

| 路径 | 内容 | 可见性 |
|---|---|---|
| `config/scenario_config.json` | 场景 id、seed、`competition.global_wallclock_seconds` | 公开 |
| `config/calendar_config.json` | 台址（纬度 31.9634°，经度 −111.599°，UTC−7，太阳高度阈值 −12°）、起始日、天数、`slot_seconds` 900 | 公开 |
| `config/tile_config.json` | 目录布局（8 个分区 × 8 个天区，每区 2 个 REQUIRED，其中 1 个只有 14 天可用）、高度下限 30°、月光模型、目标类别 | 公开 |
| `config/weather_config.json` | 质量过程、关闭模型、预报范围与误差模型、事件目录、`score_interface` | 公开 |
| `config/request_config.json` | 请求节奏、截止档期、每个所需天区奖励 140 / 缺失惩罚 190 | 公开 |
| `config/workflow_config.json` | `global_wallclock_seconds`、每周信息 7 天、无单次决策超时 | 公开 |
| `config/score_config.json` | 阈值、项目加成、惩罚、FLEXIBLE 配额 | 公开 |
| `outputs/reference/night_calendar.csv`、`slots.csv` | 共享时间轴（每晚 37–47 个时隙） | 公开 |
| `outputs/reference/tiles.csv`、`targets.csv`、`tile_windows.csv` | 目录、逐目标科学权重、可见窗口示例 | 公开 |
| `outputs/reference/observation_requests.csv`、`observation_request_tiles.csv` | 预生成的请求及其天区 | 公开 |
| `outputs/reference/weather.csv` | 逐时隙站点基线天气 | 仅练习场景公开 |
| `outputs/reference/weather_forecasts.csv` | 不确定、每日修订的预报 | 按场景标记 |
| `outputs/reference/weather_events.csv` | 方向性干扰事件（`active_event_ids` 背后的真值） | 比赛场景隐藏 |
| `outputs/reference/scenario_manifest.json`、`*_metadata.json` | 每个文件的行数与 SHA-256 | 公开 |

### tiles.csv

```
tile_id,ra_deg,dec_deg,nominal_exptime_seconds,region_id,scheduling_class,available_from_utc,available_until_utc,n_lrg,n_elg,n_qso,n_bgs
```

`scheduling_class` 为 `REQUIRED` 或 `FLEXIBLE`。天区只能在 `[available_from_utc, available_until_utc)` 内观测。天区没有固定项目：智能体在决策时选择 `DARK`、`BRIGHT` 或 `BACKUP`，与曝光的质量区间匹配时获得加成。曝光时长为 450、600、900、1200 或 1350 秒。

### targets.csv

```
target_id,tile_id,target_class,feature_flux,redshift,science_weight
```

天区价值 `V_tile = Σ science_weight`（默认 LRG 1.0、ELG 1.0、QSO 1.7、BGS 0.45）。平台在初始消息中以 `tile_science_value` 发布。

### weather.csv

```
slot_id,night_id,timestamp_utc,duration_seconds,is_observable,seeing_arcsec,transparency,sky_quality,instrument_efficiency
```

`is_observable=false` 时四个质量字段为空：圆顶关闭，时隙仍存在并消耗时间。`sky_quality` 为线性质量量（越大越好）。该文件只是站点基线；天区实际感受到的条件还取决于方向性事件（`weather_events.csv`），平台会替你应用，并在每个候选天区的 `effective_weather` 中给出。

### weather_forecasts.csv 与 weather_events.csv

预报含发布时间、预测事件窗口、概率与空间范围；每日修订，可能漏报或误报（默认 12 % 漏报率、每场景 6 个误报）。平台只显示当前游标之前已发布的修订。事件含范围（`ALL`、`REGION_SET`、`SKY_CAP_ICRS`、`HORIZON_SECTOR`、`TILE_SET`）、条件（`rainy`、`cloudy`、`smoggy`、`rocket_launch`、`cold_wave`、`tornado`）与乘子；部分事件会对其覆盖的天区强制关闭。

### observation_requests.csv 与 observation_request_tiles.csv

```
request_id,issued_at_utc,available_from_utc,deadline_utc,deadline_class,completion_mode,required_tile_count,reward,miss_penalty,reason
request_id,tile_id,required_visits
```

请求发布后出现在快照中，到期后消失。观测时标注 `request_id` 才计入请求；对已完成天区的请求标注复访计入请求，但不再获得普通科学分。`ALL` 请求需要列出的全部天区，`AT_LEAST_N` 请求需要其中 `required_tile_count` 个。

### decisions.csv

```
decision_id,slot_id,action,tile_id,program,request_id,reason
```

1. `decision_id` 为任意非空且唯一的字符串（平台生成 `D000001`、`D000002`…）。
2. `action` 为 `observe` 或 `wait`。`wait` 行的 `tile_id`、`program`、`request_id` 留空，消耗当前时隙剩余时间。`observe` 行需要 `tile_id` 与 `DARK` / `BRIGHT` / `BACKUP` 之一的 `program`；`request_id` 可选。
3. `slot_id` 是动作开始的时隙。曝光从游标起持续天区的 `nominal_exptime_seconds`，可跨时隙并按分段评分。短曝光结束后可在同一 `slot_id` 内再提交动作。
4. 晚于游标的时隙会插入隐式等待；早于游标的是 `stale_decision`（受罚，不消耗时间）；未知时隙为 `unknown_slot`。
5. 表格畸形（表头错误、未知动作、带天区的 `wait`、缺天区或项目的 `observe`、重复 `decision_id`）作为无效提交被拒绝。其余情况一律评分，不拒绝。

### score_report.json（`score-report-v3`）

`score{total, base_science, program_bonus, request_reward, penalties{unsafe_observation, invalid_action, avoidable_wait, required_miss, flexible_shortfall, request_miss}}`、`completion{completed_tiles[], required_missing[], flexible_by_region{}, flexible_shortfall{}}`、`requests[{request_id, status, satisfied_tile_count, required_tile_count, feasible_tile_count, reward, penalty}]`、`wait_seconds{explicit, implicit, invalid, avoidable, unavailable}`、每个决策一条的 `actions[]`（`outcome`、`start_utc`、`elapsed_seconds`、`base_science_score`、`program_bonus_score`、`penalty`，以及带 airmass、活动事件、大气与月光质量、质量区间和项目匹配的 `segments[]`）、`termination_reason`、`final_cursor`、`parameters` 与 `input_sha256`。

动作结果：`completed`、`wait`、`weather_interrupted`、`geometry_or_night_interrupted`、`unsafe_observation`、`invalid_observe`、`invalid_request_tag`、`duplicate_tile`、`outside_tile_window`、`unknown_slot`、`stale_decision`。

## 4. 参赛协议（participant-agent-protocol-v1）

平台在每个场景上启动一次你的入口脚本（程序包根目录或唯一顶层文件夹中的 `minimal_agent.py`、`agent.py` 或 `main.py`，按此顺序取第一个存在的），并在整个运行期间保持进程存活。消息通过标准输入输出传递，每行一个 JSON 对象；标准输出不要打印其他内容。标准错误被记录为 `agent.log`，可在提交页下载。每条消息都带 `protocol_version`、`message_type`，除 `initialize` 外还带 `decision_sequence`。

### `initialize`（平台 → 智能体，一次，不需回复）

payload 为 `initial-publication-v2`：`calendar`（首末夜、夜数与时隙数、时隙时长）、`site`、`tile_catalog`（每个天区的公开列加 `tile_science_value`、`required_tile_ids`、`region_ids`）、`target_catalog`（全部目标）、`scoring_contract`（完整 `score_config.json`、天气评分接口与月光模型）以及 `global_wallclock_seconds`。参考目录约 2 MB。启动并读取它有 30 秒预算；全局时钟在其发送完成后开始。

### `decision_request`（平台 → 智能体，每次决策一条）

payload 为 `decision-snapshot-v2`：

- `cursor`：`slot_id`、`night_id`、`timestamp_utc`、`slot_offset_seconds`。
- `current_site_weather`：当前时隙的基线条件（`is_observable`、`seeing_arcsec`、`transparency`、`sky_quality`、`instrument_efficiency`、`active_event_ids`）。
- `candidate_tiles`：未完成、处于可用窗口内、此刻高于 30° 且当夜窗口包含游标的天区。每个带 `scheduling_class`、`nominal_exptime_seconds`、`tile_science_value`、`window_start_utc` / `window_end_utc`、`geometry`（高度、方位、时角、airmass、月距、`lunar_quality_factor`）与 `effective_weather`（对该天区应用方向性事件后的天气）。候选仍可能无法在窗口结束前完成；`scoring_preview.py` 会过滤这些。
- `active_requests`：已发布且未到期的请求，含天区要求与已完成访问。
- `night_start`：每晚第一个时隙给出当夜行与当夜天区窗口；其余为 `null`。
- `weekly`：每第七晚的第一个时隙给出到目前为止发布的预报、未来七天的天区窗口与请求；其余为 `null`。
- `progress`：`completed_tile_ids`、`flexible_completed_by_region`。

任何消息中都没有未来天气。读取快照不推进时间；只有提交的动作才推进。

### `decision_response`（智能体 → 平台）

```
{"protocol_version": "participant-agent-protocol-v1", "message_type": "decision_response", "decision_sequence": 12,
 "action": "observe", "tile_id": "T00037", "program": "DARK", "request_id": "", "reason": "highest preview estimate", "decision_source": "deterministic"}
{"protocol_version": "participant-agent-protocol-v1", "message_type": "decision_response", "decision_sequence": 13,
 "action": "wait", "tile_id": "", "program": "", "request_id": "", "reason": "no completable candidate", "decision_source": "deterministic"}
```

`decision_sequence` 必须与请求相同。`action` 必须是 `observe` 或 `wait`；其他值、畸形行或进程退出都会以 `termination_reason = agent_error` 结束运行，已提交的动作照常评分。未知天区、错误项目或错误请求标注不会被拒绝：评分器把它们作为受罚的无效动作提交，时间继续推进。

### 时间核算

每个场景一个全局时钟（`global_wallclock_seconds`，在「资源」与「提交」页显示：参考场景 7200 秒，短场景更少）。它从初始发布结束起计时，直到巡天完成或时钟到期，并包含快照序列化、你的思考时间与解析时间。没有单次决策限制。在截止时刻或之后到达的响应被丢弃（`ignored_in_flight_response`），进程被终止，已提交动作连同终局惩罚一起评分；报告写明 `global_wallclock_expired`。未处理的未来时间不会被算作可避免等待。

## 5. 评分（challenge-score-v3）

对每次完成的曝光，各分段（按时隙边界切分，取中点）贡献：

```
A_atm      = min(instrument_efficiency · transparency · sky_quality / (seeing_arcsec · airmass), 3.0)
combined   = A_atm · lunar_quality_factor
band       = combined ≥ 0.65 → DARK；≥ 0.40 → BRIGHT；否则 BACKUP
base       = V_tile · (segment_seconds / nominal_exptime_seconds) · combined
bonus      = program == band 时 base · {DARK: 0.25, BRIGHT: 0.15, BACKUP: 0.08}[program]，否则 0
```

`total = base_science + program_bonus + request_reward − unsafe_observation − invalid_action − avoidable_wait − required_miss − flexible_shortfall − request_miss`，常数来自 `config/score_config.json`：

| 项 | 规则 | 数值 |
|---|---|---|
| `unsafe_observation` | 开始时 `is_observable=false` 仍 `observe`；消耗当前时隙剩余时间 | 每次 2000 |
| `invalid_action` | 未知天区/项目/时隙、重复天区、窗口之外、错误请求标注、在天区落下或夜晚结束前无法完成的曝光、过期决策 | 每次 100 |
| `avoidable_wait` | 有未完成天区本可完成时的等待秒数 | 每秒 0.001（每个空时隙约 0.9） |
| `required_miss` | 运行结束时未完成的 REQUIRED 天区 | 每个 1000 |
| `flexible_shortfall` | 某分区完成的 FLEXIBLE 天区少于 4 个 | 每缺一个 100 |
| `request_miss` | 请求到期时访问数不足，除非根本不存在可行机会（`excused_unobservable`） | 每个所需天区 `miss_penalty`（190） |
| `request_reward` | 请求在截止前完成 | 每个所需天区 `reward`（140） |

只有完成的曝光计分。后续分段遇到关闭天气的曝光为 `weather_interrupted`（无科学分，无惩罚）；跑到天区落到 30° 以下或夜晚结束的为 `geometry_or_night_interrupted`（无科学分，记无效动作惩罚）。每个天区只计一次分；月亮升起时月光因子持续降低 `combined`，并可能改变匹配的项目。终局惩罚（`required_miss`、`flexible_shortfall`、`request_miss`）对被时钟或智能体错误截断的运行同样适用。

`scoring_preview.py` 只用当前快照估算各候选的边际价值（不含未来天气）；这是最小智能体使用的同一份代码，永远不能替代正式回放。

## 6. 平台运行与限制

| 项目 | 取值 |
|---|---|
| 解释器 | Python 3.12，`python -B <entry>`，工作目录为程序包目录 |
| 入口脚本 | 程序包根目录（或唯一顶层文件夹）中的 `minimal_agent.py`、`agent.py` 或 `main.py` |
| 依赖 | 可选 `requirements.txt`，在时钟开始前用 pip 装进每次运行独立的虚拟环境（最多 15 分钟） |
| 密钥 | 可选 `.env`（`KEY=VALUE` 行），只注入智能体环境；不记录、不上传 |
| 网络 | 允许（模型 API）；主办方可配置出口代理 |
| 初始化 | 启动并读取 `initialize` 有 30 秒；失败记为 `agent_initialization_error` |
| 时钟 | 场景的 `global_wallclock_seconds`；无单次决策限制 |
| 内存 / CPU | 2 GB、一个 CPU、128 个进程、程序包 `scratch/` 目录下最多 256 MB 写入 |
| 程序包 | `.zip`（不依赖其他文件时也接受单个 `.py`）≤ 20 MB、≤ 2,000 个文件、解压后 ≤ 50 MB、不含符号链接 |

智能体可用的环境变量：`PARTICIPANT_PROTOCOL=participant-agent-protocol-v1`、`SAC_SCENARIO`（slug）、`SAC_WALLCLOCK_SECONDS`、`HOME` 与 `TMPDIR`（scratch 目录），以及 `.env` 中的全部内容。场景目录不会挂载进智能体沙箱；你能看到的天气只有快照发布的内容。

## 7. 提交

### 网站

控制台 → 提交。选择阶段、提交类型、场景（仅结果文件，且仅天气公开的场景）与文件。页面显示场景的全局时钟以及队伍今日剩余次数。每次提交都有独立页面：得分分解、完成情况、请求、等待秒数、终止原因、智能体运行面板（已提交动作、已用时钟、`agent.log`、`workflow_result.json`）、交互式决策回放、已观测天图、动作时间线，以及可下载的 `score_report.json` / `decisions.csv`。

### 命令行

```
python3 sac_submit.py --phase practice --kind results --scenario dev-fortnight --file run_output/decisions.csv --wait
python3 sac_submit.py --phase online --kind agent --file my_agent.zip --wait
```

`sac_submit.py` 读取 `SAC_URL`、`SAC_KEY`、`SAC_EMAIL`、`SAC_PASSWORD`（见「资源」页），`--wait` 轮询直到评测结束。

## 8. 练习赛与线上比赛

| | 练习赛 | 线上比赛 |
|---|---|---|
| 场景 | `dev-reference`（180 晚，公开示例）与 `dev-fortnight`（14 晚）；天气、预报、事件全部公开 | `eval-a`、`eval-b`（各 30 晚）；天气、预报、事件隐藏 |
| 提交 | 结果文件或智能体程序包，每队每天 50 次 | 仅智能体程序包，每队每天 10 次 |
| 得分 | 榜单仅供参考 | 两个场景的平均值；决定奖项 |

练习场景公开了 `weather_events.csv`，因此本地运行 `score_decisions.py` 能逐字节复现平台报告。比赛场景只能由平台评分，且只能通过协议。

## 9. 策略提示

1. REQUIRED 天区每个缺失扣 1000，其中一半只有 14 天可用：优先安排。
2. 每个分区完成 4 个 FLEXIBLE 天区可避免每个 100 的缺额；分散到各分区比压榨单个分区更重要。
3. 项目加成为基础分的 25 % / 15 % / 8 %；用 preview 的 `combined_quality` 选择区间，注意长曝光可能随月亮升起或 airmass 增大而滑入另一区间。
4. 等待很便宜（每时隙 0.9），而一次不安全曝光扣 2000：绝不在 `is_observable=false` 时观测；方向性事件活动时优先选 `effective_weather` 开放的天区。
5. 请求每个所需天区奖励 140、缺失扣 190：每个快照都检查 `active_requests`，并在观测时标注 `request_id`。
6. 时钟是全局的。几百次决策各调用一次模型可以承受，180 晚约 8,000 次决策则不行；把显而易见的等待交给确定性代码。

## 10. 本地自检清单

1. `local_runner.py` 在 `scenarios/dev-reference`（以及 `make_scenario.py` 新生成的种子）上以 `termination_reason = survey_complete` 结束。
2. `score_decisions.py` 对生成的 `decisions.csv` 输出与运行相同的 `score.total`。
3. 程序包解压后入口脚本位于根目录，`requirements.txt` 能装进全新虚拟环境，`.env` 只含智能体需要的密钥。
4. 智能体只写 `scratch/`，标准输出只打印协议行。
