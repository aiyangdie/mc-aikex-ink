# 像素方块世界 (mc.aikex.ink)

开源体素沙盒：单机存档、联机房间、地狱/末地、末影龙、管理面板。

**正式试玩：** https://mc.aikex.ink/  
**GitHub Pages 预览：** https://aiyangdie.github.io/mc-aikex-ink/  
（Pages 只能托管静态页；联机自动连回 `mc.aikex.ink`。推 `main` 两边都会更新。）

## 技术栈

- 前端：Three.js ES Module（静态站点）
- 联机：Node.js + `ws`（WebSocket + `/api/rooms`）
- 部署示例：Nginx 反代 + PM2

## 目录

```
index.html / js/ / styles/   # 浏览器端
server/server.js             # 联机与管理 API
server/ecosystem.config.cjs.example
```

## 本地运行

```bash
# 1) 静态页：任意静态服务器指向仓库根目录
# 2) 联机服务
cd server
cp ecosystem.config.cjs.example ecosystem.config.cjs   # 改 MC_OWNER_KEY
npm install
node server.js
# 浏览器访问时把 /ws 与 /api 反代到 127.0.0.1:3040
```

管理面板：游戏内按 `` ` ``，用 `MC_OWNER_KEY` 登录。

## 三人协作

见 [CONTRIBUTING.md](CONTRIBUTING.md)。

简要：

1. 从 `main` 拉功能分支 `feat/xxx`
2. 开 PR，至少一人 Review
3. 合并 `main` 后 **GitHub Actions 自动部署** 到生产机（self-hosted runner）

## 安全

- **不要**把 `MC_OWNER_KEY`、GitHub PAT、`admins.json` 提交进仓库
- 生产机用 `ecosystem.config.cjs`（已 gitignore）

## License

MIT — 见 [LICENSE](LICENSE)


## AK / 法师联机对战

### 房主管理员

- 创建房间的人自动成为该房间的「房主管理员」，进入游戏后按 `` ` `` 打开管理面板，不需要输入站长密钥。
- 房主可以刷新当前房间玩家列表，对目标玩家锁定 1 秒/5 秒、恢复满血、赠送当前道具，并批量刷出 1–8 个已登记实体。
- 所有房间管理指令都由服务端二次校验：只有当前房主能管理本房，锁定状态由服务端强制执行，房主离开后权限自动转移给下一位玩家。
- 站长密钥和全局管理员仍只用于站点级目录/权限管理，不会因为昵称相同而自动获得权限。

- 按 **Q**（手机点「切换职业」）装备 AK，再按 Q 切换法师，之后 Q 在 AK/法师间切换。**B** 或「建造」恢复挖掘、建造。AK 按住左键或「开火」连射。
- 法师左键/「火球术」发射火球，约 0.95 秒一次；落点半径 2.5 格，爆发伤害 6，之后每 0.5 秒伤害 2，地面火焰持续 **5 秒**。只伤害同维度其他玩家，不伤施法者；射向空中未碰到地形则消散。
- 全职业 **Z** 或「闪现」沿视线瞬移约 7.5 格（贴地、遇墙停），冷却 **3.2 秒**；Shift 仅冲刺。火球/闪现冷却与校验由服务器控制。
- 生命值 20；每发伤害 5；射程 80 格；无限弹药。自己与远端玩家均显示血条。
- 同房间、同维度玩家可以互射，射线只伤害最近玩家；正常客户端的方块遮挡会截断射线。
- 阵亡后禁止移动/开火/建造，3 秒后在**当前维度**出生区域附近满血随机重生，落下时有短暂无摔伤保护；服务器提供 2 秒枪击保护。
- 猎杀动物掉**肉+金币**；肉会自动选中，按 **F** 吃回血。HUD 显示金币库存。
- 手机端目前以摇杆+拆放为主，完整战斗键位建议用桌面键盘（Q/Z/B）。
- 提供第一人称方块 AK、后坐力、联机弹道与受伤闪屏。未引入新物品 ID。
- 已知限制：联机维度传送后方块差分尚未按维度隔离；跨维度生物同步仍会互相可见。

### 本地运行与验证

在 server 目录运行 npm ci，然后 npm run dev，浏览器打开 http://127.0.0.1:3040 。开发模式同时提供静态页与 WebSocket；生产 npm start 的静态资源配置保持不变。

运行 npm test 检查伤害、射速、最近命中、死亡、重生、保护、遮挡距离、跨维度隔离及无效输入。启动本地服务后，npm run test:online 用两个真实 WebSocket 客户端测试完整击杀/重生、火球/持续燃烧/5 秒消失、快照与闪现冷却流程。

手动验证：两个浏览器加入同一房间，分别按 Q，瞄准对方连射；检查双方血条、3 秒倒计时、满血重生；再测试隔墙射击、切换维度、暂停时松开鼠标、手机开火按钮。

### 联机协议与边界

新增客户端消息 shoot（direction、distance）和 vitals（本地环境伤害/食物回血 delta）；新增服务器广播 shot（弹道）和 combat（hp、deadUntil、respawn 等）。joined/sync 附带 self，玩家快照与 move 附带生命值和 dimension。前后端需一起更新。

服务器控制 PvP 伤害、射速、最近玩家命中、死亡与重生。地形遮挡距离、玩家移动和环境生命值变化仍来自客户端；这不是完整的反作弊系统，修改客户端可以伪造这些数据。服务器尚未模拟体素地形或验证食物消耗。

鼠标锁定兼容：若浏览器拒绝 Pointer Lock，自动使用 WASD 移动、按住右键拖动视角、左键攻击的兼容模式；右键单击仍可放置，Esc 暂停，失焦清空按键。内置浏览器已实测移动、AK 显示、暂停和继续。


## 迷雾档案 Boss

- 原主人公 GLB 和骨骼直接移植，1500 HP，保留目前人物朝向；走近追击，每刀 5 点伤害，可近战或 AK 攻击。
- 单机保存 Boss 剩余血量/击败状态；联机每房间共享一个 Boss，服务器决定追击、命中和血量。击败后重进房间不会重新刷满，新房间生成新 Boss。
- 被 Boss 击败后显示死亡页，点击「重新站起来」满血复活并获 3 秒保护。原 PvP 枪击阵亡的自动随机复活逻辑保持独立。
- 简单地面追踪支持一步台阶、墙体和悬崖检测，不是完整迷宫寻路。联机 Boss 的碰撞读取真实体素与房间编辑，但原玩家移动、背包和 PvP 协议仍非完整反作弊。
- 模型授权来源说明见 `assets/models/README.md`；Three.js 固定版本随仓库提供，浏览器不依赖外部 CDN。

验证：根目录 `npm ci --ignore-scripts`、`npm test`；`npm ci --prefix server`、`npm test --prefix server`。
联调：启动 `node server/server.js` 后运行根目录 `npm run dev`，打开 `http://127.0.0.1:8086`。
浏览器回归：上述两个本地服务启动后运行 `node scripts/verify-boss-browser.mjs`（需要 Playwright Chromium）；截图存 `docs/verification/`。

法师协议：mode 切换 build/ak/mage；fireball 上报 end 与 ground，服务器广播带 impact 的飞行事件，落地广播带 expires 的 fire；blink 上报 to，接受后广播 combat(teleport=true)。joined/sync 的 spells 包含尚未到期的火球/火区。与原有地形验证边界一致，火球落点与闪现路径碰撞来自客户端；服务端限制距离、职业、生命状态与冷却，尚不独立验证体素遮挡。
