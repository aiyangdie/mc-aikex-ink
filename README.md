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

- 按 **Q**（手机点「切换职业」）装备 AK，再按 Q 切换法师，之后 Q 在 AK/法师间切换。**B** 或「建造」恢复挖掘、建造。AK 按住左键或「开火」连射。
- 法师左键/「火球术」发射火球，约 0.95 秒一次；落点半径 2.5 格，爆发伤害 6，之后每 0.5 秒伤害 2，地面火焰持续 **5 秒**。只伤害同维度其他玩家，不伤施法者；射向空中未碰到地形则消散。
- 全职业 **Z** 或「闪现」沿视线瞬移约 7.5 格（贴地、遇墙停），冷却 **3.2 秒**；Shift 仅冲刺。火球/闪现冷却与校验由服务器控制。
- 生命值 20；每发伤害 5；射程 80 格；无限弹药。自己与远端玩家均显示血条。
- 同房间、同维度玩家可以互射，射线只伤害最近玩家；正常客户端的方块遮挡会截断射线。
- 阵亡后禁止移动/开火/建造，3 秒后在主世界出生区域上方满血重生，落下时有短暂无摔伤保护；服务器提供 2 秒枪击保护。
- 提供第一人称方块 AK、后坐力、联机弹道与受伤闪屏。未引入新物品 ID。

### 本地运行与验证

在 server 目录运行 npm ci，然后 npm run dev，浏览器打开 http://127.0.0.1:3040 。开发模式同时提供静态页与 WebSocket；生产 npm start 的静态资源配置保持不变。

运行 npm test 检查伤害、射速、最近命中、死亡、重生、保护、遮挡距离、跨维度隔离及无效输入。启动本地服务后，npm run test:online 用两个真实 WebSocket 客户端测试完整击杀/重生、火球/持续燃烧/5 秒消失、快照与闪现冷却流程。

手动验证：两个浏览器加入同一房间，分别按 Q，瞄准对方连射；检查双方血条、3 秒倒计时、满血重生；再测试隔墙射击、切换维度、暂停时松开鼠标、手机开火按钮。

### 联机协议与边界

新增客户端消息 shoot（direction、distance）和 vitals（本地环境伤害/食物回血 delta）；新增服务器广播 shot（弹道）和 combat（hp、deadUntil、respawn 等）。joined/sync 附带 self，玩家快照与 move 附带生命值和 dimension。前后端需一起更新。

服务器控制 PvP 伤害、射速、最近玩家命中、死亡与重生。地形遮挡距离、玩家移动和环境生命值变化仍来自客户端；这不是完整的反作弊系统，修改客户端可以伪造这些数据。服务器尚未模拟体素地形或验证食物消耗。

鼠标锁定兼容：若浏览器拒绝 Pointer Lock，自动使用 WASD 移动、按住右键拖动视角、左键攻击的兼容模式；右键单击仍可放置，Esc 暂停，失焦清空按键。内置浏览器已实测移动、AK 显示、暂停和继续。

法师协议：mode 切换 build/ak/mage；fireball 上报 end 与 ground，服务器广播带 impact 的飞行事件，落地广播带 expires 的 fire；blink 上报 to，接受后广播 combat(teleport=true)。joined/sync 的 spells 包含尚未到期的火球/火区。与原有地形验证边界一致，火球落点与闪现路径碰撞来自客户端；服务端限制距离、职业、生命状态与冷却，尚不独立验证体素遮挡。
