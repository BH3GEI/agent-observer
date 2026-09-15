# 主办方操作指南

所有命令都在仓库根目录 `survey-agent-challenge/` 下执行。密钥已在 `.secrets/supabase.env`，每条命令前先执行：

```bash
source .secrets/supabase.env
source .venv/bin/activate
export SUPABASE_URL="$SUPABASE_URL"
export SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
```

> `supabase.env` 里已经包含 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`（service role）。如果哪天 key 换了，去 Supabase 控制台 → Project Settings → API，把新的 service_role 值贴回去。

## 1 · 比赛现在能不能报名？开关在哪

练习赛（practice）常开，学员随时能提交。正式比赛（online）只在 10 月 4–7 日窗口内接受智能体提交，由 `phases` 表的 `starts_at` / `ends_at` 控制。

**查看当前状态**（无需登录数据库）：

```bash
curl -s "$SUPABASE_URL/rest/v1/phases?select=slug,is_active,starts_at,ends_at,allow_results,allow_agents,daily_limit" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | python3 -m json.tool
```

**手动开关**（把 `practice` 换成 `online` 即操作正式赛）：

```bash
# 关闭练习赛
curl -s -X PATCH "$SUPABASE_URL/rest/v1/phases?slug=eq.practice" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=minimal" \
  -d '{"is_active": false}'

# 重新开启：同上，把 false 改成 true
```

关闭后学员仍然能看到页面和历史成绩，只是不能再提交。

## 2 · 查看排队 / 评测 / 分数

**一次看全**：浏览器打开 https://supabase.com/dashboard/project/vdiemcofukuxglqsmlyz/editor ，点 `submissions` 表。

**只想看有多少人在排队**：

```bash
curl -s "$SUPABASE_URL/rest/v1/submissions?select=id,status,created_at&status=eq.queued&order=created_at.asc" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | python3 -m json.tool
```

`status` 取值：`queued` → `running` → `scored` / `invalid` / `failed`。分数在 `evaluations` 表（通过 `submission_id` 关联）。

## 3 · 比赛期间的 worker（谁在跑学员的程序）

worker 在 GitHub Actions 上自动运行（`.github/workflows/worker.yml`）：每个 worker 最多在线 5.5 小时，结束前自动拉起下一个，形成"接力链"，你不用管。

**当前有几个 worker 在跑**：

```bash
gh run list --repo BH3GEI/agent-observer --workflow "Evaluation worker" --limit 5
```

**正常情况**：恰好一条 `in_progress`，偶尔多一条 `pending`（正在交接）。**如果长时间（超过 30 分钟）没有任何 `in_progress`**，手动拉起一个：

```bash
gh workflow run worker.yml --repo BH3GEI/agent-observer --ref main
```

**想临时开第二个 worker**（比如比赛期间排队堆积）：workflow 里有 `concurrency` 组限制，同一个仓库名下永远只跑 1 个。想多开，临时把 `.github/workflows/worker.yml` 里的 `group: evaluation-worker` 改成别的名字（例如 `evaluation-worker-2`），提交后手动 `workflow_dispatch` 一次即可；比完改回来。

> 一个 worker 处理一个场景需要最多 1 小时（eval-a/b 的 `global_wallclock_seconds = 3600`）。10 支队伍同时提交会排队约 10 小时。想缩短排队：开第二个 worker，或临时把场景的 wallclock 降到 1800。

## 4 · 换正式比赛的场景（种子）

> 已经换过一次（2026-09-15）：eval-a 种子 90210 → **771233**，eval-b 41207 → **330841**。下次重置只需照下面三步。

**为什么要换**：种子写在公开仓库里，任何人都能本地重建"隐藏天气"。每次正式开赛前都应换新种子。

```bash
# 第 1 步：生成新场景并直接上传到 Supabase（会覆盖同名场景）
python -m worker.main gen-scenario --slug eval-a \
  --name "Competition scenario A (hidden weather)" \
  --description "Online competition replay A: 30 nights from 2026-10-05. Weather, forecasts and events are hidden; agents see only the published snapshots." \
  --seed 999111 --days 30 --start-date 2026-10-05 --wallclock 3600 \
  --hidden-weather --hidden-forecasts

# 第 2 步：同 eval-b（--seed 换一个，--start-date 2026-11-01）

# 第 3 步：把 worker/main.py 的 DEFAULT_SCENARIOS 里对应种子同步成上面的新值，
#         git commit + push，保证仓库和线上一致
```

`--seed` 建议用 6 位数随机数（`python3 -c "import random;print(random.randint(100000,999999))"`），**只在比赛开始前才生成和推送**，不要提前公开。

## 5 · 给同事开管理员权限

Supabase 组织邀请（dashboard 手动）：https://supabase.com/dashboard/org/cosmos/team → Invite。

比赛站的管理员（能看所有队伍、重跑评测、发布公告）：

```bash
python -m worker.main promote-admin someone@example.com
```

## 6 · 学员端在哪

- **网址**：https://bh3gei.github.io/agent-observer/
- **入门包**：站点首页 → "下载入门包"，或直接分享 GitHub 仓库里的 `starter_kit/` 目录
- **说明文档**：站点"文档"页；三步上手指南在 `starter_kit/QUICKSTART_ZH.md`

## 7 · 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| 学员上传后一直 `queued` | worker 没在跑 | `gh run list` 查看；`gh workflow run worker.yml` 拉起 |
| 提交立刻 `invalid` | zip 根目录没有 `minimal_agent.py` / `agent.py` / `main.py` | 让学员按 QUICKSTART 第 3 步重新打包 |
| 练习赛场景加载慢 | `dev-reference` 有 180 个观测夜，文件较大 | 正常，首次下载后 worker 会缓存 |
| 排行榜不更新 | 前端缓存 | 强制刷新（⌘⇧R），排行榜本身读的是 `leaderboard` Edge Function，通常实时 |
| 学员说没收到确认邮件 | 邮箱进垃圾箱；或 Supabase Auth 免费额度限流 | 让学员换邮箱重试；或在 dashboard → Auth → Users 手动确认 |
