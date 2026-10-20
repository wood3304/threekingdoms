/* ==========================================================
 * 三国志 · 战场资源库
 * 地形 / 兵种 / 技能 / 战场地图生成
 * 纯数据与工具，不依赖 DOM，可在 Node 中直接测试
 * ========================================================== */
(function (global) {
  'use strict';
  var SG = global.SG || (global.SG = {});
  var A = SG.BattleAssets = {};

  /* 战场网格（格数 / 每格像素） */
  A.GRID = { W: 16, H: 10, TILE: 46 };
  A.MAX_ROUND = 20;

  /* ----------------------------------------------------------
   * 地形表
   * cost   : 移动力消耗
   * def    : 减伤率（0.15 = 减伤 15%）
   * pass   : 是否可通行
   * range  : 站于此地形时远程射程 +1
   * ---------------------------------------------------------- */
  A.TERRAIN = {
    plain:  { id: 'plain',  name: '平原', cost: 1, def: 0.00, pass: true,  color: '#2e3a28', accent: '#3d4d33' },
    road:   { id: 'road',   name: '大道', cost: 1, def: 0.00, pass: true,  color: '#433a2b', accent: '#5a4d38' },
    forest: { id: 'forest', name: '密林', cost: 2, def: 0.15, pass: true,  color: '#22331f', accent: '#2f4a2a' },
    hill:   { id: 'hill',   name: '丘陵', cost: 2, def: 0.20, pass: true,  color: '#3a382b', accent: '#4c4a38', range: 1 },
    water:  { id: 'water',  name: '河泽', cost: 99, def: 0.00, pass: false, color: '#173445', accent: '#24566f' },
    wall:   { id: 'wall',   name: '城墙', cost: 99, def: 0.00, pass: false, color: '#47453f', accent: '#5d5a51' },
    city:   { id: 'city',   name: '城内', cost: 1, def: 0.25, pass: true,  color: '#382f2c', accent: '#4a3d38' },
    camp:   { id: 'camp',   name: '营寨', cost: 1, def: 0.08, pass: true,  color: '#342d23', accent: '#493e2d' }
  };

  /* ----------------------------------------------------------
   * 兵种：由武将属性自动判定
   * ---------------------------------------------------------- */
  A.ARCHETYPES = {
    warrior: {
      id: 'warrior', name: '猛将', glyph: '猛',
      range: 1, move: 4, atk: 1.15, speed: 4,
      desc: '近战强袭，移动力高，正面杀伤最强。'
    },
    balanced: {
      id: 'balanced', name: '骁将', glyph: '骁',
      range: 2, move: 3, atk: 1.00, speed: 2,
      desc: '远近兼修，攻守均衡。'
    },
    strategist: {
      id: 'strategist', name: '智将', glyph: '智',
      range: 3, move: 3, atk: 0.88, speed: 0,
      desc: '远程施法，计略威力更强，近身较弱。'
    }
  };

  /* ----------------------------------------------------------
   * 技能库
   * target : enemy 敌军 / ally 友军 / self 自身 / tile 地点
   * power  : 伤害倍率（基于普通攻击）
   * radius : 作用半径（棋盘距离，切比雪夫）
   * ---------------------------------------------------------- */
  A.SKILLS = {
    assault: {
      id: 'assault', name: '突击', glyph: '突', cost: 30, cd: 2,
      range: 1, radius: 0, target: 'enemy', power: 1.75, push: 1, morale: -4,
      desc: '对相邻敌军发动强力突击，伤害大幅提升并将其击退一格。'
    },
    peerless: {
      id: 'peerless', name: '无双', glyph: '无', cost: 55, cd: 4,
      range: 1, radius: 1, target: 'enemy', selfCenter: true, power: 1.05, morale: -6,
      desc: '横扫身边所有敌军，造成伤害并打击其士气。'
    },
    duel: {
      id: 'duel', name: '一骑讨', glyph: '讨', cost: 60, cd: 4,
      range: 1, radius: 0, target: 'enemy', power: 2.5, recoil: 0.05,
      desc: '阵前单挑，对相邻敌将造成毁灭性打击，自身折损少量兵力。'
    },
    volley: {
      id: 'volley', name: '箭雨', glyph: '箭', cost: 40, cd: 3,
      range: 4, radius: 1, target: 'tile', power: 0.8, morale: -3,
      desc: '向指定区域齐射，波及范围内所有敌军。'
    },
    fire: {
      id: 'fire', name: '火计', glyph: '火', cost: 50, cd: 4,
      range: 3, radius: 1, target: 'tile', power: 0.95, morale: -5,
      burn: { turns: 2, ratio: 0.055 },
      desc: '放火焚烧指定区域，造成伤害并使其持续灼烧两回合。'
    },
    inspire: {
      id: 'inspire', name: '鼓舞', glyph: '鼓', cost: 35, cd: 3,
      range: 2, radius: 1, target: 'ally',
      buff: { atk: 0.2, turns: 2 }, morale: 12,
      desc: '鼓舞周围友军，攻击力提升 20%，士气回升。'
    },
    guard: {
      id: 'guard', name: '坚守', glyph: '守', cost: 25, cd: 3,
      range: 2, radius: 0, target: 'ally',
      buff: { def: 0.35, turns: 2 },
      desc: '令一支友军坚守阵型，受到的伤害降低 35%，持续两回合。'
    },
    disrupt: {
      id: 'disrupt', name: '离间', glyph: '离', cost: 30, cd: 3,
      range: 3, radius: 0, target: 'enemy', power: 0.35,
      debuff: { atk: -0.25, turns: 2 }, morale: -12,
      desc: '扰乱敌军军心，造成少量伤害并降低其攻击力与士气。'
    },
    rest: {
      id: 'rest', name: '休整', glyph: '整', cost: 25, cd: 3,
      range: 0, radius: 0, target: 'self', heal: 0.12,
      desc: '收拢部众就地休整，恢复 12% 的最大兵力。'
    },
    snipe: {
      id: 'snipe', name: '狙击', glyph: '狙', cost: 35, cd: 2,
      range: 5, radius: 0, target: 'enemy', power: 1.45,
      desc: '远距离狙击敌将，造成高额伤害。'
    }
  };

  /* ---------- 小工具 ---------- */
  function hashStr(s) {
    s = String(s == null ? '' : s);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  A.hash = hashStr;

  function rngFrom(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  A.rngFrom = rngFrom;

  A.inBounds = function (x, y, w, h) {
    w = w || A.GRID.W;
    h = h || A.GRID.H;
    return x >= 0 && x < w && y >= 0 && y < h;
  };

  A.terrainAt = function (map, x, y) {
    if (!map || !map.tiles || !map.tiles[y]) return null;
    var id = map.tiles[y][x];
    return id ? A.TERRAIN[id] : null;
  };

  /* 武将兵种判定：武力明显高为猛将，智力明显高为智将，其余为骁将 */
  A.archetypeOf = function (u) {
    var war = u.war || 50, int = u.int || 50;
    if (war >= int + 12) return 'warrior';
    if (int >= war + 12) return 'strategist';
    return 'balanced';
  };

  /* 根据武将属性与兵种生成技能组 */
  A.skillsFor = function (u, arch) {
    arch = arch || A.archetypeOf(u);
    var out = [];
    function add(id) { if (out.indexOf(id) < 0) out.push(id); }

    if (arch === 'warrior') {
      add('assault');
      if (u.war >= 86) add('peerless');
      if (u.war >= 95) add('duel');
    } else if (arch === 'strategist') {
      add(u.int >= 78 ? 'fire' : 'disrupt');
      if (u.int >= 82) add('volley');
      if (u.int >= 92) add('snipe');
    } else {
      add('volley');
      if (u.war >= 60) add('assault');
      if (u.int >= 78) add('fire');
    }

    if (u.lead >= 82) add('inspire');
    else if (u.lead >= 68) add('guard');

    if (out.length < 3) add('rest');
    return out.slice(0, 4);
  };

  /* 姓名配色（用于头像底纹等装饰） */
  A.styleOf = function (name) {
    var h = hashStr(name);
    return {
      hue: h % 360,
      bg: 'hsl(' + (h % 360) + ',26%,18%)',
      edge: 'hsl(' + (h % 360) + ',40%,42%)'
    };
  };

  /* ----------------------------------------------------------
   * 战场地图生成
   * 攻方在左，守方在右；右侧为城墙与城内
   * 同一座城每次的战场布局一致（以城池 id / 名称为随机种子）
   * ---------------------------------------------------------- */
  A.buildMap = function (city) {
    city = city || { id: 'battle', name: '战场', def: 50 };
    var W = A.GRID.W, H = A.GRID.H;
    var rng = rngFrom(hashStr((city.id || '') + '|' + (city.name || '')));
    var tiles = [], variant = [], x, y;

    for (y = 0; y < H; y++) {
      tiles[y] = [];
      variant[y] = [];
      for (x = 0; x < W; x++) {
        tiles[y][x] = 'plain';
        variant[y][x] = rng();
      }
    }

    /* 城门所在行（两格宽） */
    var gateY = 4 + (rng() < 0.5 ? 0 : 1);

    /* 城内地块 */
    for (y = 0; y < H; y++) {
      for (x = 14; x < W; x++) tiles[y][x] = 'city';
    }

    /* 城墙：x=13，留出城门 */
    for (y = 0; y < H; y++) {
      if (y !== gateY && y !== gateY + 1) tiles[y][13] = 'wall';
    }

    /* 城门与直通大道 */
    tiles[gateY][13] = 'road';
    tiles[gateY + 1][13] = 'road';
    for (x = 2; x <= 13; x++) tiles[gateY][x] = 'road';

    /* 攻方营寨 */
    for (y = 0; y < H; y++) {
      if (y >= gateY - 2 && y <= gateY + 2) tiles[y][0] = 'camp';
    }

    /* 保护：起始区、城门大道、已有地形不被随机地形覆盖 */
    function protect(px, py) {
      if (px < 3 || px > 11) return true;
      if (py >= gateY - 1 && py <= gateY + 1) return true;
      return tiles[py][px] !== 'plain';
    }

    function blob(cx, cy, type, n) {
      var cells = [[cx, cy]], seen = {}, i;
      seen[cx + ',' + cy] = 1;
      for (i = 0; i < n * 3 && cells.length < n; i++) {
        var b = cells[Math.floor(rng() * cells.length)];
        var d = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(rng() * 4)];
        var nx = b[0] + d[0], ny = b[1] + d[1];
        var k = nx + ',' + ny;
        if (!A.inBounds(nx, ny, W, H) || seen[k] || protect(nx, ny)) continue;
        seen[k] = 1;
        cells.push([nx, ny]);
      }
      for (i = 0; i < cells.length; i++) {
        var c = cells[i];
        if (!protect(c[0], c[1])) tiles[c[1]][c[0]] = type;
      }
    }

    /* 湖泊（上下边缘，远离中央通道） */
    var top = rng() < 0.5;
    blob(4 + Math.floor(rng() * 5), top ? 1 : H - 2, 'water', 5 + Math.floor(rng() * 4));

    /* 树林 */
    var n = 2 + Math.floor(rng() * 2), i;
    for (i = 0; i < n; i++) {
      blob(3 + Math.floor(rng() * 8), Math.floor(rng() * H), 'forest', 3 + Math.floor(rng() * 4));
    }

    /* 丘陵 */
    n = 2 + Math.floor(rng() * 2);
    for (i = 0; i < n; i++) {
      blob(3 + Math.floor(rng() * 8), Math.floor(rng() * H), 'hill', 2 + Math.floor(rng() * 3));
    }

    return {
      w: W, h: H, tiles: tiles, variant: variant,
      gateY: gateY, cityName: city.name || '战场'
    };
  };

})(window);
