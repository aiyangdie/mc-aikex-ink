
## 2026-09-22 迷雾档案 Boss
- 用户要求：原骨骼人物直接移植、1500 HP、追击挥砍、联机共享 Boss、push/合并/部署。
- 最后明确约束：人物朝向保持当前 -Math.PI/2，不再调整。
- 功能分支 feat/mist-archives-boss，已兼容 main 9cb114d 的 AK、物理弹道、随机 PvP 复活。
- Boss 每刀5伤害，玩家20HP；Boss死亡持久化；被Boss击杀手动复活并保护3秒，PvP自动复活独立。
- 模型归一化必须先 group.updateMatrixWorld(true)，更新 SkinnedMesh 的 bindMatrixInverse，不能只 updateWorldMatrix；回归测试重算 skinned bounding boxes，避免缓存掩盖模型沉地。
- 浏览器本地实测模型显示、1500→1485枪击、Boss致死和复活20HP；控制台无错误。两个真实WebSocket验证共享血量/死亡/保护；原PvP smoke通过。
- Review发现无cause的零HP vitals可能困住PvP自动复活，已按cause限制为Boss并加红绿回归。
- 部署路径：PR→另一人Approve→main→GitHub Actions Deploy production（self-hosted mc-prod）；不绕过仓库协作约定。生产机IP未知，不猜SSH、不操作其他生产服务。
- 本条记录时尚未push/合并/部署，后续以GitHub状态为准。
