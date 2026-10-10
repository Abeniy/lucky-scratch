/* 幸运刮刮乐 · Roguelike（独立 HTML 版）
 * 步骤2：数据层与 localStorage 存档
 * 步骤3：连续刮痕引擎（Canvas destination-out + 轨迹插值）
 *  + 卡头 / 正方形刮奖网格 / 逐格揭晓单独弹出
 * 步骤4：判奖逻辑 + RTP 蒙特卡洛微调 + 购买/结算/升级闭环
 * 步骤5：肉鸽升级三选一增益（持久叠加，接入购买/发牌/结算/破产）
 * 步骤6：刮具系统（佩戴1件 · 持久拥有 · 等级/商店/肉鸽获取；接入发牌+结算）
 */
(function () {
  'use strict';

  /* ===== 常量配置 ===== */
  const STORAGE_KEY = 'lucky-scratch';
  const LEVEL_THRESHOLDS = [0, 250, 700, 1800, 4500, 10000, 26000, 65000];
  const MAX_LEVEL = LEVEL_THRESHOLDS.length;

  // 卡片定义（含卡头主题 / 中奖要求 / 带权重符号池 / 判奖配置 prize）
  // pool 项：{ s 符号, w 权重, label 名称, pay 赔付/罚金说明, danger 是否为扣分项 }
  // prize 由 judge() 解读，赔付数值经 20 万次蒙特卡洛模拟微调，逼近策划目标 RTP。
  const CARD_DEFS = [
    { id: 'copper',  name: '铜板卡', price: 10,  art: '🪙', artClass: 'card-art-copper', skin: 'copper',       coatSrc: 'assets/cards/copper_scratch_1676.png',
      coatGrid: { x: 0.494, y: 0.3831, w: 0.4087, h: 0.4051 },
      coatShift: { x: 0, y: 0 },
      coatScale: 1,
      scratchGrid: { x: 0.494, y: 0.3831, w: 0.4087, h: 0.4051 },
      sub: '古朴铜钱 · 安全爬坡',
      grad: 'linear-gradient(135deg,#8a5a1f,#caa24a)', rows: 3, cols: 3,
      rule: '刮出三个相同图案即可获胜！',
      pool: [
        { s: 'coin',    img: 'assets/cards/sym_coin.png',    w: 45, label: '铜板', pay: '+6' },
        { s: 'yuanbao', img: 'assets/cards/sym_yuanbao.png', w: 35, label: '元宝', pay: '+12' },
        { s: 'hulu',    img: 'assets/cards/sym_hulu.png',    w: 18, label: '葫芦', pay: '+30' },
        { s: 'hongbao', img: 'assets/cards/sym_hongbao.png', w: 2,  label: '红包', pay: '+120' },
      ],
      prize: { kind: 'match', face: { coin: 6, yuanbao: 12, hulu: 30, hongbao: 120 } } },
    { id: 'orchard', name: '果园卡', price: 25,  art: '🍎', artClass: 'card-art-orchard', skin: 'orchard', sub: '清新果园 · 集齐水果',
      coatSrc: 'assets/cards/orchard_scratch.png',
      coatGrid: { x: 0.2953, y: 0.2578, w: 0.4105, h: 0.3908 },
      scratchGrid: { x: 0.2953, y: 0.2578, w: 0.4105, h: 0.3908 },
      grad: 'linear-gradient(135deg,#1f7a3a,#7ad07a)', rows: 3, cols: 3,
      rule: '全刮出水果获胜！同水果 3/4/5/6+ 个 +15/+35/+45/+60；小心枯叶！',
      pool: [
        { s: 'apple',      img: 'assets/cards/sym_apple.png',      w: 21, label: '苹果', pay: '集齐 +112' },
        { s: 'orange',     img: 'assets/cards/sym_orange.png',     w: 21, label: '橘子', pay: '集齐 +112' },
        { s: 'grape',      img: 'assets/cards/sym_grape.png',      w: 20, label: '葡萄', pay: '集齐 +112' },
        { s: 'strawberry', img: 'assets/cards/sym_strawberry.png', w: 20, label: '草莓', pay: '集齐 +112' },
        { s: 'leaf',       img: 'assets/cards/sym_leaf.png',       w: 18, label: '枯叶', pay: '破坏全水果', danger: true },
      ],
      prize: { kind: 'collect', bad: 'leaf', allPrize: 112,
        tiers: { 3: 15, 4: 35, 5: 45, 6: 60, 7: 60, 8: 60, 9: 60 } } },
    { id: 'mine',    name: '矿洞卡', price: 60,  art: '💎', artClass: 'card-art-mine', skin: 'mine', sub: '幽暗矿洞 · 含塌方💣',
      coatSrc: 'assets/cards/mine_scratch.png',
      coatGrid: { x: 0.5006, y: 0.3297, w: 0.389, h: 0.3872 },
      scratchGrid: { x: 0.5009, y: 0.3324, w: 0.388, h: 0.3833 },
      grad: 'linear-gradient(135deg,#2a3550,#5a7aa0)', rows: 3, cols: 3,
      rule: '全刮出矿石获得头奖！刮出同种矿石 3/4/5/6+ 个获得 +16/+42/+95/+205。小心炸弹！',
      pool: [
        { s: 'iron',    img: 'assets/cards/sym_iron.png',    w: 28, label: '铁矿', pay: '全矿石 +450' },
        { s: 'gold',    img: 'assets/cards/sym_gold.png',    w: 27, label: '金矿', pay: '全矿石 +450' },
        { s: 'diamond', img: 'assets/cards/sym_diamond.png', w: 25, label: '钻石', pay: '全矿石 +450' },
        { s: 'bomb',    img: 'assets/cards/sym_bomb.png',    w: 20, label: '炸弹', pay: '每个 -20', danger: true },
      ],
      prize: { kind: 'collect', bad: 'bomb', allPrize: 450, penaltyPer: 20,
        tiers: { 3: 16, 4: 42, 5: 95, 6: 205, 7: 205, 8: 205, 9: 205 } } },
    { id: 'casino',  name: '赌城卡', price: 150, art: '🎰', artClass: 'card-art-casino', skin: 'casino', sub: '霓虹赌场 · 777通杀',
      coatSrc: 'assets/cards/casino_scratch.png',
      coatGrid: { x: 0.2535, y: 0.3329, w: 0.4811, h: 0.4319 },
      scratchGrid: { x: 0.2535, y: 0.3329, w: 0.4811, h: 0.4319 },
      grad: 'linear-gradient(135deg,#7a1f4f,#d04bff)', rows: 3, cols: 3,
      rule: '任意一整行相同即中奖！小心炸弹！',
      pool: [
        { s: 'bell',   img: 'assets/cards/sym_bell.png',   w: 30, label: '铃铛', pay: '整行 +770' },
        { s: 'cherry', img: 'assets/cards/sym_cherry.png', w: 30, label: '樱桃', pay: '整行 +770' },
        { s: 'seven',  img: 'assets/cards/sym_seven.png',  w: 22, label: '幸运7', pay: '整行 +1970' },
        { s: 'crown',  img: 'assets/cards/sym_crown.png',  w: 8,  label: '皇冠', pay: '通杀 +5500' },
        { s: 'bomb',   img: 'assets/cards/sym_bomb.png',   w: 10, label: '炸弹', pay: '每个 -60', danger: true },
      ],
      prize: { kind: 'lines', dirs: ['row'], bad: 'bomb', penaltyPer: 60,
        linePay: { bell: 770, cherry: 770, seven: 1970, crown: 5500 } } },
    { id: 'star',    name: '星海卡', price: 400, art: '🌌', artClass: 'card-art-star', skin: 'star', sub: '深空星海 · 极限波动',
      coatSrc: 'assets/cards/star_scratch.png',
      coatGrid: { x: 0.5338, y: 0.3477, w: 0.3513, h: 0.3467 },
      scratchGrid: { x: 0.5341, y: 0.3492, w: 0.3508, h: 0.3454 },
      grad: 'linear-gradient(135deg,#241b5a,#6a4bff)', rows: 3, cols: 3,
      rule: '任意一条连线（横/竖/斜）相同即中奖！',
      pool: [
        { s: 'xingxing', img: 'assets/cards/sym_xingxing.png?v=2', w: 30, label: '星星', pay: '连线 +925' },
        { s: 'hengxing', img: 'assets/cards/sym_hengxing.png?v=3', w: 28, label: '恒星', pay: '连线 +670' },
        { s: 'liuxing',  img: 'assets/cards/sym_liuxing.png',  w: 22, label: '流星', pay: '连线 +460' },
        { s: 'xingyun',  img: 'assets/cards/sym_xingyun.png?v=2',  w: 12, label: '星云', pay: '连线 +9200' },
        { s: 'heidong',  img: 'assets/cards/sym_heidong.png?v=2',  w: 8,  label: '黑洞', pay: '每个 -150', danger: true },
      ],
      prize: { kind: 'lines', dirs: ['row', 'col', 'diag'], bad: 'heidong', penaltyPer: 150,
        linePay: { liuxing: 460, hengxing: 670, xingxing: 925, xingyun: 9200 } } },
    { id: 'spacetime', name: '时空卡', price: 1000, art: '⏳', artClass: 'card-art-spacetime', skin: 'spacetime', sub: '平行时空 · 双线取优',
      coatSrc: 'assets/cards/spacetime_scratch.png',
      coatGrid: { x: 0.2664, y: 0.2591, w: 0.4684, h: 0.4574 },
      scratchGrid: { x: 0.2652, y: 0.2603, w: 0.4696, h: 0.455 },
      grad: 'linear-gradient(135deg,#3a2a6a,#9b6bff)', rows: 3, cols: 3,
      rule: '任意连线相同即中奖！小心雷击！',
      pool: [
        { s: 'shalou',      img: 'assets/cards/sym_shalou.png',      w: 34, label: '沙漏', pay: '连线 +650' },
        { s: 'xuanwo',      img: 'assets/cards/sym_xuanwo.png',      w: 28, label: '漩涡', pay: '连线 +1180' },
        { s: 'shuijingqiu', img: 'assets/cards/sym_shuijingqiu.png', w: 22, label: '水晶球', pay: '连线 +1970' },
        { s: 'jingzi',      img: 'assets/cards/sym_jingzi.png',      w: 9,  label: '镜子', pay: '连线 +10500' },
        { s: 'leiji',       img: 'assets/cards/sym_leiji.png',       w: 7,  label: '雷击', pay: '每枚 -当前余额12%', danger: true },
      ],
      prize: { kind: 'twin', coinPenaltyPct: 0.12,
        base: { kind: 'lines', dirs: ['row', 'col', 'diag'], bad: 'leiji', penaltyPer: 0,
          linePay: { shalou: 650, xuanwo: 1180, shuijingqiu: 1970, jingzi: 10500 } } } }
  ];
  const CARD_MAP = {};
  CARD_DEFS.forEach((c) => { CARD_MAP[c.id] = c; });

  /* ===== 默认存档 ===== */
  function defaultState() {
    return {
      coins: 100,
      level: 1,
      unlockedCards: ['copper'],
      ownedTools: ['coin'],
      equippedTool: 'coin',
      perks: [],
      combo: 0,
      burstEnergy: 0, // 爆奖蓄能：0.1 表示中奖额 +10%
      stats: { maxCoins: 100, biggestJackpot: 0, totalScratches: 0, bankruptcies: 0 },
    };
  }
  let state = defaultState();

  /* ===== 持久化 ===== */
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { console.warn('[lucky-scratch] 存档失败', e); }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { state = defaultState(); save(); return; }
      const parsed = JSON.parse(raw);
      const base = defaultState();
      state = Object.assign(base, parsed, { stats: Object.assign(base.stats, parsed.stats || {}) });
      if (Array.isArray(state.perks)) state.perks = state.perks.filter((id) => PERK_MAP[id]);
    } catch (e) {
      console.warn('[lucky-scratch] 读档失败，使用默认档', e);
      state = defaultState();
    }
  }
  function reset() {
    state = defaultState();
    save(); render();
    setStatus('已清档，重新开始吧');
  }

  /* ===== 等级进度 ===== */
  function levelInfo() {
    const lv = Math.min(state.level, MAX_LEVEL);
    if (lv >= MAX_LEVEL) return { isMax: true, percent: 100, toNext: 0, nextThreshold: null };
    const curBase = LEVEL_THRESHOLDS[lv - 1];
    const nextThreshold = LEVEL_THRESHOLDS[lv];
    const span = nextThreshold - curBase;
    const cur = Math.max(0, state.coins - curBase);
    return {
      isMax: false,
      percent: Math.max(0, Math.min(100, (cur / span) * 100)),
      toNext: Math.max(0, nextThreshold - state.coins),
      nextThreshold,
    };
  }

  /* ===== DOM 引用 ===== */
  const els = {
    coinValue: document.getElementById('coinValue'),
    levelText: document.getElementById('levelText'),
    levelHint: document.getElementById('levelHint'),
    levelFill: document.getElementById('levelFill'),
    recordValue: document.getElementById('recordValue'),
    perkBar: document.getElementById('perkBar'),
    shopList: document.getElementById('shopList'),
    shopPrev: document.getElementById('shopPrev'),
    shopNext: document.getElementById('shopNext'),
    shopPageLabel: document.getElementById('shopPageLabel'),
    toolList: document.getElementById('toolList'),
    toolTip: document.getElementById('toolTip'),
    toolTipText: document.getElementById('toolTipText'),
    scratchArea: document.getElementById('scratchArea'),
    cardInfo: document.getElementById('cardInfo'),
    statusMsg: document.getElementById('statusMsg'),
    debugBtn: document.getElementById('debugBtn'),
    debugPanel: document.getElementById('debugPanel'),
    dbgUnlockAll: document.getElementById('dbgUnlockAll'),
    dbgLevelUp: document.getElementById('dbgLevelUp'),
    dbgReset: document.getElementById('dbgReset'),
  };
  function setStatus(msg) { if (els.statusMsg) els.statusMsg.textContent = msg; }
  function initHudLayout() { syncHudSide(); fitStage(); }

  /* ===== 布局自适应 =====
     刮具栏：贴右边缘，独立缩放（高度不足时整体等比缩小，保证五个刮具完整可见）
     舞台单元（卡片 + 购入栏）：左右对称预留"刮具栏区 + 隐形边界"，所以永不重叠且保持居中 */
  const STAGE_SAFE = 16;     // 上下各留的安全边
  const TOOLS_GAP = 24;      // 卡片与刮具栏之间的隐形边界
  const TOOLS_RIGHT = 50;    // 刮具栏距右边缘

  // 返回上下被占用的高度，以及可用区中心
  function stageMetrics() {
    const vw = window.innerWidth, vh = window.innerHeight;
    let topOcc = 0;
    ['.topbar', '.perk-bar'].forEach((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.height > 0) topOcc = Math.max(topOcc, r.bottom);
    });
    let botOcc = 0;
    const status = document.querySelector('.statusbar');
    if (status) {
      const r = status.getBoundingClientRect();
      if (r.height > 0) botOcc = Math.max(0, vh - r.top);
    }
    return {
      vw: vw, vh: vh,
      topOcc: topOcc, botOcc: botOcc,
      availH: Math.max(120, vh - topOcc - botOcc - STAGE_SAFE * 2),
      safeCenter: (topOcc + (vh - botOcc)) / 2,
    };
  }

  // 刮具栏：整体等比缩放并垂直居中于可用区
  function fitTools(m) {
    const tools = document.querySelector('.tools');
    if (!tools) return { w: 178, h: 0 };
    const nw = tools.offsetWidth || 128;     // offsetWidth/Height 不受 transform 影响
    const nh = tools.offsetHeight || 592;
    // 高度不够就整体缩小；同时限制缩放后的宽度不超过视口的 28%
    const k = Math.min(1, m.availH / nh, (m.vw * 0.28) / nw);
    tools.style.transform = 'scale(' + k + ')';
    // 垂直居中于可用区：上边缘 = 可用区中心 − 自然高度/2（缩放绕中心，中心不变）
    tools.style.top = Math.round(m.safeCenter - nh / 2) + 'px';
    return { w: nw * k, h: nh * k, k: k };
  }

  function fitStage() {
    const game = document.getElementById('game');
    if (!game) return;
    const m = stageMetrics();
    const tools = fitTools(m);
    // 左右对称预留「刮具栏实宽 + 右边距 + 隐形边界」，卡片因此永远碰不到刮具栏，且仍居中
    const reserve = Math.min(tools.w + TOOLS_RIGHT + TOOLS_GAP, m.vw * 0.28);
    const availW = Math.max(160, m.vw - reserve * 2);
    const naturalW = game.offsetWidth || 920;
    const naturalH = game.offsetHeight || 940;
    const k = Math.min(1, m.availH / naturalH, availW / naturalW);
    const offset = (m.topOcc - m.botOcc) / 2;   // 把"视口中心"修正为"可用区中心"
    game.style.transform = 'translateY(' + offset + 'px) scale(' + k + ')';
  }
  window.addEventListener('resize', fitStage);
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => fitStage());
    const perk = document.querySelector('.perk-bar');
    if (perk) ro.observe(perk);
  }

  /* ===== 顶栏隐形边界：按得分控件实际宽度维护两侧预留区，保证等级条不被遮挡且居中 ===== */
  const HUD_GUTTER = 24;   // 得分控件与等级条之间的隐形间隙
  function syncHudSide() {
    const coins = document.querySelector('.coins');
    if (!coins) return;
    const w = Math.ceil(coins.getBoundingClientRect().width);
    if (!w) return;
    // 夹在合理区间，避免异常值把栅格撑爆
    const side = Math.min(Math.max(w + HUD_GUTTER, 140), 460);
    document.documentElement.style.setProperty('--hud-side', side + 'px');
  }
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(syncHudSide);
    const coinsEl = document.querySelector('.coins');
    if (coinsEl) ro.observe(coinsEl);
  }
  window.addEventListener('resize', syncHudSide);

  /* ===== 调试模式：解锁全部卡片与刮具，并把得分设为 10000 ===== */
  const DEBUG_COINS = 10000;
  function enterDebugMode() {
    state.unlockedCards = CARD_DEFS.map((c) => c.id);
    state.ownedTools = TOOL_DEFS.map((t) => t.id);
    state.coins = DEBUG_COINS;
    if (!state.stats) state.stats = {};
    if (state.stats.maxCoins < state.coins) state.stats.maxCoins = state.coins;
    // 等级同步到能容纳这些卡片的档位，避免出现已解锁但等级不足的显示异常
    const needLevel = Math.min(MAX_LEVEL, CARD_DEFS.length);
    if (state.level < needLevel) state.level = needLevel;
    save();
    render();
    setStatus('🔧 调试模式：已解锁全部 ' + CARD_DEFS.length + ' 张卡片与全部刮具，得分 ' + DEBUG_COINS);
  }
  /* ===== 调试：升一级（补足到下一级所需得分，走正常升级流程，用于测试增益） ===== */
  function debugLevelUp() {
    if (state.level >= MAX_LEVEL) { setStatus('🔧 调试：已是最高等级 Lv.' + MAX_LEVEL); return; }
    const need = LEVEL_THRESHOLDS[state.level];
    if (state.coins < need) {
      state.coins = need;
      if (state.coins > state.stats.maxCoins) state.stats.maxCoins = state.coins;
    }
    const up = checkLevelUp();
    save(); render();
    if (up.tools && up.tools.length) {
      queueToolUnlockPopups(up.tools, () => { if (up.levels > 0) queuePerkChoices(up.levels); });
    } else if (up.levels > 0) {
      queuePerkChoices(up.levels);
    }
    setStatus('🔧 调试：升至 Lv.' + state.level + '（得分 ' + state.coins + '）');
  }
  /* ===== 铜板卡底图对齐校准 ===== */
  const COPPER_ALIGN_KEY = 'lucky-copper-align';
  let copperAlign = { x: 0, y: 0, s: 1 };
  let copperCalibOn = false;
  function applyCopperAlign() {
    const a = els.scratchArea;
    if (!a) return;
    a.style.setProperty('--card-offx', copperAlign.x + 'px');
    a.style.setProperty('--card-offy', copperAlign.y + 'px');
    a.style.setProperty('--card-scale', String(copperAlign.s));
  }
  // 校准偏移只在当前会话生效，不写入 localStorage：
  // 否则 IDE 预览与浏览器/单文件版会读到不同的偏移，导致两边显示不一致。
  function loadCopperAlign() {
    copperAlign = { x: 0, y: 0, s: 1 };
    applyCopperAlign();
  }
  function saveCopperAlign() {
    /* 不持久化，保持各环境一致 */
  }
  function calibKeyHandler(e) {
    if (!copperCalibOn) return;
    const step = e.shiftKey ? 10 : 1;
    let used = true;
    switch (e.key) {
      case 'ArrowLeft': copperAlign.x -= step; break;
      case 'ArrowRight': copperAlign.x += step; break;
      case 'ArrowUp': copperAlign.y -= step; break;
      case 'ArrowDown': copperAlign.y += step; break;
      case '+': case '=': copperAlign.s = Math.round((copperAlign.s + 0.01) * 100) / 100; break;
      case '-': case '_': copperAlign.s = Math.round((copperAlign.s - 0.01) * 100) / 100; break;
      case 'r': case 'R': copperAlign = { x: 0, y: 0, s: 1 }; break;
      case 'Escape': setCopperCalibration(false); saveCopperAlign(); return;
      default: used = false;
    }
    if (used) {
      e.preventDefault();
      applyCopperAlign();
      saveCopperAlign();
      console.log('[copper align]', JSON.stringify(copperAlign));
    }
  }
  function setCopperCalibration(on) {
    copperCalibOn = !!on;
    if (copperCalibOn) {
      document.addEventListener('keydown', calibKeyHandler);
      setStatus('🔧 校准模式：方向键移动底图（Shift=10px），+/- 缩放，R 重置，Esc 保存退出');
      console.log('[copper align] 当前值', JSON.stringify(copperAlign));
    } else {
      document.removeEventListener('keydown', calibKeyHandler);
      saveCopperAlign();
      setStatus('校准完成并已保存：' + JSON.stringify(copperAlign));
    }
  }

  function cardArtHtml(card, cls) {
    return card && card.artClass
      ? '<span class="' + cls + ' card-art-img ' + card.artClass + '"></span>'
      : '<span class="' + cls + '">' + ((card && card.art) || '') + '</span>';
  }
  // 符号渲染：pool 里有 img 的用 PNG 素材，否则按原文本（emoji）输出
  function symbolHtml(card, s) {
    const p = card && card.pool && card.pool.find((q) => q.s === s);
    if (p && p.img) return '<img class="sym-img" src="' + p.img + '" alt="" draggable="false">';
    return s;
  }
  // 概率行：图案 + 数字概率（占原名称位置）+ 金额说明（已去掉名称与条形 UI）
  function cardOddsHtml(card) {
    const total = card.pool.reduce((s, p) => s + p.w, 0);
    return card.pool.map((p) => {
      const pct = (p.w / total) * 100;
      const payCls = p.danger ? 'od-pay danger' : 'od-pay';
      return (
        '<li>' +
          '<span class="od-sym">' + symbolHtml(card, p.s) + '</span>' +
          '<span class="od-pct">' + boldNumbers(pct.toFixed(1) + '%') + '</span>' +
          '<span class="' + payCls + '">' + boldNumbers(p.pay || '') + '</span>' +
        '</li>'
      );
    }).join('');
  }
  // 文本里的所有数字加粗（用于说明文案中的金额/数值）
  function boldNumbers(text) {
    return String(text == null ? '' : text).replace(/(\d+(?:\.\d+)?)/g, '<b class="num">$1</b>');
  }
  function inlineCardInfoHtml(card) {
    // 铜板卡：保留图案与数字，只去掉「出现概率」这个标题文字；「中奖要求」居中
    if (card && card.skin === 'copper') {
      return '<div class="inline-label">中奖要求</div>' +
        '<p class="inline-rule">' + boldNumbers(card.rule) + '</p>' +
        '<ul class="ci-odds inline-odds">' + cardOddsHtml(card) + '</ul>';
    }
    // 所有卡：去掉「出现概率」这四个字，直接列图案与概率
    return '<div class="inline-label">中奖要求</div>' +
      '<p class="inline-rule">' + card.rule + '</p>' +
      '<ul class="ci-odds inline-odds">' + cardOddsHtml(card) + '</ul>';
  }
  const SKIN_CLASS = {
    copper: 'card-skin-copper',
    orchard: 'card-skin-orchard',
    mine: 'card-skin-mine',
    casino: 'card-skin-casino',
    star: 'card-skin-star',
    spacetime: 'card-skin-spacetime',
  };

  const SHOP_PAGE_SIZE = 5;
  let shopPage = 0;
  function shopPageCount() { return Math.max(1, Math.ceil(CARD_DEFS.length / SHOP_PAGE_SIZE)); }
  // 翻页：delta = -1 上一页 / +1 下一页；已到边界则不处理，返回是否翻页成功
  function changeShopPage(delta) {
    const max = shopPageCount() - 1;
    const next = Math.max(0, Math.min(max, shopPage + delta));
    if (next === shopPage) return false;
    shopPage = next;
    renderShop();
    return true;
  }
  function cardUnlockLevel(cardId) {
    const idx = CARD_DEFS.findIndex((c) => c.id === cardId);
    return idx < 0 ? 1 : idx + 1;
  }
  function renderShop() {
    if (!els.shopList) return;
    const pageCount = shopPageCount();
    if (shopPage >= pageCount) shopPage = pageCount - 1;
    const start = shopPage * SHOP_PAGE_SIZE;
    const cards = CARD_DEFS.slice(start, start + SHOP_PAGE_SIZE);
    const html = [];
    for (let i = 0; i < SHOP_PAGE_SIZE; i++) {
      const card = cards[i];
      if (!card) {
        html.push('<button class="card-item card-slot empty" type="button" disabled aria-hidden="true"></button>');
        continue;
      }
      const unlocked = state.unlockedCards.includes(card.id);
      const cls = 'card-item card-slot' + (unlocked ? '' : ' locked');
      const price = cardPrice(card);
      html.push(
        '<button class="' + cls + '" type="button" data-card="' + card.id + '" aria-label="' + card.name + '：' + card.rule + '">' +
          cardArtHtml(card, 'card-emoji') +
          '<span class="card-name">' + card.name + '</span>' +
          '<span class="card-price">' + price + '</span>' +
          '<span class="card-lock">🔒Lv.' + cardUnlockLevel(card.id) + '</span>' +
        '</button>'
      );
    }
    els.shopList.innerHTML = html.join('');
    if (els.shopPrev) els.shopPrev.disabled = shopPage <= 0;
    if (els.shopNext) els.shopNext.disabled = shopPage >= pageCount - 1;
    if (els.shopPageLabel) els.shopPageLabel.textContent = (shopPage + 1) + '/' + pageCount;
  }

  /* ===== 渲染 ===== */
  function render() {
    els.coinValue.textContent = String(state.coins);
    const info = levelInfo();
    els.levelText.textContent = 'Lv.' + state.level;
    if (info.isMax) { els.levelHint.textContent = 'MAX'; els.levelFill.style.width = '100%'; }
    else { els.levelHint.textContent = '距下一级 ' + info.toNext; els.levelFill.style.width = info.percent.toFixed(1) + '%'; }
    els.recordValue.textContent = state.stats.maxCoins.toLocaleString();
    renderShop();
    renderTools();
    renderPerks();
  }

  /* =========================================================
   * 连续刮痕引擎（卡头 + 正方形刮奖网格 + 逐格揭晓）
   *  - 卡头始终可见，涂层只盖刮奖区；
   *  - 刮痕用 destination-out 沿轨迹连续擦除；
   *  - 按单元格采样：某格刮开比例达阈值 → 该格图案单独弹出，
   *    并清掉该格残余涂层；所有格揭晓后触发整体结算回调。
   * ========================================================= */
  const Scratch = {
    area: null, header: null, inlineInfo: null, zone: null, content: null, canvas: null, ctx: null,
    cssW: 0, cssH: 0, dpr: 1,
    rows: 3, cols: 3,
    currentCard: null,
    coatImg: null,
    cells: [],            // 每格 DOM 的 .sym 元素
    revealed: null,       // Set<number> 已揭晓格索引
    preReveal: [],        // 发牌即预揭的格索引（水晶球刮具）
    brush: 22,
    cellRevealRatio: 0.6, // 单格刮开比例阈值
    scratching: false, completed: false, enabled: false,
    lastX: 0, lastY: 0, activePointerId: null,
    _checkTimer: 0, _lastCheckAt: 0, _lastRawAt: 0,
    onReveal: null,
    onCellReveal: null,   // 单格被玩家刮出时回调(idx, symbol)，预揭格不触发
    _swapOutTimer: 0, _swapInTimer: 0,

    init(areaEl) {
      this.area = areaEl;
      areaEl.innerHTML = '';
      this.header = document.createElement('div');
      this.header.className = 'card-header';
      this.inlineInfo = document.createElement('div');
      this.inlineInfo.className = 'card-inline-info';
      this.zone = document.createElement('div');
      this.zone.className = 'scratch-zone';
      this.content = document.createElement('div');
      this.content.className = 'scratch-content';
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'scratch-canvas';
      this.zone.appendChild(this.content);
      this.zone.appendChild(this.canvas);
      areaEl.appendChild(this.header);
      areaEl.appendChild(this.inlineInfo);
      areaEl.appendChild(this.zone);
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      this._bind();
      updateScratchCursor();
    },

    // 发一张卡：card 含 art/name/sub/grad/rows/cols/symbols[]，可选 preReveal[] 预揭格索引
    deal(card, opts) {
      opts = opts || {};
      const renderCard = () => {
        this.rows = card.rows; this.cols = card.cols;
        this.currentCard = card;
        this.preReveal = card.preReveal || [];
        // 卡头
        Object.keys(SKIN_CLASS).forEach((skin) => {
          this.area.classList.toggle(SKIN_CLASS[skin], card.skin === skin);
        });
        if (this.inlineInfo) this.inlineInfo.innerHTML = SKIN_CLASS[card.skin] ? inlineCardInfoHtml(card) : '';
        this.header.style.background = card.grad;
        this.header.innerHTML =
          cardArtHtml(card, 'ch-art') +
          '<span class="ch-meta">' +
            '<span class="ch-name">' + card.name + '</span>' +
            '<span class="ch-sub">' + card.sub + '</span>' +
          '</span>';
        // 网格
        this.content.style.gridTemplateColumns = 'repeat(' + card.cols + ',1fr)';
        this.content.style.gridTemplateRows = 'repeat(' + card.rows + ',1fr)';
        this.content.innerHTML = '';
        this.cells = [];
        const total = card.rows * card.cols;
        for (let i = 0; i < total; i++) {
          const cell = document.createElement('div');
          cell.className = 'cell';
          const sym = document.createElement('span');
          sym.className = 'sym';
          sym.dataset.sym = card.symbols[i];
          sym.innerHTML = symbolHtml(card, card.symbols[i]);
          cell.appendChild(sym);
          this.content.appendChild(cell);
          this.cells.push(sym);
        }
        this.revealed = new Set();
        // 等布局完成后再测尺寸 + 铺涂层
        requestAnimationFrame(() => {
          this._resize();
          this._fitSymbols();
          this._coat();
          this.completed = false;
          this.enabled = true;
          this.canvas.classList.remove('done');
          // 预揭格（水晶球）：清掉涂层并弹出，计入已揭晓（silent：不触发刮出回调）
          this.preReveal.forEach((i) => { if (i >= 0 && i < this.cells.length && !this.revealed.has(i)) this._revealCell(i, true); });
          if (this.revealed.size === this.rows * this.cols) this._complete();
        });
      };
      clearTimeout(this._swapOutTimer); clearTimeout(this._swapInTimer);
      this.area.classList.remove('card-swap-out', 'card-swap-in');
      const canAnimate = opts.animateSwap && this.header && this.header.innerHTML;
      if (!canAnimate) { renderCard(); return; }
      this.enabled = false;
      this.scratching = false;
      this.area.classList.add('card-swap-out');
      this._swapOutTimer = setTimeout(() => {
        renderCard();
        this.area.classList.remove('card-swap-out');
        this.area.classList.add('card-swap-in');
        this._swapInTimer = setTimeout(() => { this.area.classList.remove('card-swap-in'); }, 260);
      }, 180);
    },

    _resize() {
      this.cssW = this.zone.clientWidth;
      this.cssH = this.zone.clientHeight;
      // 刮涂层需要频繁读像素。限制 DPR 可显著降低低性能电脑的 getImageData 压力，避免拖动掉帧断续。
      this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      this.canvas.width = Math.round(this.cssW * this.dpr);
      this.canvas.height = Math.round(this.cssH * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    },

    _gridRect() {
      const g = this.currentCard && this.currentCard.scratchGrid;
      if (!g) return { x: 0, y: 0, w: this.cssW, h: this.cssH };
      return { x: g.x * this.cssW, y: g.y * this.cssH, w: g.w * this.cssW, h: g.h * this.cssH };
    },

    // 按格子尺寸放大符号，增强填充感
    _fitSymbols() {
      const grid = this._gridRect();
      const cellW = grid.w / this.cols;
      const size = Math.floor(cellW * 0.62);
      this.cells.forEach((s) => { s.style.fontSize = size + 'px'; });
    },

    _coat() {
      const ctx = this.ctx, w = this.cssW, h = this.cssH;
      const src = this.currentCard && this.currentCard.coatSrc;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, w, h);
      if (src) {
        const drawCover = (img) => {
          ctx.globalCompositeOperation = 'source-over';
          ctx.clearRect(0, 0, w, h);
          // 把刮区图的九宫格精确映射到底图的九宫格上：
          // 缩放系数 = 底图格宽 / 刮区格宽，偏移让两个格子区域完全重合
          const sg = this.currentCard && this.currentCard.scratchGrid;
          const cg = this.currentCard && this.currentCard.coatGrid;
          if (!sg || !cg) { ctx.drawImage(img, 0, 0, w, h); return; }
          const kx = sg.w / cg.w;
          const ky = sg.h / cg.h;
          const dw = w * kx;
          const dh = h * ky;
          const sh = this.currentCard.coatShift || { x: 0, y: 0 };
          const dx = sg.x * w - cg.x * dw + sh.x;
          const dy = sg.y * h - cg.y * dh + sh.y;
          // 额外缩放：以九宫格中心为基准整体放大/缩小，保持中心不跑偏
          const cs = this.currentCard.coatScale || 1;
          if (cs === 1) { ctx.drawImage(img, dx, dy, dw, dh); return; }
          const cx = (sg.x + sg.w / 2) * w;
          const cy = (sg.y + sg.h / 2) * h;
          const fx = cx - (cx - dx) * cs;
          const fy = cy - (cy - dy) * cs;
          ctx.drawImage(img, fx, fy, dw * cs, dh * cs);
        };
        if (this.coatImg && this.coatImg.dataset.src === src && this.coatImg.complete) {
          drawCover(this.coatImg);
        } else {
          const img = new Image();
          img.dataset.src = src;
          img.onload = () => {
            if (this.currentCard && this.currentCard.coatSrc === src) drawCover(img);
          };
          img.src = src;
          this.coatImg = img;
        }
        return;
      }
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#3a3560'); g.addColorStop(0.5, '#565089'); g.addColorStop(1, '#2c2848');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 2;
      for (let x = -h; x < w; x += 14) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + h, h); ctx.stroke(); }
      ctx.fillStyle = 'rgba(0,240,255,0.8)';
      ctx.font = '700 15px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('✦ 刮 开 ✦', w / 2, h / 2);
    },

    _bind() {
      const c = this.canvas;
      const opts = { passive: false };
      c.addEventListener('pointerdown', (e) => this._down(e), opts);
      // 监听 window，配合 pointer capture，快速甩出画布边缘时也能继续连线。
      window.addEventListener('pointermove', (e) => this._move(e), opts);
      if ('onpointerrawupdate' in window) window.addEventListener('pointerrawupdate', (e) => this._move(e), opts);
      window.addEventListener('pointerup', (e) => this._up(e), opts);
      window.addEventListener('pointercancel', (e) => this._up(e), opts);
    },

    _pos(e) {
      const rect = this.canvas.getBoundingClientRect();
      const sx = this.cssW / rect.width, sy = this.cssH / rect.height;
      return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
    },

    _erase(x0, y0, x1, y1) {
      const ctx = this.ctx;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = this.brush * 2;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();

      // 低采样鼠标/低性能电脑上 pointermove 间距会很大；沿路径补圆点，确保高速拖动仍是连续刮痕。
      const dx = x1 - x0, dy = y1 - y0;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const step = Math.max(6, this.brush * 0.55);
      if (dist > step) {
        for (let d = step; d < dist; d += step) {
          const t = d / dist;
          ctx.beginPath();
          ctx.arc(x0 + dx * t, y0 + dy * t, this.brush, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.beginPath(); ctx.arc(x1, y1, this.brush, 0, Math.PI * 2); ctx.fill();
      this._solidifyErase(x0, y0, x1, y1);
    },

    // Canvas 圆形边缘会抗锯齿产生半透明像素；这里把本次刮到范围内的半透明像素直接归零。
    _solidifyErase(x0, y0, x1, y1) {
      const d = this.dpr || 1;
      const pad = this.brush + 3;
      const x = Math.max(0, Math.floor((Math.min(x0, x1) - pad) * d));
      const y = Math.max(0, Math.floor((Math.min(y0, y1) - pad) * d));
      const r = Math.min(this.canvas.width, Math.ceil((Math.max(x0, x1) + pad) * d));
      const b = Math.min(this.canvas.height, Math.ceil((Math.max(y0, y1) + pad) * d));
      const w = r - x, h = b - y;
      if (w <= 0 || h <= 0) return;
      const img = this.ctx.getImageData(x, y, w, h);
      const data = img.data;
      let changed = false;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0 && data[i] < 255) { data[i] = 0; changed = true; }
      }
      if (changed) this.ctx.putImageData(img, x, y);
    },

    _down(e) {
      if (!this.enabled || this.completed) return;
      if (e.cancelable) e.preventDefault();
      this.scratching = true;
      this.activePointerId = e.pointerId;
      const p = this._pos(e);
      this.lastX = p.x; this.lastY = p.y;
      this._erase(p.x, p.y, p.x, p.y);
      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
      this._scheduleCheck();
    },

    _move(e) {
      if (!this.scratching || this.completed) return;
      if (this.activePointerId != null && e.pointerId !== this.activePointerId) return;
      if (e.cancelable) e.preventDefault();

      // pointerrawupdate 更密；若刚处理过 raw 事件，则跳过随后重复的 pointermove，减少低端机额外绘制。
      const now = performance.now ? performance.now() : Date.now();
      if (e.type === 'pointerrawupdate') this._lastRawAt = now;
      else if (this._lastRawAt && now - this._lastRawAt < 24) return;

      // 取回被浏览器合并掉的中间点逐段连线，避免快速划动时刮痕断续。
      const evs = (typeof e.getCoalescedEvents === 'function') ? e.getCoalescedEvents() : null;
      if (evs && evs.length) {
        for (let i = 0; i < evs.length; i++) {
          const p = this._pos(evs[i]);
          this._erase(this.lastX, this.lastY, p.x, p.y);
          this.lastX = p.x; this.lastY = p.y;
        }
      } else {
        const p = this._pos(e);
        this._erase(this.lastX, this.lastY, p.x, p.y);
        this.lastX = p.x; this.lastY = p.y;
      }
      this._scheduleCheck();
    },

    // getImageData 很重：不要每帧全画布扫描，拖动中低频检测，松手时立即补一次。
    _scheduleCheck() {
      if (this._checkTimer) return;
      const now = performance.now ? performance.now() : Date.now();
      const wait = Math.max(0, 120 - (now - this._lastCheckAt));
      this._checkTimer = setTimeout(() => {
        this._checkTimer = 0;
        this._lastCheckAt = performance.now ? performance.now() : Date.now();
        this._checkCells();
      }, wait);
    },

    _up(e) {
      if (!this.scratching) return;
      if (e && this.activePointerId != null && e.pointerId !== this.activePointerId) return;
      this.scratching = false;
      this.activePointerId = null;
      if (this._checkTimer) { clearTimeout(this._checkTimer); this._checkTimer = 0; }
      this._lastCheckAt = performance.now ? performance.now() : Date.now();
      this._checkCells();
    },

    // 按单元格统计刮开比例，达阈值的格子单独揭晓
    _checkCells() {
      if (this.completed || !this.revealed) return;
      const W = this.canvas.width, H = this.canvas.height;
      if (!W || !H) return;
      const data = this.ctx.getImageData(0, 0, W, H).data;
      const cleared = new Array(this.rows * this.cols).fill(0);
      const total = new Array(this.rows * this.cols).fill(0);
      const grid = this._gridRect();
      const gx = Math.max(0, Math.floor(grid.x * this.dpr));
      const gy = Math.max(0, Math.floor(grid.y * this.dpr));
      const gw = Math.min(W - gx, Math.ceil(grid.w * this.dpr));
      const gh = Math.min(H - gy, Math.ceil(grid.h * this.dpr));
      const cellWdev = gw / this.cols, cellHdev = gh / this.rows;
      const step = 4; // 像素步进（设备像素），每隔 4px 采一次
      for (let py = gy; py < gy + gh; py += step) {
        for (let px = gx; px < gx + gw; px += step) {
          const col = Math.min(this.cols - 1, Math.floor((px - gx) / cellWdev));
          const row = Math.min(this.rows - 1, Math.floor((py - gy) / cellHdev));
          const idx = row * this.cols + col;
          total[idx]++;
          const a = data[(py * W + px) * 4 + 3];
          if (a === 0) cleared[idx]++;
        }
      }
      for (let i = 0; i < cleared.length; i++) {
        if (this.revealed.has(i)) continue;
        if (total[i] && cleared[i] / total[i] >= this.cellRevealRatio) this._revealCell(i);
      }
      if (this.revealed.size === this.rows * this.cols) this._complete();
    },

    // 揭晓单格：清掉该格残余涂层 + 图案单独弹出（silent=true 时不触发刮出回调，用于预揭格）
    _revealCell(idx, silent) {
      this.revealed.add(idx);
      const row = Math.floor(idx / this.cols), col = idx % this.cols;
      const grid = this._gridRect();
      const cw = grid.w / this.cols, ch = grid.h / this.rows;
      // 清掉该格涂层（略外扩 1px 接缝）
      this.ctx.clearRect(grid.x + col * cw - 1, grid.y + row * ch - 1, cw + 2, ch + 2);
      const sym = this.cells[idx];
      if (sym) { sym.classList.remove('pop'); void sym.offsetWidth; sym.classList.add('pop'); }
      if (!silent && typeof this.onCellReveal === 'function') {
        this.onCellReveal(idx, sym ? (sym.dataset.sym || sym.textContent) : null);
      }
    },

    _complete() {
      if (this.completed) return;
      this.completed = true;
      this.scratching = false;
      this.enabled = false;
      this.ctx.clearRect(0, 0, this.cssW, this.cssH);
      this.canvas.classList.add('done');
      if (typeof this.onReveal === 'function') this.onReveal();
    },
  };

  /* =========================================================
   * 中奖全屏特效 + 震动（按中奖级别分级）
   *  级别判定：综合净金币 / 卡价倍率 / 是否命中该卡最高赔付（jackpot）
   *   L0 未中 / 亏损 → 仅红色闪一下（亏损时）
   *   L1 小奖   → 金光微闪 + 轻微震动
   *   L2 中奖   → 光晕脉冲 + 少量彩纸 + 中等震动
   *   L3 大奖   → 全屏金色爆发 + 大量彩纸 + 闪白 + 强震动
   *   L4 巨奖(JACKPOT) → 满屏狂欢 + 光柱 + 连续强震 + 「JACKPOT」字样
   * ========================================================= */
  const FX = {
    layer: null,
    init() {
      this.layer = document.createElement('div');
      this.layer.className = 'fx-layer';
      this.layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(this.layer);
    },

    // 根据结算结果与卡定义判定中奖级别 0~4
    level(r, card) {
      if (!r || r.net <= 0) return 0;
      const price = (card && card.price) || 1;
      const ratio = r.net / price;
      // 命中该卡最高单项赔付（如 777 通杀 / 彗星 jackpot / 全矿石 / 全水果）→ 直接顶级
      const topPay = cardTopPay(card);
      if (topPay > 0 && r.jackpot >= topPay) return 4;
      if (ratio >= 12) return 3;
      if (ratio >= 3.5) return 2;
      return 1;
    },

    // 屏幕震动：amp 振幅(px)，dur 持续(ms)
    shake(amp, dur) {
      const el = document.getElementById('game');
      if (!el || prefersReducedMotion()) return;
      // 基础的位移/缩放由 fitStage() 写在 #game 的内联样式里。
      // 震动必须"叠加"在它之上，结束后还原（不能清空，否则舞台会跳回原始尺寸并上移）。
      const base = el.style.transform || '';
      const start = performance.now();
      const tick = (now) => {
        const t = (now - start) / dur;
        if (t >= 1) { el.style.transform = ''; fitStage(); return; }   // 结束后重新套用自适应
        const cur = amp * (1 - t);
        const dx = (Math.random() * 2 - 1) * cur;
        const dy = (Math.random() * 2 - 1) * cur;
        const rot = (Math.random() * 2 - 1) * cur * 0.12;
        el.style.transform = base + ' translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) rotate(' + rot.toFixed(2) + 'deg)';
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      // 触觉震动（支持的设备）
      if (navigator.vibrate) { try { navigator.vibrate(Math.min(dur, 200)); } catch (_) {} }
    },

    // 全屏闪光：color 颜色，dur 时长
    flash(color, dur) {
      if (prefersReducedMotion()) return;
      const f = document.createElement('div');
      f.className = 'fx-flash';
      f.style.background = color;
      f.style.animationDuration = dur + 'ms';
      this.layer.appendChild(f);
      setTimeout(() => f.remove(), dur + 60);
    },

    // 径向光晕脉冲
    glow(color, dur) {
      if (prefersReducedMotion()) return;
      const g = document.createElement('div');
      g.className = 'fx-glow';
      g.style.setProperty('--fx-glow-color', color);
      g.style.animationDuration = dur + 'ms';
      this.layer.appendChild(g);
      setTimeout(() => g.remove(), dur + 60);
    },

    // 彩纸喷射：count 数量
    confetti(count) {
      if (prefersReducedMotion()) return;
      const colors = ['#ffd23c', '#00f0ff', '#ff2bd6', '#b6ff3c', '#9d4bff', '#ffffff'];
      for (let i = 0; i < count; i++) {
        const p = document.createElement('i');
        p.className = 'fx-confetti';
        const left = Math.random() * 100;
        const delay = Math.random() * 220;
        const dur = 1100 + Math.random() * 900;
        const size = 6 + Math.random() * 8;
        const drift = (Math.random() * 2 - 1) * 160;
        p.style.left = left + '%';
        p.style.width = size + 'px';
        p.style.height = (size * (0.5 + Math.random() * 0.9)).toFixed(1) + 'px';
        p.style.background = colors[(Math.random() * colors.length) | 0];
        p.style.setProperty('--fx-drift', drift.toFixed(0) + 'px');
        p.style.setProperty('--fx-spin', (Math.random() * 720 - 360).toFixed(0) + 'deg');
        p.style.animationDuration = dur + 'ms';
        p.style.animationDelay = delay + 'ms';
        this.layer.appendChild(p);
        setTimeout(() => p.remove(), dur + delay + 60);
      }
    },

    // 巨奖横幅文字
    banner(text, cls) {
      if (prefersReducedMotion()) return;
      const b = document.createElement('div');
      b.className = 'fx-banner ' + (cls || '');
      b.textContent = text;
      this.layer.appendChild(b);
      setTimeout(() => b.remove(), 2200);
    },

    // 旋转光柱（巨奖）
    rays(dur) {
      if (prefersReducedMotion()) return;
      const r = document.createElement('div');
      r.className = 'fx-rays';
      r.style.animationDuration = dur + 'ms';
      this.layer.appendChild(r);
      setTimeout(() => r.remove(), dur + 60);
    },

    // 综合播放：按级别编排全屏特效 + 震动
    play(lv) {
      switch (lv) {
        case 1:
          this.flash('rgba(255,210,60,0.18)', 260);
          this.shake(3, 220);
          break;
        case 2:
          this.glow('rgba(255,210,60,0.55)', 900);
          this.confetti(28);
          this.shake(6, 360);
          break;
        case 3:
          this.flash('rgba(255,255,255,0.5)', 220);
          this.glow('rgba(255,210,60,0.8)', 1200);
          this.confetti(80);
          this.shake(11, 620);
          break;
        case 4:
          this.flash('rgba(255,255,255,0.85)', 300);
          this.rays(2200);
          this.glow('rgba(255,210,60,0.95)', 1800);
          this.confetti(160);
          this.banner('🎉 JACKPOT 🎉', 'jackpot');
          this.shake(18, 1100);
          // 二段震 + 补刀彩纸，强化「狂欢」节奏
          setTimeout(() => { this.shake(10, 600); this.confetti(80); }, 520);
          break;
        default:
          break;
      }
    },

    // 亏损 / 破产负反馈
    bad(bankrupt) {
      this.flash('rgba(255,43,214,' + (bankrupt ? '0.42' : '0.2') + ')', bankrupt ? 420 : 260);
      this.shake(bankrupt ? 14 : 5, bankrupt ? 600 : 280);
    },
  };

  // 是否开启「减少动态效果」（无障碍 / 性能）
  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // 取该卡的最高单项赔付（用于判定 JACKPOT 级别）
  function cardTopPay(card) {
    const p = card && card.prize; if (!p) return 0;
    let top = 0;
    if (p.kind === 'match' && p.face) { for (const s in p.face) top = Math.max(top, p.face[s]); }
    else if (p.kind === 'collect') top = p.allPrize || 0;
    else if (p.kind === 'lines' && p.linePay) { for (const s in p.linePay) top = Math.max(top, p.linePay[s]); }
    return top;
  }

  /* ===== 步骤验收：生成测试卡面 ===== */
  // 按权重采样一个符号
  function pickWeighted(pool) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = Math.random() * total;
    for (const p of pool) { if ((r -= p.w) < 0) return p.s; }
    return pool[pool.length - 1].s;
  }
  // useTool=true 时叠加贝壳刮具：好符号权重 +15%，💣/黑洞 -30%（simulate 不传，保持纯净）
  function buildSymbols(card, useTool) {
    const pool = (useTool && state.equippedTool === 'shell')
      ? card.pool.map((p) => Object.assign({}, p, { w: p.danger ? p.w * 0.7 : p.w * 1.15 }))
      : card.pool;
    const n = card.rows * card.cols;
    const arr = [];
    for (let i = 0; i < n; i++) arr.push(pickWeighted(pool));
    return arr;
  }

  /* ===== 步骤4：判奖逻辑 ===== */
  // 生成需要检测的连线（格子索引集合）：横排 / 竖排 / 对角线
  function lineIndices(rows, cols, dirs) {
    const lines = [];
    if (dirs.includes('row')) {
      for (let r = 0; r < rows; r++) { const l = []; for (let c = 0; c < cols; c++) l.push(r * cols + c); lines.push(l); }
    }
    if (dirs.includes('col')) {
      for (let c = 0; c < cols; c++) { const l = []; for (let r = 0; r < rows; r++) l.push(r * cols + c); lines.push(l); }
    }
    if (dirs.includes('diag')) {
      const d1 = [], d2 = []; const n = Math.min(rows, cols);
      for (let i = 0; i < n; i++) { d1.push(i * cols + i); d2.push(i * cols + (cols - 1 - i)); }
      lines.push(d1, d2);
    }
    return lines;
  }

  // 核心判奖（不含双线逻辑）：返回 { gross, penalty, net, jackpot, win, dangerCount }
  function coreJudge(card, syms, p) {
    let gross = 0, penalty = 0, jackpot = 0;
    if (p.kind === 'match') {
      // 每凑齐 3 个相同图案得 face 金币，可多组叠加
      const cnt = {};
      syms.forEach((s) => { cnt[s] = (cnt[s] || 0) + 1; });
      for (const s in cnt) {
        const groups = Math.floor(cnt[s] / 3);
        if (groups > 0 && p.face[s]) { const v = groups * p.face[s]; gross += v; jackpot = Math.max(jackpot, v); }
      }
    } else if (p.kind === 'collect') {
      // 全部为好图案 → 大奖；否则按最多同种好图案给安慰奖；坏图案罚金
      const bombs = syms.filter((s) => s === p.bad).length;
      if (p.penaltyPer) penalty = bombs * p.penaltyPer;
      if (bombs === 0) { gross = p.allPrize; jackpot = p.allPrize; }
      else {
        const cnt = {};
        syms.forEach((s) => { if (s !== p.bad) cnt[s] = (cnt[s] || 0) + 1; });
        let max = 0; for (const s in cnt) max = Math.max(max, cnt[s]);
        if (max >= 3) { gross = p.tiers[Math.min(max, 9)] || 0; jackpot = gross; }
      }
    } else if (p.kind === 'lines') {
      // 任意连线全同 → 按该图案 linePay 赔付，可多线叠加；坏图案罚金
      const bombs = syms.filter((s) => s === p.bad).length;
      if (p.penaltyPer) penalty = bombs * p.penaltyPer;
      const lines = lineIndices(card.rows, card.cols, p.dirs);
      for (const ln of lines) {
        const first = syms[ln[0]];
        if (first === p.bad) continue;
        if (ln.every((i) => syms[i] === first) && p.linePay[first]) {
          gross += p.linePay[first]; jackpot = Math.max(jackpot, p.linePay[first]);
        }
      }
    }
    const dangerCount = p.bad ? syms.filter((s) => s === p.bad).length : 0;
    return { gross, penalty, net: gross - penalty, jackpot, win: gross > 0, dangerCount };
  }

  // 生成平行时间线（隐藏的第二套结果），用于「双时间线」取优；尊重贝壳刮具倾斜
  function buildSecondTimeline(card) {
    const pool = (state.equippedTool === 'shell')
      ? card.pool.map((p) => Object.assign({}, p, { w: p.danger ? p.w * 0.7 : p.w * 1.15 }))
      : card.pool;
    const n = card.rows * card.cols, arr = [];
    for (let i = 0; i < n; i++) arr.push(pickWeighted(pool));
    return arr;
  }

  // 判奖入口：twin 卡额外取一条平行时间线结果，取净额较优者
  function judge(card, syms) {
    const p = card.prize;
    if (p.kind === 'twin') {
      const a = coreJudge(card, syms, p.base);              // 显式卡面 A
      const b = coreJudge(card, buildSecondTimeline(card), p.base); // 平行时间线 B
      const pick = (a.net >= b.net) ? a : b;
      return {
        gross: pick.gross, penalty: pick.penalty, jackpot: pick.jackpot, win: pick.gross > 0, net: pick.net,
        dangerCount: a.dangerCount,   // ⚡ 按显式卡面 A 计，施加于当前余额
        twinBetter: (a.net >= b.net) ? 'A' : 'B',
      };
    }
    return coreJudge(card, syms, p);
  }

  // 蒙特卡洛 RTP 模拟（调试用）：LuckyScratch.simulate() / simulate('mine', 100000)
  function simulate(cardId, iters) {
    iters = iters || 50000;
    const ids = cardId ? [cardId] : CARD_DEFS.map((c) => c.id);
    const out = {};
    ids.forEach((id) => {
      const card = CARD_MAP[id]; if (!card) return;
      let net = 0, wins = 0, maxJp = 0;
      for (let i = 0; i < iters; i++) {
        const r = judge(card, buildSymbols(card));
        net += r.net; if (r.win) wins++; if (r.jackpot > maxJp) maxJp = r.jackpot;
      }
      out[id] = {
        售价: card.price,
        RTP: +((net / iters / card.price) * 100).toFixed(1) + '%',
        命中率: +((wins / iters) * 100).toFixed(1) + '%',
        最大单中: maxJp,
      };
    });
    if (console.table) console.table(out); else console.log(out);
    return out;
  }

  /* =========================================================
   * 步骤5：肉鸽升级三选一增益
   * ========================================================= */
  const PERK_DEFS = [
    { id: 'fortune',  name: '财源广进', icon: '💰', iconImg: 'perk-sym-fortune', desc: '所有中奖金额 +12%（可叠加）' },
    { id: 'thrifty',  name: '精打细算', icon: '✂️', iconImg: 'perk-sym-thrifty', desc: '购卡价 -8%，最多 -50%' },
    { id: 'safety',   name: '稳健保底', icon: '🛡️', iconImg: 'perk-sym-safety', desc: '每张卡返还成本 ×25%，最多 100%' },
    { id: 'jackpot2', name: '一夜暴富', icon: '🎲', iconImg: 'perk-sym-jackpot2', desc: '中奖时 8% 概率金额 ×2（概率叠加）' },
    { id: 'firstDouble', name: '首刮双倍', icon: '⚡', iconImg: 'perk-sym-firstDouble', desc: '储存 1 次双倍机会；下一次中奖金额 ×2，未中奖不消耗' },
    { id: 'amulet',   name: '护身符',   icon: '🧿', iconImg: 'perk-sym-amulet', desc: '破产免死 1 次（金币归 50），可叠加' },
    { id: 'combo',    name: '连击大师', icon: '🔥', iconImg: 'perk-sym-combo', desc: '连中 3 次后奖金 ×1.5，断连失效' },
    { id: 'treasure', name: '鉴宝之眼', icon: '🔍', iconImg: 'perk-sym-treasure', desc: '矿石 / 水果类中奖额 +20%（可叠加）' },
    { id: 'burst',    name: '爆奖蓄能', icon: '🌟', iconImg: 'perk-sym-burst', desc: '未中奖蓄能 +10%，每层额外 +5%；中奖时释放加成，最高 +50%' },
    { id: 'rebate',   name: '幸运加刮', icon: '🎟️', iconImg: 'perk-sym-rebate', desc: '结算后 20% 概率返还本张卡价；每层 +8%，最高 60%' },
  ];
  const PERK_MAP = {};
  PERK_DEFS.forEach((p) => { PERK_MAP[p.id] = p; });
  function perkCount(id) { return state.perks.filter((p) => p === id).length; }
  // 增益图标：有图片素材时用图片，否则用 emoji（状态栏文字仍用 emoji）
  function perkIconHtml(p, cls) {
    return p.iconImg
      ? '<span class="' + cls + ' perk-sym-img ' + p.iconImg + '"></span>'
      : '<span class="' + cls + '">' + p.icon + '</span>';
  }

  // 折后购卡价（精打细算，封顶 -50%）
  function cardPrice(card) {
    const off = Math.min(0.5, perkCount('thrifty') * 0.08);
    return Math.max(1, Math.round(card.price * (1 - off)));
  }

  // 就地把至多 n 个坏图案（💣/黑洞）替换成随机好图案（四叶草刮具使用）
  function removeBadSymbols(card, syms, n) {
    if (n <= 0) return;
    const bad = card.prize && card.prize.bad; if (!bad) return;
    const goods = card.pool.filter((p) => !p.danger);
    if (!goods.length) return;
    let removed = 0;
    for (let i = 0; i < syms.length && removed < n; i++) {
      if (syms[i] === bad) { syms[i] = goods[(Math.random() * goods.length) | 0].s; removed++; }
    }
  }

  // 硬币刮具「保底」：返还本卡已刮开图案中最高单格估值（封顶卡价 50%，避免破坏经济）
  function singleValueMax(card, syms) {
    const p = (card.prize && card.prize.kind === 'twin') ? card.prize.base : card.prize; if (!p) return 0;
    let max = 0;
    new Set(syms).forEach((s) => {
      let v = 0;
      if (p.kind === 'match') v = (p.face[s] || 0) / 3;
      else if (p.kind === 'collect') { if (s !== p.bad) v = p.allPrize / 9; }
      else if (p.kind === 'lines') v = (p.linePay[s] || 0) / card.cols;
      if (v > max) max = v;
    });
    return Math.min(Math.round(max), Math.round(card.price * 0.5));
  }

  // 把纯判奖结果叠加肉鸽增益 + 刮具效果，得到最终结算明细（judge 保持纯净）
  function applySettle(base, card, syms) {
    let gross = base.gross, penalty = base.penalty;
    const tool = state.equippedTool;
    // 钻头：矿洞 / 赌城 中奖 +25%，但 💣 伤害 +25%
    const drillCard = tool === 'drill' && (card.id === 'mine' || card.id === 'casino');
    if (drillCard) { if (gross > 0) gross *= 1.25; penalty *= 1.25; }
    // 肉鸽增益
    const comboOn = perkCount('combo') > 0 && state.combo >= 3 && base.gross > 0;
    const firstDoubleOn = perkCount('firstDouble') > 0 && base.gross > 0;
    const burstBonus = (base.gross > 0 && state.burstEnergy > 0) ? Math.min(0.5, state.burstEnergy) : 0;
    if (gross > 0) {
      gross *= (1 + perkCount('fortune') * 0.12);
      if (card.prize && card.prize.kind === 'collect') gross *= (1 + perkCount('treasure') * 0.20);
      if (burstBonus > 0) gross *= (1 + burstBonus);
      if (comboOn) gross *= 1.5;
      if (firstDoubleOn) gross *= 2;
    }
    let lucky = false;
    if (gross > 0) {
      const pj = Math.min(0.6, perkCount('jackpot2') * 0.08);
      if (pj > 0 && Math.random() < pj) { gross *= 2; lucky = true; }
    }
    gross = Math.round(gross);
    penalty = Math.round(penalty);
    // 百分比罚金（⚡ 雷击等）：按当前余额比例扣除，不致死；仅 twin 卡使用
    let coinPctPenalty = 0;
    if (card.prize && card.prize.coinPenaltyPct && base.dangerCount > 0) {
      coinPctPenalty = Math.round(state.coins * card.prize.coinPenaltyPct * base.dangerCount);
    }
    // 硬币保底
    const coinBonus = tool === 'coin' ? singleValueMax(card, syms) : 0;
    // 稳健保底（增益）
    const back = Math.round(Math.min(1, perkCount('safety') * 0.25) * card.price);
    // 幸运加刮：结算后概率返还本张卡价
    let rebate = 0;
    const rebateCount = perkCount('rebate');
    if (rebateCount > 0) {
      const pr = Math.min(0.6, 0.20 + (rebateCount - 1) * 0.08);
      if (Math.random() < pr) rebate = card.price;
    }
    const net = gross - penalty - coinPctPenalty + back + coinBonus + rebate;
    return { gross, penalty, coinPctPenalty, back, coinBonus, rebate, net, jackpot: base.jackpot, win: base.gross > 0,
      comboApplied: comboOn, lucky, drillUsed: drillCard, firstDoubleApplied: firstDoubleOn, burstApplied: burstBonus };
  }

  /* ===== 三选一增益弹窗（可排队，逐级弹出） ===== */
  let perkPending = 0;
  let perkOverlay = null;
  function queuePerkChoices(n) { perkPending += n; if (!perkOverlay) showNextPerk(); }
  function pickThreePerks() {
    const pool = PERK_DEFS.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    return pool.slice(0, 3);
  }
  function showNextPerk() {
    if (perkOverlay) { perkOverlay.remove(); perkOverlay = null; }
    if (perkPending <= 0) return;
    const choices = pickThreePerks();
    const ov = document.createElement('div');
    ov.className = 'perk-overlay';
    ov.innerHTML =
      '<div class="perk-modal perk-choice-modal">' +
        '<div class="perk-head">🎊 升到 Lv.' + state.level + ' · 三选一增益' +
          (perkPending > 1 ? '<span class="perk-more">还有 ' + (perkPending - 1) + ' 次</span>' : '') +
        '</div>' +
        '<div class="perk-cards">' +
          choices.map((p) => {
            const own = perkCount(p.id);
            return '<button class="perk-card" data-perk="' + p.id + '">' +
              perkIconHtml(p, 'perk-icon') +
              '<span class="perk-cname">' + p.name + (own ? (' <em>x' + own + '</em>') : '') + '</span>' +
              '<span class="perk-cdesc">' + p.desc + '</span>' +
            '</button>';
          }).join('') +
        '</div>' +
      '</div>';
    ov.addEventListener('click', (e) => {
      const btn = e.target.closest('.perk-card');
      if (!btn) return;
      const id = btn.dataset.perk;
      perkPending--;
      state.perks.push(id);
      save(); render();
      const pk = PERK_MAP[id];
      setStatus('获得增益「' + pk.name + '」：' + pk.desc);
      showNextPerk();
    });
    document.body.appendChild(ov);
    perkOverlay = ov;
  }

  // 顶部增益条：按 id 聚合展示已拥有增益 + 叠加层数
  function renderPerks() {
    if (!els.perkBar) return;
    if (!state.perks.length) { els.perkBar.innerHTML = ''; return; }   // 无增益时不显示任何文字
    const counts = {};
    state.perks.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
    els.perkBar.innerHTML = PERK_DEFS
      .filter((p) => counts[p.id])
      .map((p) => '<span class="perk-chip">' +
        perkIconHtml(p, 'perk-chip-sym') +
        (counts[p.id] > 1 ? '<em class="perk-chip-num">x' + counts[p.id] + '</em>' : '') +
        '<span class="perk-tip"><b>' + p.name + (counts[p.id] > 1 ? ' ×' + counts[p.id] : '') + '</b>' +
          '<span class="perk-tip-desc">' + p.desc + '</span></span>' +
      '</span>')
      .join('');
  }

  /* =========================================================
   * 步骤6：刮具系统（佩戴 1 件 · 持久拥有）
   *  acquire.type：initial 初始 / level 升级解锁 / shop 商店购买
   * ========================================================= */
  const TOOL_DEFS = [
    { id: 'coin',    name: '硬币',   icon: '🪙', iconImg: 'tool-icon-coin', sub: '保底', short: '返还本卡最高单格估值（封顶卡价 50%）', desc: '揭晓后额外返还本卡最高单格估值（封顶卡价 50%）', acquire: { type: 'initial' } },
    { id: 'shell',   name: '贝壳',   icon: '🐚', iconImg: 'tool-icon-shell', sub: '幸运', short: '好符号权重 +15%，💣/黑洞权重 -30%', desc: '好符号权重 +15%，💣/黑洞 -30%', acquire: { type: 'level', level: 2 } },
    { id: 'clover',  name: '四叶草', icon: '🍀', iconImg: 'tool-icon-clover', sub: '护身', short: '开刮前移除 1 个 💣/黑洞', desc: '每张卡开刮前自动移除 1 个 💣/黑洞', acquire: { type: 'level', level: 3 } },
    { id: 'crystal', name: '水晶球', icon: '🔮', iconImg: 'tool-icon-crystal', sub: '透视', short: '发牌时预先揭示中央格', desc: '发牌时预先揭示中央格', acquire: { type: 'level', level: 4 } },
    { id: 'drill',   name: '钻头',   icon: '⛏️', iconImg: 'tool-icon-drill', sub: '暴富', short: '矿洞/赌城中奖 +25%，💣伤害 +25%', desc: '矿洞 / 赌城中奖 +25%，但 💣 伤害 +25%', acquire: { type: 'level', level: 5 } },
  ];
  const TOOL_MAP = {};
  TOOL_DEFS.forEach((t) => { TOOL_MAP[t.id] = t; });

  function svgTextEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function updateScratchCursor() {
    if (!Scratch.canvas) return;
    const t = TOOL_MAP[state.equippedTool] || TOOL_MAP.coin;
    const icon = svgTextEscape(t ? t.icon : '🪙');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">' +
      '<text x="6" y="34" font-size="30" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif"' +
      ' style="filter:drop-shadow(0 2px 2px rgba(0,0,0,.55))">' + icon + '</text>' +
      '</svg>';
    Scratch.canvas.style.cursor = 'url("data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg) + '") 10 10, grab';
  }

  // 刮具说明气泡：纸片素材，出现在对应刮具圆框左方；切换刮具时出现，下一次点击后消失
  let toolTipHideFn = null;
  function showToolTip(tool) {
    if (!els.toolTip || !els.toolTipText) return;
    els.toolTipText.textContent = tool.desc;
    const item = els.toolList.querySelector('.tool-item[data-tool="' + tool.id + '"]');
    if (item) els.toolTip.style.top = Math.round(item.offsetTop + item.offsetHeight / 2) + 'px';
    els.toolTip.classList.add('show');
    if (toolTipHideFn) document.removeEventListener('click', toolTipHideFn, true);
    toolTipHideFn = function hide() {
      els.toolTip.classList.remove('show');
      document.removeEventListener('click', hide, true);
      toolTipHideFn = null;
    };
    // 等本次点击事件派发完成后再武装监听，避免立即触发消失
    setTimeout(() => { if (toolTipHideFn) document.addEventListener('click', toolTipHideFn, true); }, 0);
  }

  // 刮具栏图标：有图片素材时用图片，否则用 emoji（刮卡时的鼠标光标始终用 emoji）
  function toolIconHtml(t) {
    return t.iconImg
      ? '<span class="tool-emoji tool-icon-img ' + t.iconImg + '"></span>'
      : '<span class="tool-emoji">' + t.icon + '</span>';
  }

  // 刮具栏：动态渲染（装备态 / 持有 / 商店价 / 等级锁）
  function renderTools() {
    if (!els.toolList) return;
    els.toolList.innerHTML = TOOL_DEFS.map((t, i) => {
      const owned = state.ownedTools.includes(t.id);
      const equipped = owned && state.equippedTool === t.id;
      let cls = 'tool-item', badge;
      if (equipped) { cls += ' equipped'; badge = ''; }
      else if (owned) { badge = ''; }
      else if (t.acquire.type === 'shop') { cls += ' buy'; badge = '<span class="tool-buy">💰' + t.acquire.price + '</span>'; }
      else if (t.acquire.type === 'level') { cls += ' locked'; badge = '<span class="tool-lock">🔒Lv.' + t.acquire.level + '</span>'; }
      else { cls += ' locked'; badge = '<span class="tool-lock">🔒</span>'; }
      const toolBtn = '<button class="' + cls + '" data-tool="' + t.id + '" aria-label="' + t.name + '·' + t.sub + '：' + t.desc + '">' +
        '<span class="tool-main">' +
          toolIconHtml(t) +
          badge +
        '</span>' +
      '</button>';
      // 下方数字按钮：与翻页 A/D 同款，数字对应快捷键 1~5
      const keyBtn = '<button class="tool-key-btn" data-tool="' + t.id + '" aria-label="快捷键 ' + (i + 1) + '：' + t.name + '">' +
        '<span class="page-btn-key">' + (i + 1) + '</span>' +
      '</button>';
      return '<div class="tool-entry">' + toolBtn + keyBtn + '</div>';
    }).join('');
    updateScratchCursor();
  }

  let toolUnlockQueue = [];
  let toolUnlockOverlay = null;
  let toolUnlockAfter = [];
  function queueToolUnlockPopups(tools, onDone) {
    if (onDone) toolUnlockAfter.push(onDone);
    if (tools && tools.length) tools.forEach((t) => toolUnlockQueue.push(t));
    if (!toolUnlockOverlay) showNextToolUnlock();
  }
  // 获得新刮具弹窗里的刮具图片（与底图同为 623×623 画布，天然对齐）
  const UNLOCK_ICON_IMG = {
    shell: 'tool-unlock-icon-shell',
    clover: 'tool-unlock-icon-clover',
    crystal: 'tool-unlock-icon-crystal',
    drill: 'tool-unlock-icon-drill',
  };
  function showNextToolUnlock() {
    if (toolUnlockOverlay) { toolUnlockOverlay.remove(); toolUnlockOverlay = null; }
    if (!toolUnlockQueue.length) {
      const cbs = toolUnlockAfter.splice(0);
      cbs.forEach((fn) => fn());
      return;
    }
    const t = toolUnlockQueue.shift();
    const lv = t.acquire && t.acquire.level ? ('Lv.' + t.acquire.level + ' ') : '';
    const ov = document.createElement('div');
    ov.className = 'perk-overlay tool-unlock-overlay';
    ov.innerHTML =
      '<div class="perk-modal tool-unlock-modal">' +
        '<span class="tool-unlock-deco tool-unlock-deco-title"></span>' +
        '<span class="tool-unlock-deco tool-unlock-deco-text"></span>' +
        (UNLOCK_ICON_IMG[t.id] ? '<span class="tool-unlock-deco tool-unlock-icon-img ' + UNLOCK_ICON_IMG[t.id] + '"></span>' : '') +
        '<div class="perk-head">🎊 ' + lv + '获得新刮具</div>' +
        '<div class="tool-unlock-card">' +
          // 有图片时隐藏 emoji（保留占位，保证下方名称/说明位置不变）
          '<span class="tool-unlock-icon' + (UNLOCK_ICON_IMG[t.id] ? ' is-hidden' : '') + '">' + t.icon + '</span>' +
          '<span class="tool-unlock-name">' + t.name + '<em>' + t.sub + '</em></span>' +
          '<span class="tool-unlock-desc">' + t.desc + '</span>' +
        '</div>' +
        '<button class="tool-unlock-ok">知道了</button>' +
      '</div>';
    ov.addEventListener('click', (e) => {
      if (e.target === ov || e.target.closest('.tool-unlock-ok')) showNextToolUnlock();
    });
    document.body.appendChild(ov);
    toolUnlockOverlay = ov;
  }

  // 点击刮具：已拥有→佩戴；商店刮具→买下并佩戴；等级刮具未达级→提示
  function selectTool(toolId) {
    const t = TOOL_MAP[toolId]; if (!t) return;
    // 台上的卡只要已经动手刮过（揭开过预揭格之外的格子）就锁定刮具；未刮开则允许更换
    const hasActiveCard = Scratch.enabled && !Scratch.completed;
    const baseRevealed = Scratch.preReveal ? Scratch.preReveal.length : 0;
    const touched = !!(Scratch.revealed && Scratch.revealed.size > baseRevealed);
    if (hasActiveCard && touched) { setStatus('台上这张已经开刮了，刮完再换刮具吧'); return; }
    if (state.ownedTools.includes(toolId)) {
      if (state.equippedTool === toolId) { setStatus('「' + t.name + '」已在佩戴中'); return; }
      const redealCard = (hasActiveCard && currentCard) ? currentCard : null;
      const redealPrice = currentCardPrice;
      state.equippedTool = toolId; save(); render();
      showToolTip(t);
      if (redealCard) {
        dealCard(redealCard, { animateSwap: true }); // 未开刮换刮具：同款卡重新发牌，让发牌期刮具效果重新生效
        currentCardPrice = redealPrice;    // 保留这张卡原本的花费，不重复扣钱
        setStatus('🔧 已切换为「' + t.icon + t.name + '」，台上这张「' + redealCard.name + '」已按新刮具重新发牌');
      } else {
        setStatus('🔧 佩戴刮具「' + t.icon + t.name + '」：' + t.desc);
      }
      return;
    }
    if (t.acquire.type === 'shop') {
      if (state.coins < t.acquire.price) { setStatus('金币不足，买不起刮具「' + t.name + '」（需 ' + t.acquire.price + '）'); return; }
      state.coins -= t.acquire.price;
      state.ownedTools.push(toolId);
      state.equippedTool = toolId;
      save(); render();
      showToolTip(t);
      setStatus('🛒 购入并佩戴刮具「' + t.icon + t.name + '」：' + t.desc); return;
    }
    if (t.acquire.type === 'level') { setStatus('刮具「' + t.name + '」需升到 Lv.' + t.acquire.level + ' 解锁'); return; }
    setStatus('刮具「' + t.name + '」暂不可获取');
  }



  /* ===== 升级 / 解锁 ===== */
  const UNLOCK_BY_LEVEL = { 2: 'orchard', 3: 'mine', 4: 'casino', 5: 'star', 6: 'spacetime' };
  // 金币达阈值即升级（永久），解锁卡片 / 刮具；返回本次解锁内容
  function checkLevelUp() {
    const names = [], tools = []; let levels = 0;
    while (state.level < MAX_LEVEL && state.coins >= LEVEL_THRESHOLDS[state.level]) {
      state.level++; levels++;
      const cardId = UNLOCK_BY_LEVEL[state.level];
      if (cardId && !state.unlockedCards.includes(cardId)) {
        state.unlockedCards.push(cardId);
        names.push(CARD_MAP[cardId].name);
      }
      // 等级刮具解锁
      TOOL_DEFS.forEach((t) => {
        if (t.acquire.type === 'level' && t.acquire.level === state.level && !state.ownedTools.includes(t.id)) {
          state.ownedTools.push(t.id);
          names.push(t.icon + t.name + '(刮具)');
          tools.push(t);
        }
      });
    }
    return { names, levels, tools };
  }

  // 渲染卡片右侧说明面板：中奖要求 + 各图案出现概率
  function renderCardInfo(card) {
    if (!els.cardInfo) return;
    const inlineInfo = card && !!SKIN_CLASS[card.skin];
    els.cardInfo.classList.toggle('is-hidden', inlineInfo);
    if (inlineInfo) {
      els.cardInfo.innerHTML = '';
      return;
    }
    els.cardInfo.innerHTML =
      '<div class="ci-head">' +
        '<span class="ci-title">' + cardArtHtml(card, 'ci-art') + '<span>' + card.name + '</span></span>' +
        '<span class="ci-price">售价 ' + card.price + '</span>' +
      '</div>' +
      '<div class="ci-section">' +
        '<div class="ci-label">中奖要求</div>' +
        '<p class="ci-rule">' + card.rule + '</p>' +
      '</div>' +
      '<div class="ci-section">' +
        '<ul class="ci-odds">' + cardOddsHtml(card) + '</ul>' +
      '</div>';
  }

  /* ===== 当前卡 & 发卡 / 购买 / 结算 ===== */
  let currentCard = null;       // 当前在台上的卡定义
  let currentSymbols = null;    // 当前卡面符号
  let currentCardPrice = 0;       // 当前台上卡的实际花费（用于放弃时退款）
  let lastLiveGross = {};         // 已即时反馈过的「图案 → 已锁定奖励额」（用于按图案追加增量提示）

  function dealCard(card, opts) {
    opts = opts || {};
    // 默认按免费发卡处理（测试 / 开局赠卡）；buyCard 会在发卡后回填真实花费
    currentCardPrice = 0;
    lastLiveGross = {};  // 新卡：重置即时奖励反馈基线
    currentCard = card;
    currentSymbols = buildSymbols(card, true);   // 贝壳刮具：发牌权重倾斜
    // 四叶草刮具：开刮前自动移除 1 个坏图案
    const cloverRemoveN = state.equippedTool === 'clover' ? 1 : 0;
    removeBadSymbols(card, currentSymbols, cloverRemoveN);
    renderCardInfo(card);
    // 水晶球刮具：发牌即预揭中央格
    const preReveal = (state.equippedTool === 'crystal') ? [((card.rows * card.cols) / 2) | 0] : [];
    Scratch.deal(Object.assign({}, card, { symbols: currentSymbols, preReveal }), { animateSwap: opts.animateSwap });
    setStatus('刮开 ' + card.name + '，全部揭晓后自动结算');
  }

  // 购买并发卡：校验解锁 / 余额（含精打细算折扣）
  // 台上若有「尚未刮开」的卡，可放弃改买别的：退回旧卡的钱，再扣新卡的钱
  function buyCard(cardId) {
    const card = CARD_MAP[cardId];
    if (!card) return;
    if (!state.unlockedCards.includes(cardId)) { setStatus('「' + card.name + '」尚未解锁，继续攒金币升级吧'); return; }

    // 台上是否还有未结算的卡，以及玩家是否已经动手刮过（揭开过预揭格之外的任意格）
    const hasTableCard = !!currentCard; // 包括已结算但仍显示在台上的上一张卡，用于播放换卡动画
    const hasActiveCard = Scratch.enabled && !Scratch.completed;
    const baseRevealed = Scratch.preReveal ? Scratch.preReveal.length : 0;
    const touched = !!(Scratch.revealed && Scratch.revealed.size > baseRevealed);

    if (hasActiveCard && touched) { setStatus('台上这张已经开刮了，先刮完再换别的吧'); return; }
    if (hasActiveCard && currentCard && currentCard.id === cardId) { setStatus('「' + card.name + '」正在台上，刮开它试试~'); return; }

    // 放弃未刮开的旧卡：退回其花费
    const refund = hasActiveCard ? currentCardPrice : 0;
    const price = cardPrice(card);

    if (state.coins + refund < price) { setStatus('金币不足，买不起「' + card.name + '」（需 ' + price + '）'); return; }

    // 先退后扣
    state.coins += refund;
    state.coins -= price;
    save(); render();
    dealCard(card, { animateSwap: hasTableCard });
    currentCardPrice = price;

    // 状态提示
    let msg = '🛒 购入「' + card.name + '」：' + price + ' 金币' +
      (price < card.price ? '（精打细算，原价 ' + card.price + '）' : '');
    if (refund > 0) msg = '↩️ 退回上一张 ' + refund + ' 金币 · ' + msg;
    setStatus(msg);
  }

  // 揭晓后结算：判奖 → 叠加增益 → 加净额 → 升级三选一 / 护身符免死 / 破产
  function settle() {
    if (!currentCard || !currentSymbols) return;
    const base = judge(currentCard, currentSymbols);
    const r = applySettle(base, currentCard, currentSymbols);
    state.coins += r.net;
    state.stats.totalScratches++;
    if (base.jackpot > state.stats.biggestJackpot) state.stats.biggestJackpot = base.jackpot;
    state.combo = base.win ? state.combo + 1 : 0;
    // 首刮双倍是储存型机会：中奖触发后消耗 1 层；未中奖不消耗
    if (r.firstDoubleApplied) {
      const i = state.perks.indexOf('firstDouble');
      if (i >= 0) state.perks.splice(i, 1);
    }
    // 爆奖蓄能：未中奖蓄能，中奖时释放并清空
    if (perkCount('burst') > 0) {
      if (base.win) state.burstEnergy = 0;
      else state.burstEnergy = Math.min(0.5, (state.burstEnergy || 0) + 0.10 + (perkCount('burst') - 1) * 0.05);
    }
    if (state.coins > state.stats.maxCoins) state.stats.maxCoins = state.coins;
    const up = checkLevelUp();
    let bankrupt = false, saved = false;
    if (state.coins < 0) {
      if (perkCount('amulet') > 0) {
        const i = state.perks.indexOf('amulet'); if (i >= 0) state.perks.splice(i, 1);
        state.coins = 50; saved = true;
      } else {
        bankrupt = true; state.stats.bankruptcies++; state.coins = 50; state.combo = 0;
      }
    }
    save();
    render();
    showResult(r, base, up.names, bankrupt, saved);
    if (up.tools && up.tools.length) queueToolUnlockPopups(up.tools, () => { if (up.levels > 0) queuePerkChoices(up.levels); });
    else if (up.levels > 0) queuePerkChoices(up.levels);
  }

  // 把本次结算拆成「图案×数量 +金额」之类的极简构成项（纯图案，无文字名）
  function rewardBreakdown(base, r, card, syms) {
    const p = (card.prize.kind === 'twin') ? card.prize.base : card.prize;
    const items = [];

    if (p.kind === 'match') {
      const cnt = {};
      syms.forEach((s) => { cnt[s] = (cnt[s] || 0) + 1; });
      for (const s in cnt) {
        const groups = Math.floor(cnt[s] / 3);
        if (groups > 0 && p.face[s]) items.push(s + '×' + cnt[s] + ' +' + (groups * p.face[s]));
      }
    } else if (p.kind === 'collect') {
      const bombs = syms.filter((s) => s === p.bad).length;
      if (bombs === 0) {
        items.push('🌈 +' + p.allPrize);
      } else {
        const cnt = {};
        syms.forEach((s) => { if (s !== p.bad) cnt[s] = (cnt[s] || 0) + 1; });
        let maxS = null, max = 0;
        for (const s in cnt) if (cnt[s] > max) { max = cnt[s]; maxS = s; }
        const tier = max >= 3 ? (p.tiers[Math.min(max, 9)] || 0) : 0;
        if (tier > 0) items.push(maxS + '×' + max + ' +' + tier);
      }
    } else if (p.kind === 'lines') {
      const lines = lineIndices(card.rows, card.cols, p.dirs);
      const lineCnt = {};
      for (const ln of lines) {
        const first = syms[ln[0]];
        if (first === p.bad) continue;
        if (ln.every((i) => syms[i] === first) && p.linePay[first]) lineCnt[first] = (lineCnt[first] || 0) + 1;
      }
      for (const s in lineCnt) {
        const n = lineCnt[s];
        items.push(s + (n > 1 ? '×' + n : '') + ' +' + (p.linePay[s] * n));
      }
    }

    // 罚金（坏图案）
    if (base.penalty > 0 && p.bad) {
      const bombs = syms.filter((s) => s === p.bad).length;
      items.push(p.bad + '×' + bombs + ' -' + base.penalty);
    }
    // 百分比罚金（⚡ 雷击等，按当前余额扣除，不致死）
    if (r.coinPctPenalty > 0) items.push('⚡×' + base.dangerCount + ' -' + r.coinPctPenalty);

    // 刮具 / 增益加成（纯图案，硬币保底用 💰 以区别于卡面的 🪙）
    if (r.coinBonus > 0) items.push('💰+' + r.coinBonus);
    if (r.back > 0) items.push('🛡+' + r.back);
    if (r.rebate > 0) items.push('🎟+' + r.rebate);
    if (r.burstApplied > 0) items.push('🌟+' + Math.round(r.burstApplied * 100) + '%');
    if (r.comboApplied) items.push('🔥×1.5');
    if (r.firstDoubleApplied) items.push('⚡×2');
    if (r.lucky) items.push('✨×2');
    if (r.drillUsed) items.push('⛏+25%');

    return items;
  }

  // 刮出坏图案时的即时负反馈：如「💣 塌方！」「🕳️ 黑洞！」
  let _badHintActive = 0;
  function badHint(card) {
    const p = card.prize; if (!p || !p.bad) return;
    const it = card.pool.find((q) => q.s === p.bad);
    const label = it ? it.label : '危险';
    if (els.scratchArea) {
      const t = document.createElement('div');
      t.className = 'hit-toast bad';
      t.innerHTML = symbolHtml(card, p.bad) + ' ' + label + '！';
      // 负反馈放到卡片下半区（72%/82%/92%），避让已上移到约 22% 的最终结算弹窗
      t.style.top = (72 + (_badHintActive % 3) * 10) + '%';
      _badHintActive++;
      els.scratchArea.appendChild(t);
      setTimeout(() => { t.remove(); _badHintActive = Math.max(0, _badHintActive - 1); }, 950);
    }
    FX.shake(7, 240);
  }

  // 基于「当前已揭开的格子」计算已经锁定的正向奖金，按「图案 → 金额」分组返回。
  // 各图案的锁定额都是单调递增的：凑更多组、连更多线、集齐升级只会让它变大。
  function liveGross(card) {
    const out = {};
    const p = (card && card.prize && card.prize.kind === 'twin') ? card.prize.base : (card && card.prize);
    const rev = Scratch.revealed;
    if (!p || !rev || !currentSymbols) return out;
    const idxs = [];
    rev.forEach((i) => { if (currentSymbols[i] != null) idxs.push(i); });
    const rs = idxs.map((i) => currentSymbols[i]);
    if (p.kind === 'match') {
      const cnt = {};
      rs.forEach((s) => { cnt[s] = (cnt[s] || 0) + 1; });
      for (const s in cnt) {
        const groups = Math.floor(cnt[s] / 3);
        if (groups > 0 && p.face[s]) out[s] = groups * p.face[s];
      }
    } else if (p.kind === 'collect') {
      const total = card.rows * card.cols;
      const bombs = rs.filter((s) => s === p.bad).length;
      if (rev.size === total && bombs === 0) {
        out['🌈'] = p.allPrize;   // 全部揭晓且无坏图案 → 集齐大奖
      } else {
        const cnt = {};
        rs.forEach((s) => { if (s !== p.bad) cnt[s] = (cnt[s] || 0) + 1; });
        let maxS = null, max = 0;
        for (const s in cnt) if (cnt[s] > max) { max = cnt[s]; maxS = s; }
        if (max >= 3) { const tier = p.tiers[Math.min(max, 9)] || 0; if (tier > 0) out[maxS] = tier; }
      }
    } else if (p.kind === 'lines') {
      const lines = lineIndices(card.rows, card.cols, p.dirs);
      for (const ln of lines) {
        if (!ln.every((i) => rev.has(i))) continue;   // 该线尚未全部刮开
        const first = currentSymbols[ln[0]];
        if (first === p.bad) continue;
        if (ln.every((i) => currentSymbols[i] === first) && p.linePay[first]) out[first] = (out[first] || 0) + p.linePay[first];
      }
    }
    return out;
  }

  // 刮出使奖励金额增加时的即时正反馈：如「🪙 +12」（绿色，用图案自己的图标，纵向错开堆叠）
  let _goodHintActive = 0;
  function goodHint(sym, amount) {
    if (amount <= 0 || !els.scratchArea) return;
    const t = document.createElement('div');
    t.className = 'hit-toast good';
    t.innerHTML = symbolHtml(currentCard, sym) + ' +' + amount;
    // 正反馈放在卡片中区（44%/55%/66%），与下半区的负反馈和上方结算弹窗都错开
    t.style.top = (44 + (_goodHintActive % 3) * 11) + '%';
    _goodHintActive++;
    els.scratchArea.appendChild(t);
    setTimeout(() => { t.remove(); _goodHintActive = Math.max(0, _goodHintActive - 1); }, 950);
  }

  // 每刮一格后检测奖励是否新增锁定，是则按图案分别即时弹出增量
  function checkLiveReward() {
    if (!currentCard) return;
    const map = liveGross(currentCard);
    for (const s in map) {
      const prev = lastLiveGross[s] || 0;
      if (map[s] > prev) {
        goodHint(s, map[s] - prev);
        lastLiveGross[s] = map[s];
      }
    }
  }


  // 结算结果：状态条文案 + 卡面浮层（含奖励构成）
  function showResult(r, base, unlocked, bankrupt, saved) {
    const parts = [];
    if (r.gross > 0) parts.push('中奖 +' + r.gross + (r.drillUsed ? '⛏️' : '') + (r.burstApplied > 0 ? '🌟' : '') + (r.comboApplied ? '🔥' : '') + (r.firstDoubleApplied ? '⚡×2' : '') + (r.lucky ? '✨×2' : ''));
    if (r.penalty > 0) parts.push('罚金 -' + r.penalty);
    if (r.coinPctPenalty > 0) parts.push('⚡雷击 -' + r.coinPctPenalty);
    if (r.back > 0) parts.push('保底 +' + r.back);
    if (r.coinBonus > 0) parts.push('🪙 +' + r.coinBonus);
    if (r.rebate > 0) parts.push('幸运加刮 +' + r.rebate);
    const netTxt = (r.net >= 0 ? '+' : '') + r.net;
    let msg = currentCard.name + ' 结算：' + (parts.join('，') || '未中奖') + ' → 净 ' + netTxt + ' 金币';
    if (!base.win && perkCount('burst') > 0 && state.burstEnergy > 0) msg += '｜🌟 当前蓄能 +' + Math.round(state.burstEnergy * 100) + '%';
    if (unlocked.length) msg += '｜🎊 解锁「' + unlocked.join('、') + '」';
    if (saved) msg = '🧿 护身符触发，免于破产，金币归 50！ ' + msg;
    if (bankrupt) msg = '💥 破产！本局结束，金币重置为 ' + state.coins + '（等级 / 刮具 / 增益保留）。' + msg;
    setStatus(msg);

    // 全屏特效 + 震动：破产/亏损走负反馈，中奖按级别分级狂欢
    if (bankrupt) FX.bad(true);
    else {
      const lv = FX.level(r, currentCard);
      if (lv > 0) FX.play(lv);
      else if (r.net < 0) FX.bad(false);
    }

    if (els.scratchArea) {
      const pop = document.createElement('div');
      const tone = bankrupt ? 'lose' : (saved ? 'win' : (r.net > 0 ? 'win' : (r.net < 0 ? 'lose' : 'neutral')));
      pop.className = 'result-toast ' + tone;
      const head = bankrupt ? '💥 破产' : (saved ? '🧿 免死' : (r.net > 0 ? '+' + r.net + ' 🎉' : (r.net < 0 ? r.net + ' 💣' : '±0')));
      // 金额构成说明暂时关闭（后续可恢复）：把下一行换回 rewardBreakdown(base, r, currentCard, currentSymbols) 即可重新显示
      const breakdown = [];
      pop.innerHTML = '<span class="rt-head">' + head + '</span>' +
        (breakdown.length ? '<span class="rt-detail">' + breakdown.join(' · ') + '</span>' : '');
      els.scratchArea.appendChild(pop);
      setTimeout(() => { pop.remove(); }, 2200);
    }
  }

  // 调试用：免费发一张卡（不扣金币）；LuckyScratch.deal() 轮换 / deal('mine') 指定
  let testIdx = 0;
  function dealTestCard(cardId) {
    let card;
    if (cardId && CARD_MAP[cardId]) card = CARD_MAP[cardId];
    else { card = CARD_DEFS[testIdx % CARD_DEFS.length]; testIdx++; }
    dealCard(card);
  }

  /* ===== 调试接口 ===== */
  window.LuckyScratch = {
    getState: () => JSON.parse(JSON.stringify(state)),
    setCoins: (n) => { state.coins = n; if (n > state.stats.maxCoins) state.stats.maxCoins = n; const up = checkLevelUp(); save(); render(); if (up.tools && up.tools.length) queueToolUnlockPopups(up.tools, () => { if (up.levels > 0) queuePerkChoices(up.levels); }); else if (up.levels > 0) queuePerkChoices(up.levels); },
    reset,
    deal: dealTestCard,   // LuckyScratch.deal() 轮换卡（免费）；deal('mine') 指定卡
    buy: buyCard,         // LuckyScratch.buy('copper') 购买发卡（扣金币）
    simulate,             // LuckyScratch.simulate() / simulate('star', 100000) 跑 RTP
    judge: (id, syms) => judge(CARD_MAP[id], syms),
    addPerk: (id) => { if (PERK_MAP[id]) { state.perks.push(id); save(); render(); } return state.perks.slice(); }, // 调试：直接加增益
    offerPerks: (n) => queuePerkChoices(n || 1), // 调试：弹出三选一
    equip: selectTool,    // LuckyScratch.equip('drill') 佩戴/购买刮具
    debug: enterDebugMode, // LuckyScratch.debug() 同左下角 🔧：全解锁 + 得分 10000
    giveTool: (id) => { if (TOOL_MAP[id] && !state.ownedTools.includes(id)) state.ownedTools.push(id); save(); render(); return state.ownedTools.slice(); }, // 调试：解锁刮具
    fx: (lv) => FX.play(lv == null ? 4 : lv),   // 调试：预览中奖特效 LuckyScratch.fx(1~4)
    calibrate: () => setCopperCalibration(!copperCalibOn),  // 调试：开关铜板卡底图校准模式
    align: (o) => { if (o && typeof o === 'object') { copperAlign = Object.assign(copperAlign, o); applyCopperAlign(); saveCopperAlign(); } return JSON.parse(JSON.stringify(copperAlign)); },
  };

  /* ===== 初始化 ===== */
  function init() {
    load();
    render();
    FX.init();
    Scratch.init(els.scratchArea);
    loadCopperAlign();
    Scratch.onReveal = settle;   // 整张揭晓 → 判奖结算
    // 刮出图案 → 即时反馈：坏图案弹负提示，凑成奖励则弹金额（后续凑更多会追加）
    Scratch.onCellReveal = (_idx, sym) => {
      const p = currentCard && currentCard.prize;
      if (p && p.bad && sym === p.bad) badHint(currentCard);
      checkLiveReward();
    };

    // 下方购卡槽点击 = 购买并发卡
    els.shopList.addEventListener('click', (e) => {
      const btn = e.target.closest('.card-item');
      if (btn && btn.dataset.card) buyCard(btn.dataset.card);
    });
    if (els.shopPrev) els.shopPrev.addEventListener('click', () => { changeShopPage(-1); });
    if (els.shopNext) els.shopNext.addEventListener('click', () => { changeShopPage(1); });

    // 键盘快捷键：A = 上一页，D = 下一页
    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // 升级三选一 / 刮具解锁弹窗打开时不响应翻页
      if (document.querySelector('.perk-overlay')) return;
      const key = (e.key || '').toLowerCase();
      if (key === 'a') { if (changeShopPage(-1)) e.preventDefault(); }
      else if (key === 'd') { if (changeShopPage(1)) e.preventDefault(); }
      // 数字 1~5 = 切换对应刮具
      else if (key >= '1' && key <= '5') {
        const t = TOOL_DEFS[Number(key) - 1];
        if (t) { selectTool(t.id); e.preventDefault(); }
      }
    });

    // 刮具栏点击 = 佩戴 / 购买 / 解锁提示（含下方数字按钮）
    els.toolList.addEventListener('click', (e) => {
      const btn = e.target.closest('.tool-item, .tool-key-btn');
      if (btn && btn.dataset.tool) selectTool(btn.dataset.tool);
    });

    initHudLayout();   // 顶栏隐形边界（得分 ↔ 等级条）

    dealTestCard('copper');   // 开局赠送一张铜板卡（免费首刮）
    setStatus('开局赠送一张铜板卡，刮开试试~ 之后从商店购买新卡');

    // 调试面板：点扳手开合，点面板外关闭
    function toggleDebugPanel(force) {
      if (!els.debugPanel) return;
      const open = typeof force === 'boolean' ? force : !els.debugPanel.classList.contains('open');
      els.debugPanel.classList.toggle('open', open);
    }
    if (els.debugBtn) {
      els.debugBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleDebugPanel(); });
    }
    if (els.dbgUnlockAll) {
      els.dbgUnlockAll.addEventListener('click', () => { enterDebugMode(); toggleDebugPanel(false); });
    }
    if (els.dbgLevelUp) {
      els.dbgLevelUp.addEventListener('click', () => { debugLevelUp(); toggleDebugPanel(false); });
    }
    if (els.dbgReset) {
      els.dbgReset.addEventListener('click', () => {
        if (confirm('确定清空存档重新开始？')) { reset(); toggleDebugPanel(false); }
      });
    }
    document.addEventListener('click', (e) => {
      if (!els.debugPanel || !els.debugPanel.classList.contains('open')) return;
      if (els.debugPanel.contains(e.target) || (els.debugBtn && els.debugBtn.contains(e.target))) return;
      toggleDebugPanel(false);
    });
    console.log('[lucky-scratch] 判奖 + 结算引擎就绪', state);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
