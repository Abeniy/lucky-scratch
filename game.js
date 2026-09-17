/**
 * Lucky Scratch — ClawPet Canvas version.
 * Safe bounded GameToDesk implementation: no iframe / no DOM overlay.
 */

const W = 960;
const H = 540;
const STORAGE_KEY = 'clawpet:lucky-scratch:platform:v1';
const LEVEL_THRESHOLDS = [0, 250, 700, 1800, 4500, 10000];
const MAX_LEVEL = LEVEL_THRESHOLDS.length;
const REVEAL_RATIO = 0.6;

const CARDS = [
  { id: 'copper', name: '铜板卡', art: '🪙', price: 10, level: 1, rule: '任意图案凑满 3 个中奖', pool: [
    { s: '🪴', w: 42, pay: 12 }, { s: '🔔', w: 30, pay: 30 }, { s: '⭐', w: 18, pay: 80 }, { s: '💎', w: 8, pay: 180 }, { s: '👑', w: 2, pay: 500 }
  ]},
  { id: 'orchard', name: '果园卡', art: '🍎', price: 30, level: 2, rule: '水果越集中，奖励越高', pool: [
    { s: '🍎', w: 35, pay: 40 }, { s: '🍋', w: 30, pay: 55 }, { s: '🍇', w: 22, pay: 90 }, { s: '🍒', w: 13, pay: 160 }
  ]},
  { id: 'mine', name: '矿洞卡', art: '💎', price: 80, level: 3, rule: '矿石中奖，💣 会扣钱', bad: '💣', penalty: 45, pool: [
    { s: '🪨', w: 35, pay: 70 }, { s: '💎', w: 24, pay: 180 }, { s: '🟡', w: 18, pay: 260 }, { s: '💣', w: 23, danger: true }
  ]},
  { id: 'casino', name: '赌城卡', art: '🎰', price: 180, level: 4, rule: '横/竖/斜三连中奖，💣 重罚', bad: '💣', penalty: 120, pool: [
    { s: '🍒', w: 34, pay: 120 }, { s: '🔔', w: 25, pay: 260 }, { s: '7️⃣', w: 14, pay: 900 }, { s: '💣', w: 27, danger: true }
  ]},
  { id: 'star', name: '星海卡', art: '🌌', price: 420, level: 5, rule: '星象连线中大奖，黑洞扣钱', bad: '🕳️', penalty: 260, pool: [
    { s: '✨', w: 34, pay: 300 }, { s: '🌙', w: 24, pay: 620 }, { s: '⭐', w: 13, pay: 1850 }, { s: '🕳️', w: 29, danger: true }
  ]},
];

const TOOLS = [
  { id: 'coin', name: '硬币', icon: '🪙', level: 1, desc: '结算返还本卡最高单格估值' },
  { id: 'shell', name: '贝壳', icon: '🐚', level: 2, desc: '好符号权重 +15%，坏符号 -30%' },
  { id: 'clover', name: '四叶草', icon: '🍀', level: 3, desc: '开刮前移除 1 个坏图案' },
  { id: 'crystal', name: '水晶球', icon: '🔮', level: 4, desc: '发牌时预揭中央格' },
  { id: 'drill', name: '钻头', icon: '⛏️', level: 5, desc: '矿洞/赌城收益与风险 +25%' },
];

