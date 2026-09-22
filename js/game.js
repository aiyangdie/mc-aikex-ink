/**
 * 像素方块世界 - 游戏主模块
 * 包含：玩家控制、物理系统、射线检测、游戏循环
 */

import * as THREE from 'three';
import {
  World, Chunk, BlockType, BlockNames, isSolid, Dim,
  CHUNK_SIZE, CHUNK_HEIGHT, RENDER_DISTANCE, getBlockColor, getBreakDrop,
  isMobileDevice, getRenderDistance,
} from './voxel.js?v=lobby10';
import { AnimalManager } from './animals.js?v=lobby10';
import { SaveManager } from './save.js?v=lobby10';
import { NetClient, RemotePlayers } from './net.js?v=lobby10';
import { Inventory } from './inventory.js?v=lobby10';
import { isFood, isItem, getItemName, getItemColor, getFoodHeal } from './items.js?v=lobby10';
import { tryLightPortal, standingInPortal, spawnReturnPortal } from './portals.js?v=lobby10';
import { MistBoss } from './mist-boss.js';
import { findStandY } from './boss-navigation.mjs';
import { EnderDragon } from './dragon.js?v=lobby10';
import { AdminPanel } from './admin-panel.js?v=lobby10';
import { buildStructure } from './structures.js?v=lobby10';

/* ============================================
   玩家类 - 第一人称角色控制
   ============================================ */
class Player {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;

    // 位置与速度
    this.position = new THREE.Vector3(5.4, -27.0, 22.6);
    this.velocity = new THREE.Vector3(0, 0, 0);

    // 视角旋转（欧拉角）
    this.pitch = 0;   // 上下俯仰
    this.yaw = 0;     // 左右偏航

    // 物理参数
    this.gravity = -25;
    this.jumpSpeed = 12;
    this.moveSpeed = 5.5;
    this.onGround = false;

    // 玩家碰撞体尺寸
    this.width = 0.6;
    this.height = 1.75;
    this.eyeHeight = 1.6;

    // 输入状态
    this.keys = {};
    this.mouseDX = 0;
    this.mouseDY = 0;

    // 交互参数
    this.reachDistance = 7;
    this.selectedBlock = BlockType.GRASS;

    // 射线检测结果缓存
    this.targetBlock = null;
    this.targetFace = null;
    this.targetMob = null;

    // 生存
    this.hp = 20;
    this.maxHp = 20;
    this.attackCooldown = 0;
    this.invuln = 0;
    this._wasOnGround = true;
    this._fallVy = 0;
    this.adminFly = false;
  }

  /** 处理鼠标移动（视角旋转） */
  onMouseMove(dx, dy) {
    const sensitivity = 0.002;
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    // 限制俯仰角范围
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
  }

  /** 每帧更新：物理、碰撞、视角 */
  update(dt) {
    // 限制最大帧间隔，防止穿墙
    dt = Math.min(dt, 0.05);
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.invuln > 0) this.invuln -= dt;

    // 计算移动方向（基于视角）
    const forward = new THREE.Vector3(
      -Math.sin(this.yaw),
      0,
      -Math.cos(this.yaw)
    ).normalize();

    const right = new THREE.Vector3(
      Math.cos(this.yaw),
      0,
      -Math.sin(this.yaw)
    ).normalize();

    // 根据输入计算目标速度
    const moveDir = new THREE.Vector3(0, 0, 0);
    if (this.keys['KeyW'] || this.keys['ArrowUp']) moveDir.add(forward);
    if (this.keys['KeyS'] || this.keys['ArrowDown']) moveDir.sub(forward);
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) moveDir.sub(right);
    if (this.keys['KeyD'] || this.keys['ArrowRight']) moveDir.add(right);

    if (moveDir.lengthSq() > 0) {
      moveDir.normalize();
    }

    // 水平移动
    this.velocity.x = moveDir.x * this.moveSpeed * (this.adminFly ? 1.8 : 1);
    this.velocity.z = moveDir.z * this.moveSpeed * (this.adminFly ? 1.8 : 1);

    // 管理飞行：空格上升，Shift 下降，无重力
    if (this.adminFly) {
      this.velocity.y = 0;
      if (this.keys['Space'] || this.keys['KeyK']) this.velocity.y = 8;
      if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) this.velocity.y = -8;
      this.position.x += this.velocity.x * dt;
      this.position.y += this.velocity.y * dt;
      this.position.z += this.velocity.z * dt;
      this.onGround = false;
      this.camera.position.set(
        this.position.x,
        this.position.y + this.eyeHeight,
        this.position.z
      );
      const lookDir = new THREE.Vector3(
        -Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        -Math.cos(this.yaw) * Math.cos(this.pitch)
      );
      this.camera.lookAt(
        this.camera.position.x + lookDir.x,
        this.camera.position.y + lookDir.y,
        this.camera.position.z + lookDir.z
      );
      this._raycast();
      return;
    }

    // === 水物理检测 ===
    const footBlock = this.world.getBlock(
      Math.floor(this.position.x),
      Math.floor(this.position.y),
      Math.floor(this.position.z)
    );
    const eyeBlock = this.world.getBlock(
      Math.floor(this.position.x),
      Math.floor(this.position.y + this.eyeHeight),
      Math.floor(this.position.z)
    );
    const inWater = (footBlock === BlockType.WATER || eyeBlock === BlockType.WATER);

    // 重力：水中大幅降低
    const effectiveGravity = inWater ? this.gravity * 0.15 : this.gravity;
    this.velocity.y += effectiveGravity * dt;

    // 水中游泳：按住空格上浮
    if (inWater && (this.keys['Space'] || this.keys['KeyK'])) {
      this.velocity.y = 3;
      this.onGround = false;
    }

    // 跳跃（仅在地面且不在水中）
    if (!inWater && (this.keys['Space'] || this.keys['KeyK']) && this.onGround) {
      this.velocity.y = this.jumpSpeed;
      this.onGround = false;
    }

    // 水中移动减速
    if (inWater) {
      this.velocity.x *= 0.5;
      this.velocity.z *= 0.5;
    }

    // 逐轴移动并进行碰撞检测
    this.onGround = false;

    // X轴
    this.position.x += this.velocity.x * dt;
    this._resolveCollision('x');

    // Y轴
    this.position.y += this.velocity.y * dt;
    this._resolveCollision('y');

    // Z轴
    this.position.z += this.velocity.z * dt;
    this._resolveCollision('z');

    // 防止掉出世界
    if (this.position.y < -10) {
      this.position.y = 50;
      this.velocity.y = 0;
    }

    // 摔落伤害（落地瞬间）
    if (!this._wasOnGround && this.onGround && !inWater) {
      const dmg = Math.floor((-this._fallVy - 12) / 2);
      if (dmg > 0 && this.invuln <= 0) {
        this.hp = Math.max(0, this.hp - dmg);
        this.invuln = 0.6;
      }
    }
    this._wasOnGround = this.onGround;
    if (!this.onGround) this._fallVy = this.velocity.y;
    else this._fallVy = 0;

    // 更新相机
    this.camera.position.set(
      this.position.x,
      this.position.y + this.eyeHeight,
      this.position.z
    );

    // 更新相机朝向
    const lookDir = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    this.camera.lookAt(
      this.camera.position.x + lookDir.x,
      this.camera.position.y + lookDir.y,
      this.camera.position.z + lookDir.z
    );

    // 射线检测（目标方块）
    this._raycast();
  }

  /**
   * AABB 碰撞检测与解决
   * 沿指定轴检测碰撞并推出
   */
  _resolveCollision(axis) {
    const halfW = this.width / 2;
    const min = new THREE.Vector3(
      this.position.x - halfW,
      this.position.y,
      this.position.z - halfW
    );
    const max = new THREE.Vector3(
      this.position.x + halfW,
      this.position.y + this.height,
      this.position.z + halfW
    );

    // 检测范围内所有可能的方块
    const startX = Math.floor(min.x);
    const endX = Math.floor(max.x);
    const startY = Math.floor(min.y);
    const endY = Math.floor(max.y);
    const startZ = Math.floor(min.z);
    const endZ = Math.floor(max.z);

    for (let bx = startX; bx <= endX; bx++) {
      for (let by = startY; by <= endY; by++) {
        for (let bz = startZ; bz <= endZ; bz++) {
          const blockType = this.world.getBlock(bx, by, bz);
          if (blockType === BlockType.AIR) continue;

          const isWater = blockType === BlockType.WATER;

          // 水方块特殊处理：仅在Y轴下落时充当"地面"
          if (isWater) {
            if (axis !== 'y' || this.velocity.y >= 0) continue;
            // 只有下落接触水面才阻挡
            const blockMinW = { x: bx, y: by, z: bz };
            const blockMaxW = { x: bx + 1, y: by + 1, z: bz + 1 };
            if (min.x < blockMaxW.x && max.x > blockMinW.x &&
                min.y < blockMaxW.y && max.y > blockMinW.y &&
                min.z < blockMaxW.z && max.z > blockMinW.z) {
              this.position.y = blockMaxW.y;
              this.velocity.y = 0;
              this.onGround = true;
              min.y = this.position.y;
              max.y = this.position.y + this.height;
            }
            continue;
          }

          // 固体方块的 AABB
          const blockMin = { x: bx, y: by, z: bz };
          const blockMax = { x: bx + 1, y: by + 1, z: bz + 1 };

          // 检测 AABB 重叠
          if (min.x < blockMax.x && max.x > blockMin.x &&
              min.y < blockMax.y && max.y > blockMin.y &&
              min.z < blockMax.z && max.z > blockMin.z) {

            // 沿指定轴推出
            if (axis === 'x') {
              if (this.velocity.x > 0) {
                this.position.x = blockMin.x - halfW;
              } else {
                this.position.x = blockMax.x + halfW;
              }
              this.velocity.x = 0;
            } else if (axis === 'y') {
              if (this.velocity.y > 0) {
                this.position.y = blockMin.y - this.height;
              } else {
                this.position.y = blockMax.y;
                this.onGround = true;
              }
              this.velocity.y = 0;
            } else if (axis === 'z') {
              if (this.velocity.z > 0) {
                this.position.z = blockMin.z - halfW;
              } else {
                this.position.z = blockMax.z + halfW;
              }
              this.velocity.z = 0;
            }

            // 更新碰撞体范围
            min.x = this.position.x - halfW;
            max.x = this.position.x + halfW;
            min.y = this.position.y;
            max.y = this.position.y + this.height;
            min.z = this.position.z - halfW;
            max.z = this.position.z + halfW;
          }
        }
      }
    }
  }

  /**
   * DDA 射线检测算法
   * 从相机位置沿视线方向步进，找到第一个实体方块
   */
  _raycast() {
    const origin = this.camera.position.clone();
    const direction = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();

    this.targetBlock = null;
    this.targetFace = null;
    this.targetMob = null;

    // DDA 参数
    const step = 0.05;
    const maxSteps = this.reachDistance / step;
    let prevX = Math.floor(origin.x);
    let prevY = Math.floor(origin.y);
    let prevZ = Math.floor(origin.z);

    for (let i = 0; i < maxSteps; i++) {
      const t = i * step;
      const x = Math.floor(origin.x + direction.x * t);
      const y = Math.floor(origin.y + direction.y * t);
      const z = Math.floor(origin.z + direction.z * t);

      // 跳过相同方块
      if (x === prevX && y === prevY && z === prevZ) continue;

      const block = this.world.getBlock(x, y, z);
      if (isSolid(block)) {
        this.targetBlock = { x, y, z, type: block };

        // 计算命中面的法线（上一步与当前步的差值）
        this.targetFace = {
          x: prevX - x,
          y: prevY - y,
          z: prevZ - z,
        };
        return;
      }

      prevX = x;
      prevY = y;
      prevZ = z;
    }
  }

  /** 放置方块 */
  placeBlock() {
    if (!this.targetBlock || !this.targetFace) return false;
    if (!this.selectedBlock || this.selectedBlock === BlockType.AIR) return false;
    if (!this.selectedBlock || this.selectedBlock === BlockType.AIR) return false;

    const px = this.targetBlock.x + this.targetFace.x;
    const py = this.targetBlock.y + this.targetFace.y;
    const pz = this.targetBlock.z + this.targetFace.z;

    // 检查新方块是否与玩家碰撞
    const halfW = this.width / 2;
    const playerMin = {
      x: this.position.x - halfW, y: this.position.y, z: this.position.z - halfW
    };
    const playerMax = {
      x: this.position.x + halfW, y: this.position.y + this.height, z: this.position.z + halfW
    };

    if (px + 1 > playerMin.x && px < playerMax.x &&
        py + 1 > playerMin.y && py < playerMax.y &&
        pz + 1 > playerMin.z && pz < playerMax.z) {
      return false; // 不能在玩家位置放置
    }

    if (py < 0 || py >= CHUNK_HEIGHT) return false;
    if (this.world.getBlock(px, py, pz) !== BlockType.AIR) return false;

    this.world.setBlock(px, py, pz, this.selectedBlock);
    return true;
  }

  /** 破坏方块，返回被破坏的类型（失败 false） */
  breakBlock() {
    if (!this.targetBlock) return false;

    const { x, y, z, type } = this.targetBlock;
    if (y < 0 || y >= CHUNK_HEIGHT) return false;

    this.world.setBlock(x, y, z, BlockType.AIR);
    return type || true;
  }
}

