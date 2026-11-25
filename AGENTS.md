# XGIF 开发入口

开始工作先读 `README.md`、`site/docs/PROJECT_HANDOFF.md`、`workflow/docs/CONTENT_PUBLISHING_HANDOFF_2026-11-16.md` 和 `workflow/docs/LOCAL_PUBLISHER_ENGINEERING_STANDARD.md`。最近阶段事实与纠错见 `workflow/docs/CLOSEOUT_RETROSPECTIVE_2026-11-16.md`；历史文档的端口、后台和状态不能当作当前事实。

- Astro 静态内容 + 按需 CLI；不恢复 CMS/内容管理后台。Cloudflare Worker/D1 仅汇总主动收藏动作。
- 原文、标点、错字、来源、授权、稳定 ID、日期和原图字节不由 AI 擅自改写。短文不扩写。标题/摘要等衍生字段使用可预览、版本化、可回退流程。
- 推荐只依据原始全文与核验原图；AI 展示字段不进入向量和来源指纹。动态图推荐目前只看首帧；旧质量套件有失败与过期指纹，不宣称已全部解决。
- 图片相似只生成候选。任何追加到已有图集或合并都须用户确认具体目标，保留顺序、旧 ID/链接和恢复点。
- 已确认可在公开 GitHub 上阅读的草稿可按文件入库，保留 `draft: true`（未上线图片另设 `public: false`），不得进入生产页面、索引或公开素材目录。私密草稿、私有来源、完整台账、凭据、SQLite 和运行结果不进入公开仓库。不使用 `git add .` 或整库发布；以最新主线加选中文件核对目标快照。见 [ADR-031](site/docs/decisions/ADR-031-repository-drafts-and-production-visibility.md)。
- 工具改动运行 `workflow` 测试；站点改动运行 `site` 测试，交互/版式增加相应浏览器及 Linux 视觉验证。合并、部署和线上 SHA 分别核对。
- 生产发布必须获得用户明确授权；同意修改、测试或预览不等于同意上线。未获授权时，不合并到会触发部署的 `main`，不执行生产部署。
- 收尾先备份差异、refs 和 ignored 私有资料，再审查合并、验证线上、写文档、清理分支/worktree。不要为得到空白 Git 状态公开私有内容或丢弃用户工作。