function loadSave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) { return null; }
}
function saveState(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ coins: s.coins, level: s.level, best: s.best, tool: s.tool })); } catch (_) {}
}
function defaultState() {
  const old = loadSave() || {};
  return {
    coins: Number.isFinite(old.coins) ? old.coins : 100,
    level: Number.isFinite(old.level) ? old.level : 1,
    best: Number.isFinite(old.best) ? old.best : 100,
    tool: old.tool || 'coin',
    card: null,
    price: 0,
    symbols: [],
    revealed: [],
    preReveal: [],
    phase: 'idle',
    status: '选择左侧卡片开始刮吧',
    resultToast: null,
    resultAt: 0,
    particles: [],
  };
}
function randWeighted(pool) {
  const total = pool.reduce((a, p) => a + p.w, 0);
  let r = Math.random() * total;
  for (const p of pool) { r -= p.w; if (r <= 0) return p.s; }
  return pool[0].s;
}
function buildSymbols(state, card) {
  let pool = card.pool;
  if (state.tool === 'shell') pool = card.pool.map((p) => Object.assign({}, p, { w: p.danger ? p.w * 0.7 : p.w * 1.15 }));
  const syms = Array.from({ length: 9 }, () => randWeighted(pool));
  if (state.tool === 'clover' && card.bad) {
    const idx = syms.indexOf(card.bad);
    if (idx >= 0) {
      const goods = card.pool.filter((p) => !p.danger);
      syms[idx] = goods[(Math.random() * goods.length) | 0].s;
    }
  }
  return syms;
}
function deal(state, card, price) {
  state.card = card;
  state.price = price || 0;
  state.symbols = buildSymbols(state, card);
  state.revealed = new Array(9).fill(false);
  state.preReveal = [];
  state.phase = 'scratching';
  state.resultToast = null;
  if (state.tool === 'crystal') {
    state.preReveal = [4];
    state.revealed[4] = true;
  }
  state.status = '刮开「' + card.name + '」，揭晓 60% 后自动结算';
}
function touched(state) {
  const count = state.revealed.filter(Boolean).length;
  return count > state.preReveal.length;
}
function checkLevel(state) {
  while (state.level < MAX_LEVEL && state.coins >= LEVEL_THRESHOLDS[state.level]) state.level++;
  const tool = TOOLS.find((t) => t.id === state.tool);
  if (!tool || tool.level > state.level) state.tool = 'coin';
}
function judge(state) {
  const card = state.card;
  const syms = state.symbols;
  let gross = 0, penalty = 0;
  const cnt = {};
  syms.forEach((s) => { cnt[s] = (cnt[s] || 0) + 1; });
  if (card.bad && card.penalty) penalty = (cnt[card.bad] || 0) * card.penalty;
  if (card.id === 'casino' || card.id === 'star') {
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (const line of lines) {
      const s = syms[line[0]];
      if (s !== card.bad && line.every((i) => syms[i] === s)) {
        const p = card.pool.find((x) => x.s === s);
        if (p && p.pay) gross += p.pay;
      }
    }
  } else {
    Object.keys(cnt).forEach((s) => {
      if (s === card.bad) return;
      const groups = Math.floor(cnt[s] / 3);
      const p = card.pool.find((x) => x.s === s);
      if (groups && p && p.pay) gross += groups * p.pay;
    });
  }
  if (state.tool === 'drill' && (card.id === 'mine' || card.id === 'casino')) {
    if (gross > 0) gross = Math.round(gross * 1.25);
    penalty = Math.round(penalty * 1.25);
  }
  const coinBonus = state.tool === 'coin' ? Math.min(Math.round(card.price * 0.5), Math.max(1, Math.round(card.price * 0.18))) : 0;
  const net = gross - penalty + coinBonus;
  return { gross, penalty, coinBonus, net };
}
function settle(state, pet) {
  const r = judge(state);
  state.coins += r.net;
  if (state.coins > state.best) state.best = state.coins;
  if (state.coins < 0) {
    state.coins = 50;
    state.status = '💥 破产！金币重置为 50，继续再战';
  } else {
    state.status = state.card.name + ' 结算：' + (r.gross ? '中奖 +' + r.gross : '未中奖') + (r.penalty ? '，罚金 -' + r.penalty : '') + (r.coinBonus ? '，🪙 +' + r.coinBonus : '') + ' → 净 ' + (r.net >= 0 ? '+' : '') + r.net;
  }
  state.phase = 'settled';
  state.resultToast = (r.net >= 0 ? '+' : '') + r.net;
  state.resultAt = performance.now();
  checkLevel(state);
  saveState(state);
  if (pet) {
    try { pet.setAnimation(r.net > 0 ? 'victory' : 'defeat'); } catch (_) {}
    try { pet.showBubble(r.net > 0 ? '中了！主人手气不错！' : '别灰心，下张一定更好！', 4000); } catch (_) {}
  }
}
function rectHit(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}

