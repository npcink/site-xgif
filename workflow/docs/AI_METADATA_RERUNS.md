# AI 字段重跑

状态：工具已合入公开代码并通过离线契约测试；它仍只生成候选、对照和本地写回，不自动发布。

此流程供本地 AI 助手操作，用户只需看整体对照及处理少数例外。工具没有管理页面、HTTP 服务、定时任务或自动发布。模型在生成、审核、推荐三个环节分别配置；更换生成模型不改变 M4 的 Qwen3-VL-Embedding 2B 推荐模型。

## 字段与不可变资料

文章可选 `title,summary,tags,coverAlt`（有封面时）；图片可选 `title,description,tags,category,altText,galleryAltText,mood,scenes`。`galleryAltText` 只映射有序 `images[].altText`，不改变图片顺序、URL、尺寸及原图字节。文章目前没有独立分类字段，使用现有标签分类；不新增或重写来源类事实字段。

默认 `--fields all`；`--fields summary,tags --keep title` 可按需重跑。`--keep` 是本次明确保留的字段，不自动判断哪些历史字段出自人工。正文、标点、错字、旧标题行、来源、作者、授权、稳定 ID、日期、发布状态和推荐安全分组都不属于 AI 可写字段。

只支持集合直属、稳定 ID 命名的 `.md` 与单行 frontmatter，数组/对象使用 JSON；不隐式转存整个 YAML。多行字段等不支持格式会在调用前报错，避免破坏原文。

## 配置与试跑

复制 `.env.example` 的 `XGIF_AI_GENERATION_*` 到本机 `.env`，填写模型与接口；审核默认使用同一配置，也可用 `XGIF_AI_REVIEW_*` 配置另一个模型。不同接口不继承密钥。OpenAI 兼容接口使用 `/v1/chat/completions`；Ollama 使用本机回环根地址及 `/api/chat`，M4 可用 SSH 转发。具备图片理解能力的生成和审核模型均需设 `VISION=true`；文本模型只可运行没有图片的文章。不会悄悄替换模型。

在 `workflow/` 下执行，以下 ID 仅展示命令格式，应换为内容库中的真实 ID：

```bash
npm run ai:metadata -- plan --ids 20261113-ab12 --fields all
npm run ai:metadata -- generate --run metadata-pilot-v1 --ids 20261113-ab12 --fields all --max-calls 2
npm run ai:metadata -- export --run metadata-pilot-v1
```

`--root /绝对路径/内容仓库` 可使代码工作树读取另一份私有内容库。plan 不读取模型密钥、不调用模型、不改内容。generate 生成候选并审核，每项最多 2 次请求；默认总上限 24 次（最多 12 项），可显式改为 1–2000 次。超过 12 项必须提供匹配的 eval-lab 小样本门槛。HTTP 错误和网络超时停止整批；内容质量或格式失败只记录该项，不自动再次付费请求。

原始正文完整送入模型；单图、组图每张均读取实际字节，动态图默认均匀取 12 帧（`--frames 2–24`），按帧标注。文章封面仅在重做 `coverAlt` 时读取，配图不作为作者观点的事实依据。仅使用站点资源或台账对应、哈希核对一致的私有备份，缺图先补齐；不临时抓取任意 URL。旧外链封面若缺少可核验字节，可用 `--keep coverAlt` 保留原说明，照常重跑其他文本字段。推理图片最长边 768 px，总字节最多 24 MB，原图不修改。模型调用可能发送原文和图片到所配置接口；只有用户授权的资料才选择在线模型。

## 固定样本门槛与模型比较

`npcink-eval-lab/site-xgif-metadata/suite-v1.json` 冻结 6 条真实来源指纹，覆盖文章、单图、组图与动态图。使用同样的 6 个 ID、默认帧数和待评字段生成候选，再在 eval-lab 根目录执行：

```bash
composer eval:site-xgif-metadata -- --input /私有路径/evaluation.json --output /私有路径/gate.json
composer eval:site-xgif-metadata -- --input /私有路径/new/evaluation.json --baseline /私有路径/old/evaluation.json --output /私有路径/gate.json
```