/* ============================================
   高亮方块线框
   ============================================ */
class BlockHighlight {
  constructor(scene) {
    const geo = new THREE.BoxGeometry(1.005, 1.005, 1.005);
    const edges = new THREE.EdgesGeometry(geo);
    const mat = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2, transparent: true, opacity: 0.6 });
    this.mesh = new THREE.LineSegments(edges, mat);
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(targetBlock) {
    if (targetBlock) {
      this.mesh.position.set(targetBlock.x + 0.5, targetBlock.y + 0.5, targetBlock.z + 0.5);
      this.mesh.visible = true;
    } else {
      this.mesh.visible = false;
    }
  }
}

/* ============================================
   触摸控制器（移动端专用）
   ============================================ */
class TouchController {
  constructor(player, game) {
    this.player = player;
    this.game = game;
    this.moveX = 0;    // -1 ~ 1 左右
    this.moveZ = 0;    // -1 ~ 1 前后
    this._joystickId = null;
    this._lookTouchId = null;
    this._lastTouchX = 0;
    this._lastTouchY = 0;
    this._init();
  }

  _init() {
    const zone = document.getElementById('joystickZone');
    const thumb = document.getElementById('joystickThumb');
    const canvas = this.game.canvas;

    // 用 pointerId 区分摇杆触点和视角触点，支持多点同时操作
    this._joystickId = null;
    this._lookTouchId = null;

    // ----- 虚拟摇杆 -----
    const findJoystickTouch = (e) => {
      if (this._joystickId === null) return null;
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === this._joystickId) return e.touches[i];
      }
      return null;
    };

    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this._joystickId === null) {
        this._joystickId = e.changedTouches[0].identifier;
      }
      const t = findJoystickTouch(e);
      if (t) this._updateJoystick(t, zone, thumb);
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = findJoystickTouch(e);
      if (t) this._updateJoystick(t, zone, thumb);
    }, { passive: false });
    zone.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (this._joystickId === e.changedTouches[0].identifier) {
        this._joystickId = null;
      }
      this.moveX = 0;
      this.moveZ = 0;
      thumb.style.transform = 'translate(-50%, -50%)';
    });
    zone.addEventListener('touchcancel', (e) => {
      if (this._joystickId === e.changedTouches[0].identifier) {
        this._joystickId = null;
      }
      this.moveX = 0;
      this.moveZ = 0;
      thumb.style.transform = 'translate(-50%, -50%)';
    });

    // ----- 视角控制（右侧区域） -----
    // 找一个非摇杆触点用于视角
    const findLookTouch = (e) => {
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        if (t.identifier !== this._joystickId && t.clientX > window.innerWidth * 0.35) {
          return t;
        }
      }
      return null;
    };

    canvas.addEventListener('touchstart', (e) => {
      // 只在有新触点落在右侧区域时开启视角（排除UI按钮区域）
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        // 跳过落在操作按钮区域的触摸
        if (t.target && t.target.closest && t.target.closest('#actionButtons, #joystickZone, #mobileHotbar')) continue;
        if (t.identifier !== this._joystickId && t.clientX > window.innerWidth * 0.35) {
          this._lookTouchId = t.identifier;
          this._lastTouchX = t.clientX;
          this._lastTouchY = t.clientY;
          break;
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      if (this._lookTouchId === null) return;
      // 在全部触点中找到我们的视角触点
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        if (t.identifier === this._lookTouchId) {
          const dx = t.clientX - this._lastTouchX;
          const dy = t.clientY - this._lastTouchY;
          this.player.onMouseMove(dx * 1.8, dy * 1.8);
          this._lastTouchX = t.clientX;
          this._lastTouchY = t.clientY;
          break;
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this._lookTouchId) {
          this._lookTouchId = null;
          break;
        }
      }
    });
    canvas.addEventListener('touchcancel', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this._lookTouchId) {
          this._lookTouchId = null;
          break;
        }
      }
    });

    // ----- 操作按钮 -----
    const btnJump = document.getElementById('btnJump');
    const btnPlace = document.getElementById('btnPlace');
    const btnBreak = document.getElementById('btnBreak');

    // 按钮按下时的视觉反馈
    const _flashBtn = (btn, isError) => {
      if (!btn) return;
      const bg = isError ? 'rgba(255, 80, 80, 0.4)' : 'rgba(255, 255, 255, 0.35)';
      const border = isError ? 'rgba(255, 80, 80, 0.7)' : 'rgba(255, 255, 255, 0.6)';
      btn.style.background = bg;
      btn.style.borderColor = border;
      btn.style.transition = 'background 0.1s, border-color 0.1s';
      setTimeout(() => {
        btn.style.background = 'rgba(255, 255, 255, 0.12)';
        btn.style.borderColor = 'rgba(255, 255, 255, 0.25)';
      }, 150);
    };

    // 触觉反馈（设备支持时）
    const _haptic = (pattern) => {
      if (navigator.vibrate) {
        navigator.vibrate(pattern);
      }
    };

    if (btnJump) {
      const _jumpDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.player.keys['Space'] = true;
        _flashBtn(btnJump);
      };
      const _jumpUp = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.player.keys['Space'] = false;
      };
      btnJump.addEventListener('pointerdown', _jumpDown);
      btnJump.addEventListener('pointerup', _jumpUp);
      btnJump.addEventListener('pointercancel', _jumpUp);
      btnJump.addEventListener('pointerleave', _jumpUp);
    }

    if (btnPlace) {
      const _placeDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.game._secondaryAction();
        _flashBtn(btnPlace);
      };
      btnPlace.addEventListener('pointerdown', _placeDown);
    }

    if (btnBreak) {
      const _breakDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.game._primaryAction();
        _flashBtn(btnBreak);
        _haptic(15);
      };
      btnBreak.addEventListener('pointerdown', _breakDown);
    }
  }

  _updateJoystick(touch, zone, thumb) {
    const rect = zone.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width / 2 - 25;

    let dx = touch.clientX - cx;
    let dy = touch.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > maxR) {
      dx = dx / dist * maxR;
      dy = dy / dist * maxR;
    }

    this.moveX = dx / maxR;
    this.moveZ = dy / maxR;

    thumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
}

/* ============================================
   游戏主类
   ============================================ */