export function createGame(callbacks, manifest, _rulesTemplate, chatContextTemplate) {
  let state = defaultState();
  let pets = [];
  let status = { phase: 'initializing' };
  let settlement = null;
  let canvasEl = null;
  let scratchDragging = false;
  const layout = { shop: [], tools: [], cells: [] };
  const viewport = { scale: 1, ox: 0, oy: 0 };
  function pet() { return pets.find((p) => !p.isHuman) || pets[1] || pets[0] || null; }
  function resetLayout() { layout.shop = []; layout.tools = []; layout.cells = []; }

  function render(ctx, size) {
    attachScratchDragHandlers(ctx.canvas);
    const actualW = size.w || W, actualH = size.h || H;
    resetLayout();
    ctx.clearRect(0, 0, actualW, actualH);
    viewport.scale = Math.min(actualW / W, actualH / H);
    viewport.ox = (actualW - W * viewport.scale) / 2;
    viewport.oy = (actualH - H * viewport.scale) / 2;
    ctx.save();
    ctx.translate(viewport.ox, viewport.oy);
    ctx.scale(viewport.scale, viewport.scale);
    const w = W, h = H;
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#07060f'); bg.addColorStop(0.5, '#15122a'); bg.addColorStop(1, '#0e0c1d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffd23c'; ctx.font = 'bold 22px Microsoft YaHei, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('幸运刮刮乐 · ClawPet', w / 2, 28);

    ctx.textAlign = 'left'; ctx.font = 'bold 18px Microsoft YaHei, sans-serif';
    ctx.fillStyle = '#ffd23c'; ctx.fillText('💰 ' + state.coins, 24, 32);
    ctx.fillStyle = '#00f0ff'; ctx.fillText('Lv.' + state.level, 145, 32);
    ctx.fillStyle = '#ff2bd6'; ctx.fillText('🏆 ' + state.best, 220, 32);

    // shop
    ctx.fillStyle = 'rgba(20,18,42,.88)'; roundRect(ctx, 18, 58, 170, 360, 14); ctx.fill();
    ctx.fillStyle = '#d8d4f0'; ctx.font = 'bold 16px Microsoft YaHei, sans-serif'; ctx.fillText('商店', 34, 84);
    CARDS.forEach((c, i) => {
      const r = { x: 34, y: 102 + i * 58, w: 138, h: 46, card: c };
      layout.shop.push(r);
      const locked = state.level < c.level;
      ctx.fillStyle = locked ? 'rgba(70,70,90,.42)' : 'rgba(28,24,56,.96)';
      ctx.strokeStyle = locked ? '#2a2450' : '#00f0ff'; ctx.lineWidth = 1;
      roundRect(ctx, r.x, r.y, r.w, r.h, 10); ctx.fill(); ctx.stroke();
      ctx.fillStyle = locked ? '#8983b5' : '#fff'; ctx.font = '15px Microsoft YaHei, sans-serif';
      ctx.fillText(c.art + ' ' + c.name, r.x + 10, r.y + 19);
      ctx.font = '12px Microsoft YaHei, sans-serif'; ctx.fillStyle = locked ? '#777' : '#ffd23c';
      ctx.fillText(locked ? '🔒 Lv.' + c.level : c.price + ' 金币', r.x + 10, r.y + 37);
    });

    // card area
    const cx = 255, cy = 72, cell = 88, gap = 8;
    ctx.fillStyle = 'rgba(10,8,22,.92)'; roundRect(ctx, 214, 58, 420, 410, 16); ctx.fill();
    if (state.card) {
      ctx.fillStyle = '#ffd23c'; ctx.font = 'bold 19px Microsoft YaHei, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(state.card.art + ' ' + state.card.name, 424, 88);
      ctx.fillStyle = 'rgba(216,212,240,.65)'; ctx.font = '12px Microsoft YaHei, sans-serif'; ctx.fillText(state.card.rule, 424, 110);
      for (let i = 0; i < 9; i++) {
        const row = Math.floor(i / 3), col = i % 3;
        const r = { x: cx + col * (cell + gap), y: cy + 58 + row * (cell + gap), w: cell, h: cell, idx: i };
        layout.cells.push(r);
        ctx.fillStyle = state.revealed[i] ? 'rgba(0,0,0,.48)' : '#57516f';
        ctx.strokeStyle = state.revealed[i] ? '#b6ff3c' : '#9d4bff';
        roundRect(ctx, r.x, r.y, r.w, r.h, 12); ctx.fill(); ctx.stroke();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (state.revealed[i]) { ctx.font = '42px sans-serif'; ctx.fillText(state.symbols[i], r.x + cell / 2, r.y + cell / 2); }
        else { ctx.font = 'bold 28px sans-serif'; ctx.fillStyle = '#d8d4f0'; ctx.fillText('?', r.x + cell / 2, r.y + cell / 2); }
      }
      ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#d8d4f0'; ctx.font = '13px Microsoft YaHei, sans-serif';
      ctx.fillText('已揭晓 ' + state.revealed.filter(Boolean).length + '/9', 424, 442);
    } else {
      ctx.fillStyle = '#8983b5'; ctx.font = '18px Microsoft YaHei, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('从左侧购买一张卡开始', 424, 250);
    }

    // tools
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(20,18,42,.88)'; roundRect(ctx, 670, 58, 250, 360, 14); ctx.fill();
    ctx.fillStyle = '#d8d4f0'; ctx.font = 'bold 16px Microsoft YaHei, sans-serif'; ctx.fillText('刮具', 688, 84);
    TOOLS.forEach((t, i) => {
      const r = { x: 688, y: 102 + i * 58, w: 214, h: 46, tool: t };
      layout.tools.push(r);
      const locked = state.level < t.level, eq = state.tool === t.id;
      ctx.fillStyle = locked ? 'rgba(70,70,90,.42)' : (eq ? 'rgba(58,84,32,.88)' : 'rgba(28,24,56,.96)');
      ctx.strokeStyle = eq ? '#b6ff3c' : (locked ? '#2a2450' : '#00f0ff');
      roundRect(ctx, r.x, r.y, r.w, r.h, 10); ctx.fill(); ctx.stroke();
      ctx.font = '15px Microsoft YaHei, sans-serif'; ctx.fillStyle = locked ? '#8983b5' : '#fff';
      ctx.fillText(t.icon + ' ' + t.name + (eq ? ' ▶' : ''), r.x + 10, r.y + 18);
      ctx.font = '11px Microsoft YaHei, sans-serif'; ctx.fillStyle = locked ? '#777' : '#b6ff3c';
      ctx.fillText(locked ? '🔒 Lv.' + t.level : t.desc, r.x + 10, r.y + 36);
    });

    ctx.fillStyle = 'rgba(0,0,0,.42)'; roundRect(ctx, 18, 440, 902, 54, 12); ctx.fill();
    ctx.fillStyle = '#d8d4f0'; ctx.font = '14px Microsoft YaHei, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(state.status, 34, 472);
    if (state.resultToast && performance.now() - state.resultAt < 2200) {
      ctx.fillStyle = state.resultToast[0] === '-' ? '#ff2bd6' : '#b6ff3c'; ctx.font = 'bold 38px Microsoft YaHei, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(state.resultToast, 424, 255);
    }
    ctx.restore();
  }

  function toVirtualPoint(x, y) {
    return { x: (x - viewport.ox) / viewport.scale, y: (y - viewport.oy) / viewport.scale };
  }

  function eventToVirtual(e) {
    const c = canvasEl || e.currentTarget;
    const rect = c.getBoundingClientRect();
    const sx = (c.width || rect.width) / rect.width;
    const sy = (c.height || rect.height) / rect.height;
    return toVirtualPoint((e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy);
  }

  function stopScratchEvent(e) {
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
  }

  function revealAt(x, y) {
    if (state.phase !== 'scratching') return false;
    for (const r of layout.cells) if (rectHit(x, y, r)) {
      if (!state.revealed[r.idx]) {
        state.revealed[r.idx] = true;
        const revealed = state.revealed.filter(Boolean).length;
        if (revealed / 9 >= REVEAL_RATIO) {
          state.revealed = new Array(9).fill(true);
          settle(state, pet());
        } else {
          state.status = '继续刮，揭晓 60% 后自动结算（' + revealed + '/9）';
        }
      }
      return true;
    }
    return false;
  }

  function isScratchPoint(x, y) {
    return state.phase === 'scratching' && layout.cells.some((r) => rectHit(x, y, r));
  }

  function attachScratchDragHandlers(canvas) {
    if (!canvas || canvas.__luckyScratchHandlers) return;
    canvasEl = canvas;
    const onDown = (e) => {
      const p = eventToVirtual(e);
      if (!isScratchPoint(p.x, p.y)) return; // 非刮卡区域仍交给平台拖动窗口
      scratchDragging = true;
      stopScratchEvent(e);
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      revealAt(p.x, p.y);
    };
    const onMove = (e) => {
      if (!scratchDragging) return;
      stopScratchEvent(e);
      const p = eventToVirtual(e);
      revealAt(p.x, p.y);
    };
    const onUp = (e) => {
      if (!scratchDragging) return;
      scratchDragging = false;
      stopScratchEvent(e);
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    canvas.addEventListener('pointerdown', onDown, true);
    canvas.addEventListener('pointermove', onMove, true);
    canvas.addEventListener('pointerup', onUp, true);
    canvas.addEventListener('pointercancel', onUp, true);
    canvas.__luckyScratchHandlers = { onDown, onMove, onUp };
  }

  function handleClick(x, y) {
    const p = toVirtualPoint(x, y);
    x = p.x; y = p.y;
    if (x < 0 || y < 0 || x > W || y > H) return;
    for (const r of layout.shop) if (rectHit(x, y, r)) {
      if (state.level < r.card.level) { state.status = '「' + r.card.name + '」需要 Lv.' + r.card.level + ' 解锁'; return; }
      if (state.phase === 'scratching' && touched(state)) { state.status = '这张已经开刮了，先刮完吧'; return; }
      const refund = state.phase === 'scratching' ? state.price : 0;
      if (state.coins + refund < r.card.price) { state.status = '金币不足，买不起「' + r.card.name + '」'; return; }
      state.coins += refund - r.card.price;
      deal(state, r.card, r.card.price);
      saveState(state);
      const p = pet(); if (p) { try { p.setAnimation('think'); p.showBubble('新卡来了！这张会不会爆？', 2800); } catch (_) {} }
      return;
    }
    for (const r of layout.tools) if (rectHit(x, y, r)) {
      if (state.level < r.tool.level) { state.status = '刮具「' + r.tool.name + '」需要 Lv.' + r.tool.level; return; }
      if (state.phase === 'scratching' && touched(state)) { state.status = '已经开刮了，刮完再换刮具'; return; }
      if (state.tool === r.tool.id) { state.status = '「' + r.tool.name + '」已在佩戴中'; return; }
      state.tool = r.tool.id;
      if (state.phase === 'scratching' && state.card) deal(state, state.card, state.price);
      state.status = '已佩戴「' + r.tool.icon + r.tool.name + '」：' + r.tool.desc;
      saveState(state);
      return;
    }
    revealAt(x, y);
  }

  return {
    async start(petAdapters) {
      pets = petAdapters || [];
      state = defaultState();
      checkLevel(state);
      status = { phase: 'playing', currentTurn: 0, currentPlayer: 'player_0' };
      const p = pet();
      if (p) {
        try { p.setAnimation('think'); } catch (_) {}
        try { p.setChatGameContext((chatContextTemplate || '').replace('{roleLabel}', '围观宠物')); } catch (_) {}
        try { p.showBubble('主人加油！我在旁边等大奖！', 3600); } catch (_) {}
      }
      const displayMode = { opaqueBackground: false, disableClickThrough: false, showGameUI: true };
      callbacks.onDisplayModeChange(displayMode);
      return { success: true, displayMode };
    },
    async forceEnd(reason) {
      scratchDragging = false;
      const p = pet(); if (p) { try { p.setAnimation('idle'); p.setChatGameContext(null); } catch (_) {} }
      settlement = { result: { ended: true, isDraw: true, reason: reason || '退出幸运刮刮乐', totalTurns: 0 }, rewards: [], stats: { coins: state.coins, level: state.level } };
      status = { phase: 'ended', result: settlement };
      return settlement;
    },
    render,
    onCanvasClick: handleClick,
    onPointerDown: handleClick,
    onPointerUp() {},
    onUserMessage(text) {
      const p = pet(); if (!p || !text) return;
      try { p.injectChatEvent('[主人说] ' + text).then((reply) => { if (reply) p.showBubble(reply, 5000); }).catch(() => {}); } catch (_) {}
    },
    getStatus() { return status; },
    getManifest() { return manifest; },
  };
}