每字段检查忠实性、核心、清晰度、自然度，各 0–2 分；忠实性和核心必须各 2 分、总分至少 7，且类型及范围校验通过。基线必须使用相同来源指纹及字段。评测是确定性契约与模型审核门槛，不是人工金标准，也不能将同模型自评当作独立证明。助手应实际查看小样本内容和图片，处理争议项；无需用户逐条编辑全部内容。

模型配置、prompt、视觉管线和字段覆盖须与 gate 一致，才能用于大于 12 项的生成。例如：

```bash
npm run ai:metadata -- generate --run metadata-batch-v1 --fields all --max-calls 400 --gate /私有路径/gate.json
```

当前固定样本没有文章封面，不能为新增 `coverAlt` 覆盖出具大批次门槛；需扩充并显式更新固定样本契约，或将该字段单独小批验证。更换模型/参数、prompt、帧数/画面处理、原文或原图时重新跑小样本。在线模型别名不能保证权重永不变化；记录所请求及响应报告的模型，若供应商提供 revision/digest，应配置 `REVISION`；不能凭别名断言可复现。

## 对照、写回、回退

每轮记录在被忽略的 `workflow/.runtime/ai-metadata/<run>/`：不可变 plan、原文快照、逐次请求占位/结果、模型与版本、来源和图片哈希、逐字段依据/评分、`comparison.md`、`preview.html`、`evaluation.json`。密钥不写入这些文件；不要把私有正文或结果提交到代码仓库。请求在发出前独占记账；相同 run 可复用成功请求，失败或中断请求不自动重放。输入、预算或配置变更要用新 run，先检查旧失败原因。

```bash
npm run ai:metadata -- apply --run metadata-pilot-v1
npm run ai:metadata -- apply --run metadata-pilot-v1 --apply
npm run ai:metadata -- rollback --run metadata-pilot-v1
npm run ai:metadata -- rollback --run metadata-pilot-v1 --apply
```

apply/rollback 默认只检查；`--apply` 只写本地 Markdown。可用 `apply --ids ...` 选择已通过项，未通过项保留旧值，由助手处理。写回前整批核验原文快照、当前文件/图片哈希和逐字段审核；只替换选中 frontmatter 行，正文原样保留。写回期间异常可能留下部分完成的批次，回执支持回退，不宣称跨文件事务。重复 apply 被拒绝。

回退只恢复本轮选中的行，保留后来新增正文与未选字段；若选中字段后来被修改则拒绝覆盖。图集回退要求整个 `images:` 行未再变化，后续换图、调尺寸/顺序或改 alt 时都须先人工合并，避免错配描述。共享锁覆盖新工具，外部编辑器及旧脚本仍应顺序操作。

## 推荐更新与发布

推荐只依据原始全文分段向量和真实图片；AI 标题、摘要、标签、分类、描述、alt、情绪及场景不进入向量、规则排序或来源指纹。只写回或回退这些字段不需要重算推荐，回执会提示核对推荐新鲜度，而不再无条件要求重建。原文、原图或模型/输入管线变化才重算对应向量；公开集合、安全分组或日期变化需要重建清单，未变向量可复用。必要时仍使用 `npm run recommendations:build -- --require-embeddings`。原文、原图不需重导入。推荐的动态图管线目前仍只分析首帧，不能把本工具的多帧描述能力视为推荐已支持多帧。边界见 [ADR-022](../../site/docs/decisions/ADR-022-original-evidence-recommendations.md)。

写回或回退后运行内容检查、核对推荐是否过期并按需构建，再运行站点测试，单独走已有内容发布 PR 流程；任何生成、apply、rollback 或 eval gate 都不会推送、合并或部署。

### 响应模型身份

请求和响应模型名称默认必须完全相同；缺少或不匹配时停止整批。经核实的供应商版本名称可显式配置 `XGIF_AI_GENERATION_REPORTED_MODEL_ALIASES=["精确版本名称"]` 和对应 `REVIEW` 配置；原生 Ollama 的 `:latest` 也不隐式放行。更换模型/接口不会继承旧别名。别名列表与身份策略进入不可变运行和评测身份，旧策略运行及旧 gate 不能直接用于写回/大批扩展。成功记录在恢复、导出和写回时复核，防止只修改回执就绕过请求核验。名称一致仍无法证明供应商实际权重，版本稳定性需供应商的 revision/digest 与服务保障。