export class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.isRunning = false;
    this.isPointerLocked = false;

    // 设备检测
    this.isMobile = isMobileDevice();
    this.renderDistance = getRenderDistance();

    // Three.js 核心对象
    this.scene = null;
    this.camera = null;
    this.renderer = null;

    // 游戏对象
    this.world = null;
    this.player = null;
    this.highlight = null;
    this.touchController = null;
    this.animalManager = null;

    // 帧率统计
    this.clock = new THREE.Clock();
    this.frameCount = 0;
    this.fpsTime = 0;
    this.fps = 0;

    // UI 元素
    this.ui = {
      crosshair: document.getElementById('crosshair'),
      hotbar: document.getElementById('hotbar'),
      selectedBlockName: document.getElementById('selectedBlockName'),
      debugInfo: document.getElementById('debugInfo'),
      blockHighlight: document.getElementById('blockHighlight'),
      startScreen: document.getElementById('startScreen'),
      pauseScreen: document.getElementById('pauseScreen'),
      loadingBar: document.getElementById('loadingBar'),
      loadingFill: document.getElementById('loadingFill'),
      controlsPanel: document.getElementById('controlsPanel'),
    };

    // 生存背包（9 格热栏）
    this.inventory = new Inventory(9);
    this.inventory.giveStarter();
    this.selectedSlot = 0;

    // 存档
    this._saveData = null;       // 启动时读到的存档
    this._dirtySinceSave = false;
    this._autosaveTimer = null;

    // 联机
    this.net = null;
    this.remotes = null;
    this._netApplying = false;
    this._online = false;
    this._hostWaiting = false; // 已建房、仍在大厅等待
    this._pendingJoinMsg = null;
    this._roomPollTimer = null;

    // 维度：主世界 / 地狱 / 末地
    this.dimension = Dim.OVERWORLD;
    this._dimEdits = {
      [Dim.OVERWORLD]: new Map(),
      [Dim.NETHER]: new Map(),
      [Dim.END]: new Map(),
    };
    this._portalTimer = 0;
    this._dragon = null;
    this._dragonKilled = false;
    this._mistBoss = null;
    this._mistBossState = null;
    this._dead = false;
    this._lastDamageBy = '';
    this._netBossState = null;
  }

  /** 初始化游戏 */
  async init() {
    this._initRenderer();
    this._initScene();
    this._initPlayer();
    this._initHighlight();
    this._initHotbar();
    if (this.isMobile) this._initMobileHotbar();
    this._initEvents();
    this._initSaveUI();

    // 联机客户端必须先于按钮绑定创建，避免点建房时 net 为空
    this.net = new NetClient();
    this.remotes = new RemotePlayers(this.scene, THREE);
    this._bindNet();
    this._initOnlineUI();

    this.adminPanel = new AdminPanel(this);
    this.adminPanel.tryAutoLogin();
    this._playerName = () => {
      const el = document.getElementById('playerNameInput');
      return (el?.value || '玩家').trim().slice(0, 12) || '玩家';
    };

    // 读档：先灌差分，再生成区块（背景预览即是存档世界）
    this._saveData = SaveManager.load();
    if (this._saveData) {
      this._mistBossState = this._saveData.mistBoss || null;
      this.world.edits = SaveManager.arrayToEdits(this._saveData.edits);
      if (Array.isArray(this._saveData.inventory)) {
        this.inventory.fromJSON(this._saveData.inventory);
      } else {
        this.inventory.giveStarter();
      }
      if (typeof this._saveData.hp === 'number') {
        this.player.hp = Math.max(0, Math.min(20, this._saveData.hp));
      }
      if (typeof this._saveData.selectedSlot === 'number') {
        this.selectedSlot = Math.max(0, Math.min(8, this._saveData.selectedSlot));
      }
      this._updateHotbar();
    }
    this._refreshStartUI();
    this._ensureHud();

    // 设置预览视角：近距离平视"Coze"立墙
    this.camera.position.set(0, 23, 12);
    this.camera.lookAt(0, 25, 0);

    // 开始界面保持显示，背后渲染 3D 世界
    this.ui.loadingBar.style.display = 'block';

    const radius = this.renderDistance;

    // 按离世界中心距离排序，优先加载"Coze"立墙区域
    const chunksToLoad = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        chunksToLoad.push([dx, dz]);
      }
    }
    chunksToLoad.sort((a, b) => {
      const dA = a[0] * a[0] + a[1] * a[1];
      const dB = b[0] * b[0] + b[1] * b[1];
      return dA - dB;
    });

    const needed = chunksToLoad.length;
    let generated = 0;
    let firstFrameDone = false;

    for (const [cx, cz] of chunksToLoad) {
      const key = this.world.chunkKey(cx, cz);
      if (!this.world.chunks.has(key)) {
        const chunk = await this._createChunk(cx, cz);
        if (chunk.mesh) this.scene.add(chunk.mesh);
        if (chunk.waterMesh) this.scene.add(chunk.waterMesh);
        generated++;
        this.ui.loadingFill.style.width = `${(generated / needed * 100) | 0}%`;

        // 中心区块加载完毕后立即渲染首帧（确保"Coze"立墙可见）
        if (!firstFrameDone && cx * cx + cz * cz <= 4) {
          this.renderer.render(this.scene, this.camera);
          firstFrameDone = true;
        }

        this.renderer.render(this.scene, this.camera);
        if (generated % (this.isMobile ? 1 : 3) === 0) {
          await new Promise(r => setTimeout(r, 0));
        }
      }
    }

    // 出生点：有存档则用存档坐标，否则默认
    if (this._saveData && this._saveData.player) {
      const p = this._saveData.player;
      this._spawnX = p.x;
      this._spawnY = p.y;
      this._spawnZ = p.z;
      this.player.position.set(p.x, p.y, p.z);
      this.player.yaw = p.yaw || 0;
      this.player.pitch = typeof p.pitch === 'number' ? p.pitch : -0.3;
    } else {
      this._spawnX = 5.4;
      this._spawnZ = 22.6;
      this._spawnY = -27.0;
      this.player.position.set(this._spawnX, this._spawnY, this._spawnZ);
      this.player.yaw = 0;
      this.player.pitch = -0.3;
    }

    // 相机保持立墙预览视角，等用户点击开始后再切到玩家视角

    this.ui.loadingBar.style.display = 'none';

    // 出生点旁：现成点燃的地狱门（去打龙）
    this._ensureStarterPortal();

    // 在世界中生成小机器人（联机进房后会被服务端 mobs 覆盖）
    this.animalManager.spawnCenter.set(this.player.position.x, 0, this.player.position.z);
    this.animalManager.spawnAnimals(this.dimension);
    this._ensureHud();
    this._updateHotbar();
  }

  /** 主世界出生点旁生成已点燃地狱门 */
  _ensureStarterPortal() {
    if (this.dimension !== Dim.OVERWORLD) return;
    for (const t of this.world.edits.values()) {
      if (t === BlockType.PORTAL) return; // 已有门
    }
    // 门框底边贴在沙地 y=18，面向玩家出生点附近
    const portal = spawnReturnPortal(this.world, 12, World.TEXT_GROUND_Y || 18, 18, 'x');
    // 重筑受影响区块
    for (let cx = 0; cx <= 1; cx++) {
      for (let cz = 1; cz <= 2; cz++) {
        this._rebuildChunkAt(cx, cz);
      }
    }
    this._starterPortalPos = portal;
  }

  _rebuildChunkAt(cx, cz) {
    const key = this.world.chunkKey(cx, cz);
    let chunk = this.world.chunks.get(key);
    if (!chunk) {
      chunk = this._createChunk(cx, cz);
      if (chunk.mesh) this.scene.add(chunk.mesh);
      if (chunk.waterMesh) this.scene.add(chunk.waterMesh);
      return;
    }
    if (chunk.mesh) this.scene.remove(chunk.mesh);
    if (chunk.waterMesh) this.scene.remove(chunk.waterMesh);
    this.world.generateChunkData(chunk);
    this.world.applyEdits(chunk);
    chunk.buildMesh(
      (wx, wy, wz) => this.world.getBlock(wx, wy, wz),
      this.world.material,
      this.world.waterMaterial
    );
    if (chunk.mesh) this.scene.add(chunk.mesh);
    if (chunk.waterMesh) this.scene.add(chunk.waterMesh);
  }

  /** 创建区块 */
  _createChunk(cx, cz) {
    const key = this.world.chunkKey(cx, cz);
    if (this.world.chunks.has(key)) return this.world.chunks.get(key);

    const chunk = new Chunk(cx, cz);
    this.world.generateChunkData(chunk);
    this.world.applyEdits(chunk);
    chunk.buildMesh((wx, wy, wz) => this.world.getBlock(wx, wy, wz), this.world.material, this.world.waterMaterial);
    this.world.chunks.set(key, chunk);
    return chunk;
  }

  /** 初始化渲染器 */
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: this.isMobile ? 'low-power' : 'default',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // 移动端降低像素比以提升性能
    const maxPixelRatio = this.isMobile ? 1.2 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
    this.renderer.setClearColor(0x87CEEB);
  }

  /** 初始化场景与灯光 */
  _initScene() {
    this.scene = new THREE.Scene();

    // 雾效：距离根据设备动态调整，移动端增加雾距避免近处物体泛蓝
    const fogFar = this.renderDistance * CHUNK_SIZE + 4;
    const fogNear = this.isMobile ? Math.max(25, fogFar - 20) : Math.max(15, fogFar - 40);
    this.scene.fog = new THREE.Fog(0x87CEEB, fogNear, fogFar);

    // 环境光
    const ambientLight = new THREE.AmbientLight(0xcccccc, 0.7);
    this.scene.add(ambientLight);

    // 方向光（模拟太阳）
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(50, 100, 30);
    this.scene.add(dirLight);

    // 半球光（天空+地面反射）
    const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x556633, 0.3);
    this.scene.add(hemiLight);

    // 初始化世界并设置渲染距离
    this.world = new World(this.scene);
    this.world.renderDistance = this.renderDistance;
    this.world.init();
    // 主世界差分与维度表共用同一 Map
    this._dimEdits[Dim.OVERWORLD] = this.world.edits;

    // 初始化机器人生成管理器
    this.animalManager = new AnimalManager(this.scene, this.world, this.isMobile);

    // 相机：移动端更广视角（90°），桌面端默认（75°）
    this.defaultFov = this.isMobile ? 90 : 75;
    this.fov = this.defaultFov;
    this.fovMin = 15;
    this.fovMax = 130;
    this.camera = new THREE.PerspectiveCamera(
      this.fov, window.innerWidth / window.innerHeight, 0.1, 1000
    );
  }

  /** 初始化玩家 */
  _initPlayer() {
    this.player = new Player(this.camera, this.world);
  }

  /** 初始化方块高亮 */
  _initHighlight() {
    this.highlight = new BlockHighlight(this.scene);
  }

  /** 初始化物品栏UI（9 格 + 数量） */
  _initHotbar() {
    const hotbar = this.ui.hotbar;
    hotbar.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement('div');
      slot.className = `hotbar-slot${i === 0 ? ' selected' : ''}`;
      slot.dataset.index = i;
      const preview = document.createElement('div');
      preview.className = 'block-preview';
      slot.appendChild(preview);
      const count = document.createElement('span');
      count.className = 'slot-count';
      slot.appendChild(count);
      const keyLabel = document.createElement('span');
      keyLabel.className = 'slot-key';
      keyLabel.textContent = i === 8 ? '9' : String(i + 1);
      slot.appendChild(keyLabel);
      hotbar.appendChild(slot);
    }
    this._updateHotbar();
  }

  /** 更新物品栏选中状态与数量 */
  _updateHotbar() {
    if (!this.player) return;
    const slots = this.ui.hotbar.querySelectorAll('.hotbar-slot');
    slots.forEach((slot, i) => {
      slot.classList.toggle('selected', i === this.selectedSlot);
      const item = this.inventory.get(i);
      const preview = slot.querySelector('.block-preview');
      const countEl = slot.querySelector('.slot-count');
      if (item) {
        preview.style.background = isItem(item.type) ? getItemColor(item.type) : getBlockColor(item.type);
        preview.style.opacity = '1';
        preview.style.boxShadow = 'inset -3px -3px 0 rgba(0,0,0,0.25), inset 3px 3px 0 rgba(255,255,255,0.15)';
        countEl.textContent = item.count > 1 ? String(item.count) : '';
      } else {
        preview.style.background = 'transparent';
        preview.style.opacity = '0.25';
        preview.style.boxShadow = 'none';
        countEl.textContent = '';
      }
    });
    const t = this.inventory.selectedType(this.selectedSlot);
    this.player.selectedBlock = (!t || isItem(t) || isFood(t)) ? BlockType.AIR : t;
    const name = !t ? '空手' : (getItemName(t) || BlockNames[t] || '');
    const nameEl = this.ui.selectedBlockName;
    if (nameEl) {
      nameEl.textContent = name;
      nameEl.style.transform = 'translateX(-50%) scale(1.15)';
      nameEl.style.opacity = '1';
      setTimeout(() => { nameEl.style.transform = 'translateX(-50%) scale(1)'; }, 120);
    }
    if (this.isMobile) this._updateMobileHotbar();
    this._updateHpHud();
  }

  /** 初始化移动端物品栏 */
  _initMobileHotbar() {
    const mobileHotbar = document.getElementById('mobileHotbar');
    if (!mobileHotbar) return;
    mobileHotbar.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement('div');
      slot.className = `m-slot${i === 0 ? ' selected' : ''}`;
      slot.dataset.index = i;
      const preview = document.createElement('div');
      preview.className = 'm-block-preview';
      slot.appendChild(preview);
      const count = document.createElement('span');
      count.className = 'slot-count';
      slot.appendChild(count);
      slot.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.selectedSlot = i;
        this._updateHotbar();
      });
      mobileHotbar.appendChild(slot);
    }
  }

  /** 更新移动端物品栏选中状态 */
  _updateMobileHotbar() {
    const slots = document.querySelectorAll('#mobileHotbar .m-slot');
    slots.forEach((slot, i) => {
      slot.classList.toggle('selected', i === this.selectedSlot);
      const item = this.inventory.get(i);
      const preview = slot.querySelector('.m-block-preview');
      const countEl = slot.querySelector('.slot-count');
      if (preview && item) {
        preview.style.background = isItem(item.type) ? getItemColor(item.type) : getBlockColor(item.type);
        preview.style.opacity = '1';
        if (countEl) countEl.textContent = item.count > 1 ? String(item.count) : '';
      } else if (preview) {
        preview.style.background = 'transparent';
        preview.style.opacity = '0.3';
        if (countEl) countEl.textContent = '';
      }
    });
  }

  /** 绑定事件监听 */
  _initEvents() {
    // 键盘事件（桌面端 + 移动端外接键盘通用）
    document.addEventListener('keydown', (e) => {
      if (this._dead) return;
      this.player.keys[e.code] = true;

      // 数字键选择热栏 1-9
      if (e.code >= 'Digit1' && e.code <= 'Digit9') {
        const idx = parseInt(e.code.charAt(5), 10) - 1;
        if (idx >= 0 && idx < 9) {
          this.selectedSlot = idx;
          this._updateHotbar();
        }
      }

      if (e.code === 'KeyC' && this.isRunning) {
        e.preventDefault();
        this._craftPlanks();
      }
      if (e.code === 'KeyF' && this.isRunning) {
        e.preventDefault();
        this._eatSelected();
      }
      if (e.code === 'KeyG' && this.isRunning) {
        e.preventDefault();
        this._tryIgnitePortal();
      }

      // ESC 暂停（移动端也支持）
      if (e.code === 'Escape' && this.isRunning) {
        if (this.isMobile) {
          this.isRunning = false;
          this.ui.pauseScreen.style.display = 'flex';
          this._showGameUI(false);
          this._persist('auto');
        }
      }

      // 视野调整快捷键（= 放大/缩小视野，- 缩小/扩大视野）
      if (e.code === 'Equal') {           // = 放大画面 → 视野变窄
        this._adjustFOV(-5);
      }
      if (e.code === 'Minus') {           // - 缩小画面 → 视野变广
        this._adjustFOV(5);
      }
      if (e.code === 'Digit0' || e.code === 'Numpad0') {  // 0 重置视野
        this._resetFOV();
      }
    });

    document.addEventListener('keyup', (e) => {
      this.player.keys[e.code] = false;
    });

    // 鼠标移动（仅桌面端指针锁定后）
    document.addEventListener('mousemove', (e) => {
      if (!this.isPointerLocked || this._dead) return;
      this.player.onMouseMove(e.movementX, e.movementY);
    });

    // 鼠标：左键攻击/破坏，右键放置（对标我的世界）
    document.addEventListener('mousedown', (e) => {
      if (!this.isPointerLocked || this._dead) return;
      if (e.button === 0) this._primaryAction();
      else if (e.button === 2) this._secondaryAction();
    });

    // 禁用右键菜单
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // 滚轮切换方块（仅桌面端指针锁定后）
    document.addEventListener('wheel', (e) => {
      if (!this.isPointerLocked || this._dead) return;

      // Ctrl + 滚轮 / 触控板双指缩放 → 调整视野
      // 捏合(deltaY>0) = 缩小画面 = 视野变广(FOV变大)；推开(deltaY<0) = 放大画面 = 视野变窄(FOV变小)
      if (e.ctrlKey) {
        this._adjustFOV(e.deltaY > 0 ? 5 : -5);
        return;
      }

      if (e.deltaY > 0) {
        this.selectedSlot = (this.selectedSlot + 1) % 9;
      } else {
        this.selectedSlot = (this.selectedSlot - 1 + 9) % 9;
      }
      this._updateHotbar();
    });

    // ----- 桌面端：指针锁定逻辑 -----
    if (!this.isMobile) {
      document.addEventListener('pointerlockchange', () => {
        this.isPointerLocked = document.pointerLockElement === this.canvas;
        if (this._dead) {
          if (this.isPointerLocked) document.exitPointerLock();
          this.ui.pauseScreen.style.display = 'none';
          return;
        }
        if (this.isPointerLocked) {
          this.ui.pauseScreen.style.display = 'none';
          this._showGameUI(true);
        } else if (this.isRunning) {
          this.ui.pauseScreen.style.display = 'flex';
          this._persist('auto'); // 暂停时自动存
        }
      });

      const requestLock = () => {
        if (!this.isPointerLocked && this.isRunning && !this._dead) {
          const retry = () => {
            if (!this._dead && this.isRunning) this.ui.pauseScreen.style.display = 'flex';
          };
          try {
            // Joining a room awaits a socket reply; some browsers no longer
            // consider it a user gesture. Offer an explicit resume click.
            this.canvas.requestPointerLock()?.catch(retry);
          } catch { retry(); }
        }
      };

      // 开始/继续由按钮触发，见 _initSaveUI
      this._requestLock = requestLock;
      this.ui.pauseScreen.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        requestLock();
      });
      this.canvas.addEventListener('click', requestLock);
    }

    // ----- 移动端：直接进入游戏 + 触摸控制 -----
    if (this.isMobile) {
      this.ui.pauseScreen.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        this.isRunning = true;
        this.ui.pauseScreen.style.display = 'none';
        this._showGameUI(true);
      });

      // 初始化触摸控制器
      this.touchController = new TouchController(this.player, this);
    }

    // 窗口尺寸变化
    window.addEventListener('resize', () => this._onResize());

    // 关页前强制存档
    window.addEventListener('beforeunload', () => {
      if (this.isRunning || this.world.edits.size > 0) this._persist('unload');
    });

    // 包装放置/破坏：联机广播 + 掉落/消耗已在 _primary/_secondary 处理
    const wrap = (fn, getType) => {
      const self = this;
      return function (...args) {
        const before = self.player.targetBlock ? { ...self.player.targetBlock } : null;
        const face = self.player.targetFace ? { ...self.player.targetFace } : null;
        const placedType = self.player.selectedBlock;
        const ok = fn.apply(this, args);
        if (ok) {
          self._dirtySinceSave = true;
          if (self._online && self.net?.room && !self._netApplying) {
            if (getType === 'place' && before && face) {
              self.net.sendBlock(
                before.x + face.x, before.y + face.y, before.z + face.z,
                placedType
              );
            } else if (getType === 'break' && before) {
              self.net.sendBlock(before.x, before.y, before.z, BlockType.AIR);
            }
          }
        }
        return ok;
      };
    };
    this.player.placeBlock = wrap(this.player.placeBlock, 'place');
    this.player.breakBlock = wrap(this.player.breakBlock, 'break');
  }

  /** 左键：优先打怪，否则破坏方块 */
  _primaryAction() {
    if (!this.isRunning) return;
    this._refreshEntityTarget();
    if (this.player.targetMob && this.player.attackCooldown <= 0) {
      this._attackMob(this.player.targetMob);
      return;
    }
    const broken = this.player.breakBlock();
    if (broken && broken !== true) {
      const drop = getBreakDrop(broken);
      if (drop) {
        this.inventory.add(drop, 1);
        this._updateHotbar();
        this._showSaveToast(`+1 ${BlockNames[drop] || '物品'}`);
      }
      this._dirtySinceSave = true;
    }
  }

  /** 右键：食物则吃；否则放置 */
  _secondaryAction() {
    if (!this.isRunning) return;
    const type = this.inventory.selectedType(this.selectedSlot);
    if (!type) {
      this._showSaveToast('空手');
      return;
    }
    if (isFood(type)) {
      this._eatSelected();
      return;
    }
    if (isItem(type)) {
      this._showSaveToast('按 F 食用，或换方块放置');
      return;
    }
    this.player.selectedBlock = type;
    if (!this.inventory.consume(this.selectedSlot, 1)) return;
    const ok = this.player.placeBlock();
    if (!ok) this.inventory.add(type, 1);
    this._updateHotbar();
  }

  _eatSelected() {
    const type = this.inventory.selectedType(this.selectedSlot);
    if (!isFood(type)) return;
    if (this.player.hp >= this.player.maxHp) {
      this._showSaveToast('已经吃饱了');
      return;
    }
    if (!this.inventory.consume(this.selectedSlot, 1)) return;
    const heal = getFoodHeal(type);
    if (this._online) this.net._send({t:'eat',item:type});
    else this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
    this._updateHotbar();
    this._updateHpHud();
    this._showSaveToast(`吃了${getItemName(type)} +${heal}❤`);
    this._dirtySinceSave = true;
  }

  /** 1 木头 → 4 木板 */
  _craftPlanks() {
    const type = this.inventory.selectedType(this.selectedSlot);
    if (type !== BlockType.WOOD) {
      this._showSaveToast('选中木头再按 C 合成木板');
      return;
    }
    if (!this.inventory.consume(this.selectedSlot, 1)) return;
    this.inventory.add(BlockType.PLANKS, 4);
    this._updateHotbar();
    this._showSaveToast('合成：木头 → 4 木板');
    this._dirtySinceSave = true;
  }

  /** 准星对着黑曜石框按 G 点燃地狱门 */
  _tryIgnitePortal() {
    const tb = this.player.targetBlock;
    if (!tb || tb.type !== BlockType.OBSIDIAN) {
      this._showSaveToast('准星对准黑曜石门框，按 G 点燃');
      return;
    }
    const lit = tryLightPortal(this.world, tb.x, tb.y, tb.z);
    if (!lit) {
      this._showSaveToast('门框不对：内空宽2高3，外圈黑曜石');
      return;
    }
    this._dirtySinceSave = true;
    this._showSaveToast('地狱门已点燃！走进紫色门');
  }

  _attackMob(robot) {
    this.player.attackCooldown = 0.35;
    if (robot === this._mistBoss) {
      if (this._online) { this.net.sendHit('mist-boss',5); return; }
      robot.takeDamage(5);
      this._mistBossState = robot.toJSON();
      this._dirtySinceSave = true;
      if (robot.dead) {
        robot.dispose();
        this._mistBoss = null;
        this._showSaveToast('迷雾档案 Boss 已击败！');
        this._persist('boss-defeated');
      }
      this._updateBossHud();
      return;
    }
    // 末影龙本地权威（联机也各自打，掉落给击杀者）
    if (robot === this._dragon || robot?.kind === 'dragon') {
      const result = this._dragon.takeDamage(5);
      if (result?.dead) this._onDragonDefeated();
      else this._showSaveToast(`末影龙 ${this._dragon.hp}/${this._dragon.maxHp}`);
      return;
    }
    if (this._online && this.net?.room) {
      this.net.sendHit(robot.id, 3);
      robot.hurtTimer = 0.35;
      return;
    }
    const result = robot.takeDamage(3);
    if (!result) return;
    if (result.dead) {
      for (const d of result.drops) this.inventory.add(d, 1);
      this._updateHotbar();
      this._showSaveToast(`击杀${robot.def?.name || ''}！获得肉/掉落`);
      robot.dispose();
      this.animalManager.robots = this.animalManager.robots.filter((r) => r !== robot);
      this._dirtySinceSave = true;
    } else {
      this._showSaveToast(`命中 ${robot.hp}/${robot.maxHp}`);
    }
  }

  _onDragonDefeated() {
    if (this._dragonKilled) return;
    this._dragonKilled = true;
    this._showSaveToast('⚔ 末影龙已被击败！');
    for (let i = 0; i < 8; i++) this.inventory.add(107, 1); // DRAGON_MEAT
    this.inventory.add(BlockType.OBSIDIAN, 8);
    this.inventory.add(BlockType.END_STONE, 16);
    this._updateHotbar();
    if (this._dragon) {
      this._dragon.dispose();
      this._dragon = null;
    }
    this._dirtySinceSave = true;
  }

  _refreshEntityTarget() {
    if (!this.player) return;
    const origin = this.camera.position;
    const dir = new THREE.Vector3(
      -Math.sin(this.player.yaw) * Math.cos(this.player.pitch),
      Math.sin(this.player.pitch),
      -Math.cos(this.player.yaw) * Math.cos(this.player.pitch)
    ).normalize();
    let best = null;
    let bestT = this.player.reachDistance;
    if (this.animalManager) {
      const hit = this.animalManager.raycast(origin, dir, this.player.reachDistance);
      if (hit && hit.dist < bestT) { best = hit.robot; bestT = hit.dist; }
    }
    if (this._dragon && !this._dragon.dead) {
      const t = this._dragon.hitDistance(origin, dir, this.player.reachDistance + 4);
      if (t < bestT) { best = this._dragon; bestT = t; }
    }
    if (this._mistBoss) {
      const t = this._mistBoss.hitDistance(origin, dir, this.player.reachDistance);
      if (t < bestT) { best = this._mistBoss; bestT = t; }
    }
    let blockDist = Infinity;
    if (this.player.targetBlock) {
      const bx = this.player.targetBlock.x + 0.5 - origin.x;
      const by = this.player.targetBlock.y + 0.5 - origin.y;
      const bz = this.player.targetBlock.z + 0.5 - origin.z;
      blockDist = Math.sqrt(bx * bx + by * by + bz * bz);
    }
    this.player.targetMob = (best && bestT < blockDist) ? best : null;
  }

  /**
   * 切换维度：保存当前差分 → 换世界生成 → 重载区块
   * @param {'overworld'|'nether'|'end'} dim
   * @param {{x,y,z}|null} spawn
   */
  async _switchDimension(dim, spawn = null) {
    if (dim === this.dimension || this._dead) return;
    this._clearMistBoss();
    this._showSaveToast(`穿越中 → ${dim === Dim.NETHER ? '地狱' : dim === Dim.END ? '末地' : '主世界'}…`);

    // 存当前维度差分
    this._dimEdits[this.dimension] = new Map(this.world.edits);

    // 清区块 mesh
    for (const [, chunk] of this.world.chunks) {
      if (chunk.mesh) this.scene.remove(chunk.mesh);
      if (chunk.waterMesh) this.scene.remove(chunk.waterMesh);
      chunk._disposeMesh?.();
    }
    this.world.chunks.clear();
    this.animalManager.clearAll();
    if (this._dragon) { this._dragon.dispose(); this._dragon = null; }

    this.dimension = dim;
    this.world.setDimension(dim);
    this.world.edits = this._dimEdits[dim] || new Map();
    this._dimEdits[dim] = this.world.edits;

    // 雾与天空
    if (dim === Dim.NETHER) {
      this.scene.fog = new THREE.Fog(0x4a1515, 8, 48);
      this.renderer.setClearColor(0x2a0808);
    } else if (dim === Dim.END) {
      this.scene.fog = new THREE.Fog(0x0a0014, 12, 70);
      this.renderer.setClearColor(0x050010);
    } else {
      this.scene.fog = new THREE.Fog(0x87CEEB, 15, this.renderDistance * CHUNK_SIZE + 4);
      this.renderer.setClearColor(0x87CEEB);
    }

    // 出生点
    if (spawn) {
      this.player.position.set(spawn.x, spawn.y, spawn.z);
    } else if (dim === Dim.NETHER) {
      this.player.position.set(8, 16, 8);
    } else if (dim === Dim.END) {
      this.player.position.set(0, 24, 0);
    } else {
      this.player.position.set(this._spawnX || 5.4, (this._spawnY || 22) + 1, this._spawnZ || 22.6);
    }

    // 加载周围区块
    const pcx = Math.floor(this.player.position.x / CHUNK_SIZE);
    const pcz = Math.floor(this.player.position.z / CHUNK_SIZE);
    const r = this.renderDistance;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + dz * dz > r * r) continue;
        const chunk = this._createChunk(pcx + dx, pcz + dz);
        if (chunk?.mesh) this.scene.add(chunk.mesh);
        if (chunk?.waterMesh) this.scene.add(chunk.waterMesh);
      }
    }

    // 回程门 / 末影龙
    if (dim === Dim.NETHER) {
      const hasPortal = [...this.world.edits.values()].includes(BlockType.PORTAL);
      if (!hasPortal) {
        // 回程门放在 x=20，避开中央末地神殿
        spawnReturnPortal(this.world, 20, 14, 8, 'x');
        const key = this.world.chunkKey(1, 0);
        let ch = this.world.chunks.get(key);
        if (!ch) {
          ch = this._createChunk(1, 0);
          if (ch.mesh) this.scene.add(ch.mesh);
          if (ch.waterMesh) this.scene.add(ch.waterMesh);
        } else {
          if (ch.mesh) this.scene.remove(ch.mesh);
          if (ch.waterMesh) this.scene.remove(ch.waterMesh);
          this.world.generateChunkData(ch);
          this.world.applyEdits(ch);
          ch.buildMesh((wx, wy, wz) => this.world.getBlock(wx, wy, wz), this.world.material, this.world.waterMaterial);
          if (ch.mesh) this.scene.add(ch.mesh);
          if (ch.waterMesh) this.scene.add(ch.waterMesh);
        }
      }
      this.player.position.set(21, 16, 8);
    }
    if (dim === Dim.END && !this._dragonKilled) {
      this._dragon = new EnderDragon(this.scene, 0, 28, 0);
    }

    this.animalManager._netMode = false;
    this.animalManager.spawnCenter.set(this.player.position.x, 0, this.player.position.z);
    if (!this._online) this.animalManager.spawnAnimals(dim);

    this._ensureMistBoss();
    this._portalTimer = -2; // 防立刻回传
    this._updateDimHud();
    this._showSaveToast(dim === Dim.NETHER ? '已进入地狱 · 中央紫色台通往末地' : dim === Dim.END ? '末地 · 击败末影龙！' : '回到主世界');
  }

  /** Solo only: keep the new Boss out of the server's unsynchronized mob list. */
  async _ensureMistBoss() {
    if (this._online) { this._syncOnlineBoss(this._netBossState); return; }
    if (this.dimension !== Dim.OVERWORLD || this._mistBoss || this._mistBossState?.hp === 0) return;
    const p = this.player.position;
    let spawn = this._mistBossState;
    if (!spawn || ![spawn.x,spawn.y,spawn.z].every(Number.isFinite)) {
      spawn = null;
      for (const offset of [.65,-.65,1.2,-1.2,Math.PI]) {
        const angle = this.player.yaw + offset;
        const x=p.x-Math.sin(angle)*10, z=p.z-Math.cos(angle)*10;
        const y=findStandY(this.world,x,z,p.y);
        if (y !== null) { spawn={x,y,z,hp:1500}; break; }
      }
    }
    if (!spawn) { this._showSaveToast('附近没有 Boss 可站立的位置'); return; }
    const boss = new MistBoss(this.scene,this.world,spawn,spawn.hp);
    this._mistBoss = boss;
    this._updateBossHud();
    try {
      await boss.load();
      if (this._mistBoss !== boss) return;
      this._mistBossState = boss.toJSON();
      this._updateBossHud();
    } catch (error) {
      console.error('迷雾档案 Boss 加载失败',error);
      boss.dispose();
      if (this._mistBoss === boss) {
        this._mistBoss = null;
        this._updateBossHud();
        this._showSaveToast('Boss 模型加载失败，请刷新重试');
      }
    }
  }

  async _syncOnlineBoss(state) {
    this._netBossState = state;
    if (!this._online || this._hostWaiting || !state) return;
    if (state.hp <= 0 || this.dimension !== Dim.OVERWORLD) {
      if (state.hp <= 0 && this._mistBoss) this._showSaveToast('迷雾档案 Boss 已被大家击败！');
      this._clearMistBoss();
      return;
    }
    if (this._mistBoss?.netDriven) {
      this._mistBoss.applyNetState(state);
      this._updateBossHud();
      return;
    }
    this._clearMistBoss();
    const boss = new MistBoss(this.scene,this.world,state,state.hp);
    this._mistBoss = boss;
    boss.applyNetState(state);
    try {
      await boss.load();
      if (this._mistBoss !== boss) return;
      this._updateBossHud();
    } catch (error) {
      console.error('联机 Boss 模型加载失败',error);
      boss.dispose();
      // Keep the failed instance until leaving the room: no 5 Hz retry storm.
      if (this._mistBoss === boss) this._showSaveToast('Boss 模型加载失败，请刷新重试');
    }
  }

  _clearMistBoss() {
    if (this._mistBoss) {
      if (!this._mistBoss.netDriven) this._mistBossState = this._mistBoss.toJSON();
      this._mistBoss.dispose();
      this._mistBoss = null;
    }
    this._updateBossHud();
  }

  _updateBossHud(show = this.isRunning) {
    const hud = document.getElementById('bossHud');
    if (!hud) return;
    const boss = this._mistBoss;
    hud.hidden = !show || this._dead || !boss || boss.dead;
    if (hud.hidden) return;
    document.getElementById('bossHpText').textContent = `${boss.hp} / ${boss.maxHp}`;
    document.getElementById('bossHealth').value = boss.hp;
    document.getElementById('bossStatus').textContent = !boss.ready ? '角色载入中…' :
      boss.combat.state === 'attack' ? '挥砍！拉开距离' : '保持距离 · 左键攻击';
  }

  _showDeathScreen() {
    if (this._dead) return;
    this._dead = true;
    this.isRunning = false;
    this.player.hp = 0;
    this.player.keys = {};
    this.player.velocity.set(0,0,0);
    this.ui.pauseScreen.style.display = 'none';
    this._showGameUI(false);
    document.getElementById('deathReason').textContent = this._lastDamageBy === 'mist-boss'
      ? '你被迷雾档案的主人公击败了' : '生命值已耗尽';
    document.getElementById('deathScreen').hidden = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.isPointerLocked = false;
    document.getElementById('btnRespawn').focus();
    if (this._online) this.net._send({t:'player_hurt',hp:0});
    this._persist('death');
  }

  _respawnPlayer(serverState = null) {
    if (!this._dead) return;
    if (this._online && !serverState) {
      this.net._send({t:'respawn'});
      return; // wait for authoritative HP and spawn; do not revive locally
    }
    const spawn = this.dimension === Dim.END ? new THREE.Vector3(0,24,0) :
      this.dimension === Dim.NETHER ? new THREE.Vector3(21,16,8) :
      (this._respawnPoint || new THREE.Vector3(9.5,19,18)).clone();
    // The original spawn may have been mined out. Search nearby solid ground.
    outer: for (let r=0;r<=8;r++) for (let x=-r;x<=r;x++) for (let z=-r;z<=r;z++) {
      const y=findStandY(this.world,spawn.x+x,spawn.z+z,spawn.y);
      if (y !== null) { spawn.set(spawn.x+x,y+.05,spawn.z+z); break outer; }
    }
    if (serverState) spawn.set(serverState.x,serverState.y,serverState.z);
    this.player.position.copy(spawn);
    this.player.velocity.set(0,0,0);
    this.player.keys = {};
    this.player.hp = this.player.maxHp;
    this.player.invuln = 3;
    this.player._fallVy = 0;
    this.player._wasOnGround = true;
    this.player.attackCooldown = 0;
    if (this.touchController) { this.touchController.moveX = 0; this.touchController.moveZ = 0; }
    this._lastDamageBy = '';
    this._portalTimer = -3;
    this._dead = false;
    this.isRunning = true;
    this.camera.position.copy(spawn).y += this.player.eyeHeight;
    document.getElementById('deathScreen').hidden = true;
    this.ui.pauseScreen.style.display = 'none';
    this._showGameUI(true);
    this._updateHpHud();
    this._persist('respawn');
    if (serverState && !this.isMobile) {
      // The socket callback is not a user gesture; pointer lock needs a click.
      this.ui.pauseScreen.style.display = 'flex';
    } else this._requestLock?.();
  }

  _updateDimHud() {
    let el = document.getElementById('dimHud');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dimHud';
      document.body.appendChild(el);
    }
    const label = this.dimension === Dim.NETHER ? '地狱' : this.dimension === Dim.END ? '末地' : '主世界';
    el.textContent = label;
    el.style.display = this.isRunning ? 'block' : 'none';
  }

  _tickPortal(dt) {
    if (!this.isRunning) return;
    if (this._portalTimer < 0) {
      this._portalTimer += dt;
      return;
    }
    if (!standingInPortal(this.world, this.player.position.x, this.player.position.y, this.player.position.z)) {
      this._portalTimer = 0;
      return;
    }
    this._portalTimer += dt;
    if (this._portalTimer < 1.2) return;
    this._portalTimer = -3;

    // 路由：主世界↔地狱；地狱中央神殿门→末地；末地门→主世界
    if (this.dimension === Dim.OVERWORLD) {
      this._switchDimension(Dim.NETHER);
    } else if (this.dimension === Dim.NETHER) {
      // 在神殿平台上（y>=15 且靠近原点）→ 末地，否则回主世界
      const p = this.player.position;
      if (Math.hypot(p.x - 8, p.z - 8) < 6 && p.y >= 14) {
        this._switchDimension(Dim.END);
      } else {
        this._switchDimension(Dim.OVERWORLD);
      }
    } else {
      this._switchDimension(Dim.OVERWORLD);
    }
  }

  _ensureHud() {
    if (document.getElementById('hpHud')) return;
    const el = document.createElement('div');
    el.id = 'hpHud';
    el.style.display = 'none';
    el.innerHTML = '<span class="hp-label">❤</span><span id="hpHearts"></span>';
    document.body.appendChild(el);
    this._updateHpHud();
  }

  _updateHpHud() {
    const hearts = document.getElementById('hpHearts');
    if (!hearts || !this.player) return;
    const hp = Math.max(0, Math.ceil(this.player.hp));
    hearts.textContent = `${hp} / ${this.player.maxHp}`;
    hearts.style.color = hp <= 4 ? '#ff5252' : '#fff';
  }

  /** 存档 UI：开始屏 / 暂停屏按钮 */
  _initSaveUI() {
    document.getElementById('btnRespawn').addEventListener('click', (e) => {
      e.stopPropagation(); this._respawnPlayer();
    });
    const btnContinue = document.getElementById('btnContinue');
    const btnNewGame = document.getElementById('btnNewGame');
    const btnResume = document.getElementById('btnResume');
    const btnSave = document.getElementById('btnSave');

    const beginPlay = () => {
      this._stopRoomPoll();
      this.isRunning = true;
      this.ui.startScreen.style.display = 'none';
      // 出生在地狱门前，方便直接去打龙
      if (this._starterPortalPos && this.dimension === Dim.OVERWORLD) {
        this.player.position.set(
          this._starterPortalPos.x - 2.5,
          (World.TEXT_GROUND_Y || 18) + 1.1,
          this._starterPortalPos.z
        );
        this.player.position.y = this.world.getSurfaceHeight(Math.floor(this.player.position.x), Math.floor(this.player.position.z)) + .05;
        this.player.yaw = -Math.PI / 2; // 面朝门
      }
      this.camera.position.set(
        this.player.position.x,
        this.player.position.y + this.player.eyeHeight,
        this.player.position.z
      );
      const lookDir = new THREE.Vector3(
        -Math.sin(this.player.yaw) * Math.cos(this.player.pitch),
        Math.sin(this.player.pitch),
        -Math.cos(this.player.yaw) * Math.cos(this.player.pitch)
      );
      this.camera.lookAt(
        this.camera.position.x + lookDir.x,
        this.camera.position.y + lookDir.y,
        this.camera.position.z + lookDir.z
      );
      this._ensureHud();
      this._showGameUI(true);
      if (this.isMobile) {
        /* already shown */
      } else if (this._requestLock) {
        this._requestLock();
      }
      this._respawnPoint = this.player.position.clone();
      this._ensureMistBoss();
      this._startAutosave();
      this._persist('enter');
      this._showSaveToast('迷雾档案 Boss 在附近 · 左键攻击，注意躲开挥砍！');
      if (this.player.hp <= 0) this._showDeathScreen();
    };

    if (btnContinue) {
      btnContinue.addEventListener('click', (e) => {
        e.stopPropagation();
        beginPlay();
      });
    }

    if (btnNewGame) {
      btnNewGame.addEventListener('click', (e) => {
        e.stopPropagation();
        // 有存档 → 确认后清档重载；无存档 → 直接开局
        if (this._saveData) {
          if (!confirm('将清除本地存档并重新开始，确定？')) return;
          SaveManager.clear();
          location.reload();
          return;
        }
        beginPlay();
      });
    }

    if (btnResume) {
      btnResume.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.isMobile) {
          this.isRunning = true;
          this.ui.pauseScreen.style.display = 'none';
          this._showGameUI(true);
        } else if (this._requestLock) {
          this._requestLock();
        }
      });
    }

    if (btnSave) {
      btnSave.addEventListener('click', (e) => {
        e.stopPropagation();
        const r = this._persist('manual');
        this._showSaveToast(r.ok ? `已保存（${r.editCount || 0} 处改动）` : `保存失败：${r.error || '未知'}`);
      });
    }

    // ESC 暂停（移动端）时也存一下
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF5' && e.shiftKey && this.isRunning) {
        e.preventDefault();
        const r = this._persist('manual');
        this._showSaveToast(r.ok ? '已保存' : '保存失败');
      }
    });
  }

  _refreshStartUI() {
    const btnContinue = document.getElementById('btnContinue');
    const btnNewGame = document.getElementById('btnNewGame');
    const saveMeta = document.getElementById('saveMeta');
    const hint = document.querySelector('.start-hint');

    if (this._saveData) {
      if (btnContinue) btnContinue.style.display = 'inline-flex';
      if (btnNewGame) btnNewGame.textContent = '新游戏';
      if (hint) hint.style.display = 'none';
      if (saveMeta) {
        const n = (this._saveData.edits.length / 4) | 0;
        saveMeta.style.display = 'block';
        saveMeta.textContent = `存档：${SaveManager.formatTime(this._saveData.savedAt)} · ${n} 处改动`;
      }
    } else {
      if (btnContinue) btnContinue.style.display = 'none';
      if (btnNewGame) btnNewGame.textContent = '开始游戏';
      if (hint) hint.style.display = 'block';
      if (saveMeta) saveMeta.style.display = 'none';
    }
  }

  _startAutosave() {
    if (this._autosaveTimer) clearInterval(this._autosaveTimer);
    this._autosaveTimer = setInterval(() => {
      if (!this.isRunning) return;
      if (!this._dirtySinceSave && this.world.edits.size === 0) return;
      this._persist('auto');
    }, 30000);
  }

  _persist(reason) {
    const pos = this.player.position;
    const r = SaveManager.save({
      mistBoss: this._online ? this._mistBossState : (this._mistBoss?.toJSON() || this._mistBossState),
      seed: this.world.seed,
      selectedSlot: this.selectedSlot,
      hp: this.player.hp,
      inventory: this.inventory.toJSON(),
      player: {
        x: pos.x, y: pos.y, z: pos.z,
        yaw: this.player.yaw, pitch: this.player.pitch,
      },
      edits: this.world.edits,
    });
    if (r.ok) {
      this._dirtySinceSave = false;
      this._saveData = SaveManager.load();
    }
    return r;
  }

  _showSaveToast(msg) {
    let el = document.getElementById('saveToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'saveToast';
      el.className = 'save-toast';
      (this.ui.pauseScreen || document.body).appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  /** 联机事件绑定 */
  _bindNet() {
    this.net.on('boss', msg => this._syncOnlineBoss(msg.boss));
    this.net.on('vitals', msg => {
      if (!this._online || this._hostWaiting || !Number.isFinite(msg.hp)) return;
      this.player.hp = Math.max(0,Math.min(20,msg.hp));
      if (msg.cause) this._lastDamageBy = msg.cause;
      this._updateHpHud();
      if (this.player.hp <= 0) this._showDeathScreen();
    });
    this.net.on('respawned', async msg => {
      if (!this._online || !this._dead) return;
      if (this.dimension !== msg.dimension) {
        // Dimension transition normally refuses dead players. Complete it before
        // reviving, keeping simulation stopped throughout the async reload.
        this._dead = false;
        await this._switchDimension(msg.dimension,msg);
        this._dead = true;
      }
      this._respawnPlayer(msg);
    });
    this.net.on('block', (msg) => {
      if (msg.by === this.net.id) return;
      this._netApplying = true;
      this.world.setBlock(msg.x, msg.y, msg.z, msg.b);
      this._netApplying = false;
      this._dirtySinceSave = true;
    });
    this.net.on('peer', (msg) => {
      if (msg.id === this.net.id) return;
      this.remotes.upsert(msg);
      this._updateRoomHud();
      this._updateWaitingPanel();
      this._refreshRoomList();
    });
    this.net.on('move', (msg) => {
      if (msg.id === this.net.id) return;
      this.remotes.upsert(msg);
    });
    this.net.on('bye', (msg) => {
      this.remotes.remove(msg.id);
      this._updateRoomHud();
      this._updateWaitingPanel();
      this._refreshRoomList();
    });
    this.net.on('close', () => {
      if (this._online || this._hostWaiting) {
        this._clearMistBoss();
        this._netBossState = null;
        this._online = false;
        this._hostWaiting = false;
        this._showSaveToast('联机已断开');
        this._setOnlineStatus('联机连接断开，请重新建房/加入', true);
        this._hideWaitingPanel();
        this._updateRoomHud();
        this._setServiceStatus(false);
        this._startRoomPoll();
      }
    });
    this.net.on('err', (msg) => {
      this._setOnlineStatus(msg, true);
    });
    this.net.on('mobs', (msg) => {
      if (!this.animalManager) return;
      this.animalManager.syncFromNet(msg.list || []);
    });
    this.net.on('mob', (msg) => {
      if (!this.animalManager) return;
      this.animalManager.upsertNetMob(msg);
    });
    this.net.on('mob_die', (msg) => {
      if (!this.animalManager) return;
      this.animalManager.removeById(msg.id);
      if (msg.by === this.net.id && Array.isArray(msg.drops)) {
        for (const d of msg.drops) this.inventory.add(d, 1);
        this._updateHotbar();
        this._showSaveToast('击杀！获得掉落物');
      }
    });
    this.net.on('admin_spawn', (msg) => {
      if (!msg || msg.by === this.net.id) return; // 发起者本地已刷
      this._adminSpawnAt(msg.kind, msg.x, msg.y, msg.z);
    });
  }

  /* ========== 管理指令 ========== */
  adminTeleport(x, y, z, dim) {
    if (!this.adminPanel?.authed) return;
    const targetDim = dim || this.dimension;
    const go = () => {
      this.player.position.set(+x, +y, +z);
      this.player.velocity.set(0, 0, 0);
      this._showSaveToast(`传送 ${(+x).toFixed(0)},${(+y).toFixed(0)},${(+z).toFixed(0)} · ${targetDim}`);
    };
    if (targetDim !== this.dimension) {
      this._switchDimension(targetDim, { x: +x, y: +y, z: +z }).then(() => {
        this.player.position.set(+x, +y, +z);
      });
    } else go();
  }

  adminGive(typeId, n) {
    if (!this.adminPanel?.authed) return;
    const got = this.inventory.add(typeId | 0, n | 0);
    this._updateHotbar();
    this._showSaveToast(`给予 ×${got}`);
  }

  adminHeal() {
    if (this._dead || !this.adminPanel?.authed) return;
    this.player.hp = this.player.maxHp;
    this._updateHpHud();
    this._showSaveToast('已满血');
  }

  adminToggleFly() {
    if (!this.adminPanel?.authed) return;
    this.player.adminFly = !this.player.adminFly;
    this._showSaveToast(this.player.adminFly ? '飞行开启（空格↑ Shift↓）' : '飞行关闭');
  }

  adminSpawn(kind) {
    if (!this.adminPanel?.authed) return;
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3(
      -Math.sin(this.player.yaw) * Math.cos(this.player.pitch),
      Math.sin(this.player.pitch),
      -Math.cos(this.player.yaw) * Math.cos(this.player.pitch)
    ).normalize();
    let x = origin.x + dir.x * 4;
    let y = origin.y + dir.y * 4;
    let z = origin.z + dir.z * 4;
    if (this.player.targetBlock) {
      x = this.player.targetBlock.x + 0.5;
      y = this.player.targetBlock.y + 1;
      z = this.player.targetBlock.z + 0.5;
    }
    this._adminSpawnAt(kind, x, y, z);
    this._showSaveToast(`已生成 ${kind}`);
  }

  _adminSpawnAt(kind, x, y, z) {
    if (kind === 'dragon') {
      if (this._dragon) {
        this._dragon.dispose();
        this._dragon = null;
      }
      this._dragon = new EnderDragon(this.scene, x, y + 4, z);
      this._dragonKilled = false;
      return;
    }
    this.animalManager?.spawnOne(kind, x, y, z);
  }

  adminBuild(id) {
    if (!this.adminPanel?.authed) return;
    const p = this.player.position;
    const ok = buildStructure(this.world, id, p.x, Math.floor(p.y), p.z);
    if (!ok) {
      this._showSaveToast('未知结构');
      return;
    }
    // 重筑脚下附近区块
    const cx = Math.floor(p.x / CHUNK_SIZE);
    const cz = Math.floor(p.z / CHUNK_SIZE);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) this._rebuildChunkAt(cx + dx, cz + dz);
    }
    this._dirtySinceSave = true;
    this._showSaveToast(`已生成结构 ${id}`);
  }

  adminClearMobs() {
    if (!this.adminPanel?.authed) return;
    const p = this.player.position;
    this.animalManager?.clearNear(p.x, p.z, 40);
    if (this._dragon) {
      this._dragon.dispose();
      this._dragon = null;
    }
    this._showSaveToast('已清空附近生物');
  }

  /** 用房间差分覆盖本地世界 */
  _applyRoomState(msg) {
    this.world.edits = SaveManager.arrayToEdits(msg.edits || []);
    for (const [, chunk] of this.world.chunks) {
      this.world.generateChunkData(chunk);
      this.world.applyEdits(chunk);
      chunk.dirty = true;
      if (chunk.mesh) this.scene.remove(chunk.mesh);
      if (chunk.waterMesh) this.scene.remove(chunk.waterMesh);
      chunk.buildMesh(
        (wx, wy, wz) => this.world.getBlock(wx, wy, wz),
        this.world.material,
        this.world.waterMaterial
      );
      if (chunk.mesh) this.scene.add(chunk.mesh);
      if (chunk.waterMesh) this.scene.add(chunk.waterMesh);
    }
    this.remotes.clear();
    for (const p of (msg.players || [])) {
      this.remotes.upsert(p);
    }
    if (this.animalManager) {
      this.animalManager.clearAll();
      this.animalManager.syncFromNet(msg.mobs || []);
    }
  }

  _enterFromOnline(msg) {
    this._clearMistBoss();
    this._online = true;
    this._hostWaiting = false;
    this.net.startHeartbeat();
    this._applyRoomState(msg);
    this._dead = false;
    document.getElementById('deathScreen').hidden = true;
    if (msg.self) {
      this.player.position.set(msg.self.x,msg.self.y,msg.self.z);
      this.player.hp = msg.self.hp;
      this.player.velocity.set(0,0,0);
      this.player.keys = {};
      this.player.yaw = 0;
      this.player.pitch = -.1;
    }
    this._respawnPoint = this.player.position.clone();
    this._syncOnlineBoss(msg.boss);
    this.net._send({t:'play'});
    this._updateRoomHud();
    const pauseInfo = document.getElementById('pauseRoomInfo');
    if (pauseInfo) {
      pauseInfo.style.display = 'block';
      const code = msg.room;
      pauseInfo.innerHTML =
        `联机房 <b>${code}</b>${msg.title ? ` · ${msg.title}` : ''}` +
        `<br><button type="button" class="game-btn tiny" id="btnCopyInviteInGame">复制邀请链接</button>` +
        `<span class="muted"> 好友打开链接点「加入」即可进你的世界</span>`;
      const btn = document.getElementById('btnCopyInviteInGame');
      if (btn) {
        btn.onclick = (ev) => {
          ev.stopPropagation();
          this._copyInvite(code);
        };
      }
    }
    this.isRunning = true;
    this.ui.startScreen.style.display = 'none';
    this.camera.position.set(
      this.player.position.x,
      this.player.position.y + this.player.eyeHeight,
      this.player.position.z
    );
    this._showGameUI(true);
    if (!this.isMobile && this._requestLock) this._requestLock();
    this._startAutosave();
    this._persist('enter');
    this._showSaveToast(`房间 ${msg.room} · 点左上角可复制邀请`);
  }

  _inviteUrl(code) {
    return `${location.origin}/?room=${encodeURIComponent(code || this.net?.room || '')}`;
  }

  _copyInvite(code) {
    const invite = this._inviteUrl(code);
    const done = () => this._showSaveToast('邀请链接已复制，发给好友');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(invite).then(done).catch(() => {
        prompt('复制此链接发给好友：', invite);
      });
    } else {
      prompt('复制此链接发给好友：', invite);
    }
  }

  _updateRoomHud() {
    let hud = document.getElementById('roomHud');
    if (!this._online || !this.net?.room) {
      if (hud) hud.style.display = 'none';
      return;
    }
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'roomHud';
      hud.title = '点击复制邀请链接';
      hud.style.cursor = 'pointer';
      hud.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.net?.room) this._copyInvite(this.net.room);
      });
      document.body.appendChild(hud);
    }
    const n = 1 + this.remotes.map.size;
    hud.style.display = 'block';
    hud.innerHTML = `联机 <b>${this.net.room}</b> · ${n} 人 · <span class="hud-hint">点此邀请</span>`;
  }

  _setOnlineStatus(text, isErr = false) {
    const el = document.getElementById('onlineStatus');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('err', !!isErr);
  }

  _initOnlineUI() {
    const btnHost = document.getElementById('btnHost');
    const btnJoin = document.getElementById('btnJoin');
    const btnRefresh = document.getElementById('btnRefreshRooms');
    const btnEnterRoom = document.getElementById('btnEnterRoom');
    const btnCancelHost = document.getElementById('btnCancelHost');
    const roomInput = document.getElementById('roomCodeInput');
    const nameInput = document.getElementById('playerNameInput');
    const titleInput = document.getElementById('roomTitleInput');
    const roomList = document.getElementById('roomList');

    try {
      const savedName = localStorage.getItem('voxel-nick');
      if (savedName && nameInput) nameInput.value = savedName;
      const savedTitle = localStorage.getItem('voxel-room-title');
      if (savedTitle && titleInput) titleInput.value = savedTitle;
    } catch { /* */ }

    const getName = () => {
      const n = (nameInput?.value || '玩家').trim().slice(0, 12) || '玩家';
      try { localStorage.setItem('voxel-nick', n); } catch { /* */ }
      return n;
    };
    const getTitle = () => {
      const t = (titleInput?.value || '').trim().slice(0, 24);
      try { if (t) localStorage.setItem('voxel-room-title', t); } catch { /* */ }
      return t;
    };

    const joinByCode = async (code) => {
      const c = String(code || '').toUpperCase().trim();
      if (!c) {
        this._setOnlineStatus('请输入房间码', true);
        return;
      }
      this._setOnlineStatus(`正在加入 ${c}…`);
      try {
        const msg = await this.net.join(c, getName());
        this._stopRoomPoll();
        this._hostWaiting = false;
        this._hideWaitingPanel();
        this._enterFromOnline(msg);
      } catch (err) {
        this._setOnlineStatus(err.message || String(err), true);
        this._refreshRoomList();
      }
    };

    if (btnHost) {
      btnHost.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (this._hostWaiting) {
          this._setOnlineStatus('你已有公开房间，可点「进入游戏」或取消', true);
          return;
        }
        btnHost.disabled = true;
        this._setOnlineStatus('正在创建公开房间…');
        this._setServiceStatus(null);
        try {
          const edits = SaveManager.editsToArray(this.world.edits);
          const name = getName();
          const title = getTitle() || `${name} 的世界`;
          const msg = await this.net.create(name, edits, title);
          this._pendingJoinMsg = msg;
          this._hostWaiting = true;
          this._online = true;
          this.net.startHeartbeat();
          this._showWaitingPanel(msg);
          this._setOnlineStatus(`房间 ${msg.room} 已公开，等待玩家加入`);
          this._setServiceStatus(true);
          this._refreshRoomList();
        } catch (err) {
          this._setOnlineStatus(err.message || String(err), true);
          this._setServiceStatus(false);
        } finally {
          btnHost.disabled = false;
        }
      });
    }

    btnEnterRoom?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!this.net?.room) {
        this._setOnlineStatus('没有可进入的房间', true);
        return;
      }
      btnEnterRoom.disabled = true;
      this._setOnlineStatus('同步房间状态…');
      try {
        // 权威快照：避免等待期间好友改方块后仍用建房瞬间的旧 edits
        const snap = await this.net.sync();
        const msg = {
          room: snap.room || this.net.room,
          title: snap.title || this._pendingJoinMsg?.title,
          edits: snap.edits,
          mobs: snap.mobs,
          boss: snap.boss,
          self: snap.self,
          players: snap.players,
          id: this.net.id,
          color: this.net.color,
          seed: snap.seed,
        };
        this._pendingJoinMsg = msg;
        this._stopRoomPoll();
        this._hostWaiting = false;
        this._hideWaitingPanel();
        this._enterFromOnline(msg);
      } catch (err) {
        this._setOnlineStatus(err.message || String(err), true);
      } finally {
        btnEnterRoom.disabled = false;
      }
    });

    btnCancelHost?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.net.disconnect();
      this._hostWaiting = false;
      this._online = false;
      this._pendingJoinMsg = null;
      this._hideWaitingPanel();
      this._setOnlineStatus('已关闭房间');
      this._startRoomPoll();
    });

    if (btnJoin) {
      btnJoin.addEventListener('click', (e) => {
        e.stopPropagation();
        joinByCode(roomInput?.value);
      });
    }

    roomInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        joinByCode(roomInput.value);
      }
    });

    btnRefresh?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._refreshRoomList(true);
    });

    roomList?.addEventListener('click', (e) => {
      const row = e.target.closest('[data-room]');
      if (!row) return;
      e.stopPropagation();
      if (row.dataset.full === '1') {
        this._setOnlineStatus('房间已满', true);
        return;
      }
      if (this._hostWaiting && this.net?.room === row.dataset.room) {
        this._setOnlineStatus('这是你自己的房间，请点「进入游戏」');
        return;
      }
      joinByCode(row.dataset.room);
    });

    this._probeService();
    this._startRoomPoll();

    // ?room=ABCD → 自动填码，方便分享链接
    try {
      const deep = new URLSearchParams(location.search).get('room');
      if (deep && roomInput) {
        roomInput.value = deep.toUpperCase().trim();
        this._setOnlineStatus(`已填入房间码 ${roomInput.value}，点「加入」或列表进房`);
      }
    } catch { /* */ }
  }

  _showWaitingPanel(msg) {
    const panel = document.getElementById('waitingPanel');
    if (!panel) return;
    panel.style.display = 'block';
    const codeEl = document.getElementById('waitingCode');
    const titleEl = document.getElementById('waitingTitle');
    if (codeEl) codeEl.textContent = msg.room;
    if (titleEl) titleEl.textContent = msg.title || msg.room;
    this._updateWaitingPanel();
    const copyBtn = document.getElementById('btnCopyWaiting');
    if (copyBtn) {
      copyBtn.onclick = (ev) => {
        ev.stopPropagation();
        const invite = `${location.origin}/?room=${encodeURIComponent(msg.room)}`;
        navigator.clipboard?.writeText(invite).then(
          () => this._setOnlineStatus('邀请链接已复制'),
          () => {
            navigator.clipboard?.writeText(msg.room).then(() => this._setOnlineStatus('房间码已复制'));
          }
        );
      };
      copyBtn.title = '复制邀请链接';
      copyBtn.textContent = '复制链接';
    }
  }

  _hideWaitingPanel() {
    const panel = document.getElementById('waitingPanel');
    if (panel) panel.style.display = 'none';
  }

  _updateWaitingPanel() {
    if (!this._hostWaiting) return;
    const el = document.getElementById('waitingPlayers');
    if (!el) return;
    const n = 1 + (this.remotes?.map.size || 0);
    const names = ['你', ...[...(this.remotes?.map.values() || [])].map((e) => e.label?.textContent || '玩家')];
    el.textContent = `在线 ${n} 人：${names.join('、')}`;
  }

  async _probeService() {
    try {
      const r = await fetch(`/api/health?t=${Date.now()}`, { cache: 'no-store' });
      this._setServiceStatus(r.ok);
      if (!r.ok) this._setOnlineStatus('联机服务异常', true);
    } catch {
      this._setServiceStatus(false);
      this._setOnlineStatus('无法连接联机服务', true);
    }
  }

  _setServiceStatus(ok) {
    const el = document.getElementById('serviceStatus');
    if (!el) return;
    if (ok === null) {
      el.textContent = '检测中…';
      el.className = 'service-status';
      return;
    }
    el.textContent = ok ? '联机服务正常' : '联机服务异常';
    el.className = 'service-status ' + (ok ? 'ok' : 'bad');
  }

  _startRoomPoll() {
    if (this._roomPollTimer) return;
    this._refreshRoomList();
    this._roomPollTimer = setInterval(() => {
      if (this.isRunning && !this._hostWaiting) {
        this._stopRoomPoll();
        return;
      }
      if (this.ui.startScreen.style.display === 'none' && !this._hostWaiting) {
        this._stopRoomPoll();
        return;
      }
      this._refreshRoomList();
    }, 2500);
  }

  _stopRoomPoll() {
    if (this._roomPollTimer) {
      clearInterval(this._roomPollTimer);
      this._roomPollTimer = null;
    }
  }

  async _refreshRoomList(manual = false) {
    const listEl = document.getElementById('roomList');
    const metaEl = document.getElementById('roomListMeta');
    if (!listEl) return;
    if (this._refreshingRooms) return;
    this._refreshingRooms = true;
    if (manual) this._setOnlineStatus('刷新中…');
    try {
      const rooms = await NetClient.fetchRooms();
      if (manual) this._setOnlineStatus('');
      this._setServiceStatus(true);
      this._renderRoomList(rooms);
      if (metaEl) {
        const t = new Date();
        const p = (n) => String(n).padStart(2, '0');
        metaEl.textContent = `${rooms.length} 个公开房间 · ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
      }
    } catch (err) {
      this._setServiceStatus(false);
      listEl.innerHTML = `<div class="room-empty err">房间列表不可用：${err.message || err}</div>`;
      if (metaEl) metaEl.textContent = '';
      if (manual) this._setOnlineStatus(err.message || String(err), true);
    } finally {
      this._refreshingRooms = false;
    }
  }

  _renderRoomList(rooms) {
    const listEl = document.getElementById('roomList');
    if (!listEl) return;
    if (!rooms.length) {
      listEl.innerHTML = '<div class="room-empty" id="roomEmpty">暂无公开房间 —— 右侧点「创建公开房间」后，其他人会在这里看到</div>';
      return;
    }
    const esc = (s) => String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const myCode = this._hostWaiting ? (this.net?.room || '') : '';
    listEl.innerHTML = rooms.map((r) => {
      const full = r.full || r.players >= r.max;
      const mine = myCode && r.code === myCode;
      const names = (r.names || []).slice(0, 4).map(esc).join('、');
      const more = (r.names || []).length > 4 ? '…' : '';
      const age = r.ageSec < 60 ? `${r.ageSec}秒` : `${Math.floor(r.ageSec / 60)}分`;
      const cta = mine ? '你的房' : (full ? '已满' : '加入 →');
      return `
        <button type="button" class="room-row${full ? ' full' : ''}${mine ? ' mine' : ''}"
          data-room="${esc(r.code)}" data-full="${full ? '1' : '0'}"
          ${full && !mine ? 'disabled' : ''}>
          <span class="room-row-main">
            <span class="room-title">${esc(r.title || r.code)}</span>
            <span class="room-code">${esc(r.code)}</span>
          </span>
          <span class="room-row-sub">
            <span>房主 ${esc(r.host || '?')}</span>
            <span>${r.players}/${r.max} 人</span>
            <span>${r.edits || 0} 改动</span>
            <span>${age}</span>
          </span>
          <span class="room-row-names">${names}${more}</span>
          <span class="room-row-cta">${cta}</span>
        </button>`;
    }).join('');
  }

  _showGameUI(show) {
    const display = show ? 'flex' : 'none';
    this.ui.crosshair.style.display = show ? 'block' : 'none';
    this.ui.selectedBlockName.style.display = show ? 'block' : 'none';
    this.ui.hotbar.style.display = this.isMobile ? 'none' : display; // 桌面端物品栏
    this.ui.debugInfo.style.display = show ? 'block' : 'none';
    this.ui.blockHighlight.style.display = 'none'; // 已禁用
    const hp = document.getElementById('hpHud');
    if (hp) hp.style.display = show ? 'flex' : 'none';
    const dim = document.getElementById('dimHud');
    if (dim) dim.style.display = show ? 'block' : 'none';
    if (show) this._updateDimHud();
    this._updateBossHud(show);
    // 右上角操作说明面板（仅桌面端）
    if (!this.isMobile) {
      this.ui.controlsPanel.style.display = show ? 'flex' : 'none';
    }
    // 移动端控件：仅在移动端显示
    if (this.isMobile) {
      const mobileControls = document.getElementById('mobileControls');
      if (mobileControls) mobileControls.style.display = show ? 'block' : 'none';
    }
  }

  /** 窗口大小变化处理 */
  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** 调整视野角度（FOV） */
  _adjustFOV(delta) {
    this.fov = Math.max(this.fovMin, Math.min(this.fovMax, this.fov + delta));
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this._showFOVHint();
  }

  /** 重置视野到默认值 */
  _resetFOV() {
    this._adjustFOV(this.defaultFov - this.fov);
  }

  /** 短暂显示 FOV 提示 */
  _showFOVHint() {
    if (this._fovHintTimer) clearTimeout(this._fovHintTimer);
    let hint = document.getElementById('fovHint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'fovHint';
      hint.style.cssText =
        'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
        'color:#fff;font-size:28px;font-weight:bold;' +
        'text-shadow:0 2px 8px rgba(0,0,0,0.6);pointer-events:none;z-index:100;' +
        'transition:opacity 0.3s;';
      document.body.appendChild(hint);
    }
    hint.textContent = `FOV: ${this.fov.toFixed(0)}°`;
    hint.style.opacity = '1';
    this._fovHintTimer = setTimeout(() => {
      hint.style.opacity = '0';
    }, 1200);
  }

  /** 更新调试信息 */
  _updateDebugInfo() {
    const pos = this.player.position;
    const cx = Math.floor(pos.x / CHUNK_SIZE);
    const cz = Math.floor(pos.z / CHUNK_SIZE);
    const chunks = this.world.chunks.size;

    this.ui.debugInfo.innerHTML =
      `FPS: ${this.fps}<br>` +
      `FOV: ${this.fov.toFixed(0)}°<br>` +
      `XYZ: ${pos.x.toFixed(1)} / ${pos.y.toFixed(1)} / ${pos.z.toFixed(1)}<br>` +
      `区块: ${cx}, ${cz} | 已加载: ${chunks}<br>` +
      `生物: ${this.animalManager ? this.animalManager.animals.length : 0}` +
      (this._dragon ? ` · 龙:${this._dragon.hp}` : '') + `<br>` +
      `维度: ${this.dimension}<br>` +
      `存档改动: ${this.world.edits.size}` +
      (this._online ? `<br>联机: ${this.net.room} (${1 + this.remotes.map.size}人)` : '');

    // 目标方块提示（已禁用）
    this.ui.blockHighlight.style.display = 'none';
  }

  /** 主游戏循环 */
  animate() {
    requestAnimationFrame(() => this.animate());

    const dt = this.clock.getDelta();

    // FPS 计算
    this.frameCount++;
    this.fpsTime += dt;
    if (this.fpsTime >= 1) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.fpsTime = 0;
    }

    // 移动端：从触控控制器注入键盘输入
    if (this.isMobile && this.touchController && this.isRunning) {
      const tc = this.touchController;
      const deadZone = 0.15;
      const absX = Math.abs(tc.moveX);
      const absZ = Math.abs(tc.moveZ);
      this.player.keys['KeyW'] = tc.moveZ < -deadZone;
      this.player.keys['KeyS'] = tc.moveZ > deadZone;
      this.player.keys['KeyA'] = tc.moveX < -deadZone;
      this.player.keys['KeyD'] = tc.moveX > deadZone;
    }

    // 桌面端指针锁定 或 移动端运行时更新游戏逻辑
    if (!this._dead && this.isRunning && (this.isPointerLocked || this.isMobile)) {
      const hpBefore = this.player.hp;
      this.player.update(dt);
      if (this.player.hp < hpBefore) {
        this._lastDamageBy = '';
        if (this._online) this.net._send({t:'player_hurt',hp:this.player.hp});
      }
      this.world.update(this.player.position.x, this.player.position.z);
      this.highlight.update(this.player.targetBlock);
      this._refreshEntityTarget();
      this._updateHpHud();
      this._tickPortal(dt);
      if (this._online && this.net) this.net.tickMove(dt, this.player, this.dimension);
      const damage = !this._online ? (this._mistBoss?.update(dt, this.player) || 0) : 0;
      if (damage > 0 && this.player.hp > 0) {
        this.player.hp = Math.max(0, this.player.hp - damage);
        this.player.invuln = .6;
        this._lastDamageBy = 'mist-boss';
        this._dirtySinceSave = true;
        this._updateHpHud();
      }
      this._updateBossHud();
      if (this.player.hp <= 0) this._showDeathScreen();
    }

    if (this._online && this._mistBoss) this._mistBoss.update(dt,this.player);
    if (this.remotes) this.remotes.update(dt, this.camera);

    if (this.animalManager) this.animalManager.update(dt);
    if (this._dragon) this._dragon.update(dt);

    // 渲染
    this.renderer.render(this.scene, this.camera);

    // 更新UI（降低更新频率）
    if (this.frameCount % 10 === 0) {
      this._updateDebugInfo();
    }
  }
}

/* ============================================
   启动游戏
   ============================================ */
window.addEventListener('DOMContentLoaded', async () => {
  const game = new Game();
  await game.init();
  game.animate();
});
