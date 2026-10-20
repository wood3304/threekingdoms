/* ==========================================================
 * 三国志 · 战场演出
 * Canvas 战场绘制 / 鼠标操作 / 技能特效 / 战斗 HUD
 * ========================================================== */
(function (global) {
  'use strict';
  var SG = global.SG;
  var A = SG.BattleAssets;
  var TILE = A.GRID.TILE;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmt(n) { return (Math.round(n) || 0).toLocaleString('en-US'); }
  function shortNum(n) {
    n = Math.max(0, Math.round(n));
    if (n >= 10000) return (n / 10000).toFixed(1) + '万';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function nowMs() {
    return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  }
  function dist(a, c) { return Math.abs(a.x - c.x) + Math.abs(a.y - c.y); }
  function modSum(u, stat) {
    var v = 0;
    (u.mods || []).forEach(function (m) { v += (m[stat] || 0); });
    return v;
  }

  /* ---------- 颜色 ---------- */
  function hexToRgb(hex) {
    hex = String(hex || '').replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex, 16);
    if (isNaN(n)) return { r: 120, g: 120, b: 120 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function shade(hex, amt) {
    if (String(hex).charAt(0) !== '#') return hex;
    var c = hexToRgb(hex);
    function f(v) {
      var target = amt > 0 ? 255 : 0;
      return Math.round(v + (target - v) * Math.abs(amt));
    }
    return 'rgb(' + f(c.r) + ',' + f(c.g) + ',' + f(c.b) + ')';
  }
  function rgba(hex, a) {
    if (String(hex).charAt(0) !== '#') return hex;
    var c = hexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }
  function hpColor(pct) {
    return pct > 0.6 ? '#5fbf6d' : (pct > 0.3 ? '#d6b13c' : '#d1655a');
  }

  /* ==========================================================
   * 入口
   * ========================================================== */
  function play(req, opts) {
    opts = opts || {};
    var B = SG.BattleCore.create(req, { playerSide: opts.playerSide });
    if (opts.debug) {
      /* 测试用：暴露战场与强制绘制入口 */
      SG.BattleUI._dbg = B;
      SG.BattleUI._dbgDraw = draw;
    }
    var closed = false, finished = false;
    var auto = !!opts.auto;
    var speed = opts.speed || 1;
    var busy = false, mode = 'move', skillId = null, hover = null;
    var timers = [], raf = null, bannerTimer = null, retreatTimer = null;
    var retreatArmed = false, resultShown = false, turnToken = 0;
    var shakeUntil = 0, shakePow = 0;
    var fx = [];

    /* ---------- DOM ---------- */
    var title = '合战 · ' + esc(B.cityNames.atk) + ' ➜ ' + esc(B.cityNames.def);
    var body =
      '<div class="btTop">' +
        '<div class="btArmy atk" id="btArmyA"></div>' +
        '<div class="btRound" id="btRound"></div>' +
        '<div class="btArmy def" id="btArmyD"></div>' +
      '</div>' +
      '<div class="btMain">' +
        '<div class="btBoard">' +
          '<div class="btCanvasWrap" id="btWrap">' +
            '<canvas id="btCanvas"></canvas>' +
            '<div class="btBanner" id="btBanner"></div>' +
            '<div class="btTip" id="btTip"></div>' +
            '<div class="btOverlay" id="btOverlay"></div>' +
          '</div>' +
          '<div class="btHint" id="btHint"></div>' +
        '</div>' +
        '<aside class="btSide">' +
          '<div class="btPanel">' +
            '<div class="btOrderHead">行 动 顺 序</div>' +
            '<div class="btOrder" id="btOrder"></div>' +
          '</div>' +
          '<div class="btPanel">' +
            '<div class="btUnit" id="btUnit"></div>' +
            '<div class="btActions" id="btActions"></div>' +
          '</div>' +
          '<div class="btPanel btLogPanel">' +
            '<div class="btOrderHead">战 报</div>' +
            '<div class="btLog" id="btLog"></div>' +
          '</div>' +
        '</aside>' +
      '</div>';

    var m = SG.UI.openModal({
      title: title,
      cls: 'battleBox tactical',
      noClose: true,
      body: body,
      foot:
        '<button class="btn" data-x="speed">速度 ×1</button>' +
        '<button class="btn" data-x="retreat">撤　退</button>' +
        '<button class="btn gold" data-x="auto">自动战斗</button>' +
        '<button class="btn primary" data-x="done" disabled>战斗进行中</button>'
    });

    var canvas = m.q('#btCanvas');
    var wrap = m.q('#btWrap');
    var ctx = canvas.getContext('2d');
    var VW = B.W * TILE, VH = B.H * TILE;
    var dpr = Math.max(1, Math.min(2, global.devicePixelRatio || 1));
    canvas.width = Math.round(VW * dpr);
    canvas.height = Math.round(VH * dpr);
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    B.units.forEach(function (u) {
      u._dx = u.x; u._dy = u.y; u._hp = u.troops; u._deadAt = 0; u._moveAnim = null;
    });

    /* ---------- 静态地形 ---------- */
    var bgCanvas = document.createElement('canvas');
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;
    var bctx = bgCanvas.getContext('2d');
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTerrain(bctx);

    /* ==========================================================
     * 地形绘制
     * ========================================================== */
    function drawTerrain(g) {
      var x, y;
      var base = g.createLinearGradient(0, 0, 0, VH);
      base.addColorStop(0, '#1d261a');
      base.addColorStop(0.55, '#182015');
      base.addColorStop(1, '#10160e');
      g.fillStyle = base;
      g.fillRect(0, 0, VW, VH);

      for (y = 0; y < B.H; y++) {
        for (x = 0; x < B.W; x++) drawTile(g, x, y);
      }

      drawGate(g);
      drawKeep(g);

      /* 网格 */
      g.strokeStyle = 'rgba(0,0,0,.20)';
      g.lineWidth = 1;
      for (x = 0; x <= B.W; x++) {
        g.beginPath(); g.moveTo(x * TILE + 0.5, 0); g.lineTo(x * TILE + 0.5, VH); g.stroke();
      }
      for (y = 0; y <= B.H; y++) {
        g.beginPath(); g.moveTo(0, y * TILE + 0.5); g.lineTo(VW, y * TILE + 0.5); g.stroke();
      }

      /* 暗角 */
      var vg = g.createRadialGradient(VW / 2, VH / 2, VH * 0.3, VW / 2, VH / 2, VH * 0.92);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,.5)');
      g.fillStyle = vg;
      g.fillRect(0, 0, VW, VH);

      g.strokeStyle = 'rgba(212,175,55,.16)';
      g.lineWidth = 2;
      g.strokeRect(1, 1, VW - 2, VH - 2);
    }

    function drawTile(g, x, y) {
      var id = B.map.tiles[y][x];
      var ter = A.TERRAIN[id] || A.TERRAIN.plain;
      var v = B.map.variant[y][x];
      var px = x * TILE, py = y * TILE;
      var i, gx, gy;

      g.fillStyle = shade(ter.color, (v - 0.5) * 0.18);
      g.fillRect(px, py, TILE, TILE);

      if (id === 'plain' || id === 'camp') {
        g.strokeStyle = rgba(ter.accent, 0.35);
        g.lineWidth = 1;
        for (i = 0; i < 3; i++) {
          gx = px + 7 + ((v * 97 + i * 29) % 32);
          gy = py + 10 + ((v * 53 + i * 17) % 27);
          g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + 1.5, gy - 4.5); g.stroke();
          g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx - 2, gy - 3); g.stroke();
        }
      } else if (id === 'road') {
        g.fillStyle = 'rgba(150,130,90,.10)';
        g.fillRect(px, py, TILE, TILE);
        g.strokeStyle = 'rgba(25,20,14,.45)';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(px, py + 15); g.lineTo(px + TILE, py + 15); g.stroke();
        g.beginPath(); g.moveTo(px, py + 31); g.lineTo(px + TILE, py + 31); g.stroke();
        g.fillStyle = 'rgba(200,180,130,.18)';
        for (i = 0; i < 4; i++) {
          g.fillRect(px + 4 + i * 11, py + 22 + ((v * 8 + i) % 3), 3, 2);
        }
      } else if (id === 'forest') {
        g.fillStyle = 'rgba(18,32,18,.5)';
        g.fillRect(px, py, TILE, TILE);
        drawTree(g, px + 15, py + 30, 4.6, v > 0.5);
        drawTree(g, px + 31, py + 25, 4.0, v <= 0.5);
        drawTree(g, px + 23, py + 38, 3.2, v > 0.35);
      } else if (id === 'hill') {
        g.fillStyle = 'rgba(0,0,0,.16)';
        g.beginPath();
        g.moveTo(px + 5, py + 39); g.lineTo(px + 23, py + 9); g.lineTo(px + 42, py + 39);
        g.closePath(); g.fill();
        g.fillStyle = shade(ter.accent, 0.06);
        g.beginPath();
        g.moveTo(px + 3, py + 40); g.lineTo(px + 19, py + 13); g.lineTo(px + 35, py + 40);
        g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,240,190,.10)';
        g.beginPath();
        g.moveTo(px + 19, py + 13); g.lineTo(px + 35, py + 40); g.lineTo(px + 23, py + 40);
        g.closePath(); g.fill();
        g.strokeStyle = 'rgba(20,24,18,.7)';
        g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(px + 19, py + 13); g.lineTo(px + 11, py + 40); g.stroke();
      } else if (id === 'water') {
        var w = g.createLinearGradient(px, py, px, py + TILE);
        w.addColorStop(0, '#1b4053');
        w.addColorStop(0.55, '#173445');
        w.addColorStop(1, '#122a39');
        g.fillStyle = w;
        g.fillRect(px, py, TILE, TILE);
        g.strokeStyle = 'rgba(110,190,225,.30)';
        g.lineWidth = 1.1;
        for (i = 0; i < 2; i++) {
          gy = py + 15 + i * 16 + ((v * 5) % 3);
          g.beginPath();
          g.moveTo(px + 3, gy);
          g.bezierCurveTo(px + 13, gy - 4, px + 23, gy + 4, px + 43, gy - 1);
          g.stroke();
        }
        g.fillStyle = 'rgba(120,210,240,.12)';
        g.fillRect(px + 4, py + 5, 14, 2);
      } else if (id === 'wall') {
        g.fillStyle = '#4a4740';
        g.fillRect(px, py, TILE, TILE);
        for (var row = 0; row < 3; row++) {
          for (var col = -1; col < 3; col++) {
            g.fillStyle = ((row + col) % 2 === 0) ? '#545049' : '#45423b';
            g.fillRect(px + (row % 2 ? -7 : 0) + col * 16 + 1, py + row * 15 + 2, 14, 12);
          }
        }
        g.fillStyle = '#5d5a51';
        for (i = 0; i < 3; i++) g.fillRect(px + 3 + i * 15, py - 2, 9, 6);
        g.fillStyle = 'rgba(0,0,0,.30)';
        g.fillRect(px, py + TILE - 4, TILE, 4);
      } else if (id === 'city') {
        g.fillStyle = '#372e2b';
        g.fillRect(px, py, TILE, TILE);
        g.fillStyle = '#2b2422';
        g.fillRect(px + 4, py + 6, TILE - 8, TILE - 12);
        g.fillStyle = '#5f3429';
        g.beginPath();
        g.moveTo(px + 1, py + 24); g.lineTo(px + TILE / 2, py + 7); g.lineTo(px + TILE - 1, py + 24);
        g.closePath(); g.fill();
        g.fillStyle = '#724034';
        g.beginPath();
        g.moveTo(px + 7, py + 24); g.lineTo(px + TILE / 2, py + 13); g.lineTo(px + TILE - 7, py + 24);
        g.closePath(); g.fill();
        g.strokeStyle = 'rgba(230,196,120,.22)';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(px + 1, py + 24); g.lineTo(px + TILE / 2, py + 7); g.lineTo(px + TILE - 1, py + 24); g.stroke();
        g.fillStyle = 'rgba(255,196,110,.45)';
        g.fillRect(px + TILE / 2 - 2, py + 31, 4, 5);
      } else if (id === 'camp') {
        g.fillStyle = 'rgba(0,0,0,.22)';
        g.beginPath();
        g.moveTo(px + 7, py + 37); g.lineTo(px + 23, py + 15); g.lineTo(px + 39, py + 37);
        g.closePath(); g.fill();
        g.fillStyle = '#5a4a33';
        g.beginPath();
        g.moveTo(px + 8, py + 35); g.lineTo(px + 23, py + 17); g.lineTo(px + 38, py + 35);
        g.closePath(); g.fill();
        g.strokeStyle = 'rgba(230,210,160,.18)';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(px + 23, py + 17); g.lineTo(px + 23, py + 35); g.stroke();
        g.strokeStyle = '#6b5a3f';
        g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(px + 23, py + 17); g.lineTo(px + 23, py + 7); g.stroke();
        g.fillStyle = '#a8402f';
        g.beginPath();
        g.moveTo(px + 23, py + 7); g.lineTo(px + 33, py + 11); g.lineTo(px + 23, py + 15);
        g.closePath(); g.fill();
      }
    }

    function drawTree(g, cx, cy, s, dark) {
      g.fillStyle = '#2b2116';
      g.fillRect(cx - 1.2, cy + 2, 2.4, s * 1.9);
      g.fillStyle = dark ? '#1d3a22' : '#254b2b';
      g.beginPath();
      g.moveTo(cx, cy - s * 2.2);
      g.lineTo(cx + s * 1.7, cy + s * 1.4);
      g.lineTo(cx - s * 1.7, cy + s * 1.4);
      g.closePath(); g.fill();
      g.fillStyle = 'rgba(130,190,110,.13)';
      g.beginPath();
      g.moveTo(cx, cy - s * 2.2);
      g.lineTo(cx + s * 1.7, cy + s * 1.4);
      g.lineTo(cx, cy + s * 1.4);
      g.closePath(); g.fill();
    }

    function drawGate(g) {
      var gy = B.map.gateY;
      var x = 13 * TILE, y = gy * TILE;
      g.fillStyle = 'rgba(5,6,9,.78)';
      g.fillRect(x + 3, y + 2, TILE - 6, TILE * 2 - 4);
      g.strokeStyle = '#8a6f3f';
      g.lineWidth = 3;
      g.strokeRect(x + 3, y + 2, TILE - 6, TILE * 2 - 4);
      g.beginPath();
      g.arc(x + TILE / 2, y + 8, TILE / 2 - 3, Math.PI, 0);
      g.stroke();
      g.strokeStyle = 'rgba(140,100,55,.75)';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x + TILE / 2, y + 8); g.lineTo(x + TILE / 2, y + TILE * 2 - 4); g.stroke();
      var i;
      for (i = 1; i < 4; i++) {
        g.beginPath(); g.moveTo(x + 4, y + i * 20); g.lineTo(x + TILE - 4, y + i * 20); g.stroke();
      }
      g.fillStyle = 'rgba(255,170,70,.55)';
      g.beginPath(); g.arc(x + 8, y + TILE, 2.5, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(x + TILE - 8, y + TILE, 2.5, 0, Math.PI * 2); g.fill();
      g.shadowColor = 'rgba(255,150,50,.8)';
      g.shadowBlur = 10;
      g.fillStyle = 'rgba(255,180,80,.5)';
      g.fillRect(x + 6, y + TILE - 3, 4, 4);
      g.fillRect(x + TILE - 10, y + TILE - 3, 4, 4);
      g.shadowBlur = 0;
    }

    function drawKeep(g) {
      var gy = B.map.gateY;
      var kx = 14 * TILE, ky = (gy - 1) * TILE;
      g.fillStyle = 'rgba(0,0,0,.22)';
      g.fillRect(kx + 2, ky + 6, TILE * 2 - 4, TILE * 3 - 10);
      g.fillStyle = '#5b3329';
      g.beginPath();
      g.moveTo(kx - 2, ky + TILE * 1.2);
      g.lineTo(kx + TILE, ky - 8);
      g.lineTo(kx + TILE * 2 + 2, ky + TILE * 1.2);
      g.closePath(); g.fill();
      g.fillStyle = '#6d3d31';
      g.beginPath();
      g.moveTo(kx + 8, ky + TILE * 1.2);
      g.lineTo(kx + TILE, ky + TILE * 0.36);
      g.lineTo(kx + TILE * 2 - 8, ky + TILE * 1.2);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(230,196,120,.22)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(kx - 2, ky + TILE * 1.2);
      g.lineTo(kx + TILE, ky - 8);
      g.lineTo(kx + TILE * 2 + 2, ky + TILE * 1.2);
      g.stroke();
      g.strokeStyle = '#7a6a4a';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(kx + TILE, ky - 8); g.lineTo(kx + TILE, ky - 30); g.stroke();
      g.fillStyle = B.factions.def.color;
      g.beginPath();
      g.moveTo(kx + TILE, ky - 30);
      g.lineTo(kx + TILE + 18, ky - 24);
      g.lineTo(kx + TILE, ky - 17);
      g.closePath(); g.fill();
    }

    /* ==========================================================
     * 单位与高亮绘制
     * ========================================================== */
    function draw(now) {
      ctx.clearRect(0, 0, VW, VH);
      ctx.fillStyle = '#0b0d10';
      ctx.fillRect(0, 0, VW, VH);

      var ox = 0, oy = 0;
      if (now < shakeUntil) {
        var k = (shakeUntil - now) / 240;
        ox = (Math.random() * 2 - 1) * shakePow * k;
        oy = (Math.random() * 2 - 1) * shakePow * k;
      }

      ctx.save();
      ctx.translate(ox, oy);
      ctx.drawImage(bgCanvas, 0, 0, VW, VH);
      drawHighlights(ctx, now);
      drawUnits(ctx, now);
      drawFx(ctx, now);
      ctx.restore();
    }

    function drawHighlights(g, now) {
      if (hover && A.inBounds(hover.x, hover.y, B.W, B.H)) {
        g.strokeStyle = 'rgba(230,196,90,.75)';
        g.lineWidth = 2;
        g.strokeRect(hover.x * TILE + 2, hover.y * TILE + 2, TILE - 4, TILE - 4);
      }

      var u = B.activeUnit();
      if (!u || B.over) return;
      var mine = u.side === B.playerSide && !auto && !busy;
      if (!mine) return;

      if (mode === 'move' && !u.moved) {
        var reach = B.reachable(u);
        var rmap = {};
        reach.tiles.forEach(function (t) {
          rmap[t.x + ',' + t.y] = t;
          if (t.x === u.x && t.y === u.y) return;
          g.fillStyle = 'rgba(78,150,235,.15)';
          g.fillRect(t.x * TILE + 1, t.y * TILE + 1, TILE - 2, TILE - 2);
          g.strokeStyle = 'rgba(110,180,255,.32)';
          g.lineWidth = 1.5;
          g.strokeRect(t.x * TILE + 2.5, t.y * TILE + 2.5, TILE - 5, TILE - 5);
        });
        if (hover && rmap[hover.x + ',' + hover.y]) {
          var path = pathFromReach(u, reach, hover.x, hover.y);
          drawPath(g, u, path);
        }
      } else if (mode === 'attack' || mode === 'action') {
        B.attackTargets(u).forEach(function (t) {
          drawTargetRing(g, t, now, 'rgba(255,90,70,.9)');
        });
      } else if (mode === 'skill' && skillId) {
        var sk = A.SKILLS[skillId];
        B.skillCenters(u, skillId).forEach(function (c) {
          if (c.x === u.x && c.y === u.y) return;
          g.strokeStyle = 'rgba(240,170,80,.5)';
          g.lineWidth = 1.5;
          g.strokeRect(c.x * TILE + 6, c.y * TILE + 6, TILE - 12, TILE - 12);
        });
        if (hover && sk) {
          var valid = B.skillValid(u, skillId, hover);
          if (valid) {
            var rad = sk.radius || 0;
            var xx, yy;
            for (yy = hover.y - rad; yy <= hover.y + rad; yy++) {
              for (xx = hover.x - rad; xx <= hover.x + rad; xx++) {
                if (!A.inBounds(xx, yy, B.W, B.H)) continue;
                g.fillStyle = 'rgba(240,150,60,.20)';
                g.fillRect(xx * TILE + 1, yy * TILE + 1, TILE - 2, TILE - 2);
                g.strokeStyle = 'rgba(240,170,80,.42)';
                g.lineWidth = 1.5;
                g.strokeRect(xx * TILE + 2.5, yy * TILE + 2.5, TILE - 5, TILE - 5);
              }
            }
            var aff = B.skillAffected(u, skillId, hover);
            aff.enemies.forEach(function (e) { drawTargetRing(g, e, now, 'rgba(255,120,60,.95)'); });
            aff.allies.forEach(function (a) { drawTargetRing(g, a, now, 'rgba(110,220,150,.9)'); });
          }
        }
      }
    }

    function pathFromReach(u, reach, tx, ty) {
      var start = u.x + ',' + u.y;
      var k = tx + ',' + ty;
      if (reach.best[k] == null) return [];
      var path = [], guard = 0;
      while (k !== start && guard++ < 300) {
        var p = k.split(',');
        path.unshift({ x: +p[0], y: +p[1] });
        k = reach.prev[k];
        if (!k) break;
      }
      return path;
    }

    function drawPath(g, u, path) {
      if (!path || !path.length) return;
      var sx = u._dx * TILE + TILE / 2, sy = u._dy * TILE + TILE / 2;
      g.strokeStyle = 'rgba(140,205,255,.7)';
      g.lineWidth = 2.5;
      g.setLineDash([6, 5]);
      g.beginPath();
      g.moveTo(sx, sy);
      path.forEach(function (p) {
        g.lineTo(p.x * TILE + TILE / 2, p.y * TILE + TILE / 2);
      });
      g.stroke();
      g.setLineDash([]);
      path.forEach(function (p) {
        g.fillStyle = 'rgba(170,220,255,.9)';
        g.beginPath();
        g.arc(p.x * TILE + TILE / 2, p.y * TILE + TILE / 2, 2.6, 0, Math.PI * 2);
        g.fill();
      });
    }

    function drawTargetRing(g, t, now, color) {
      var px = t._dx * TILE + TILE / 2, py = t._dy * TILE + TILE / 2;
      var r = 20 + Math.sin(now / 170) * 2;
      g.strokeStyle = color;
      g.lineWidth = 2.5;
      g.setLineDash([5, 4]);
      g.lineDashOffset = -now / 55;
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.lineDashOffset = 0;
    }

    function drawUnits(g, now) {
      var list = B.units.slice().sort(function (a, c) {
        return (a._dy - c._dy) || (a._dx - c._dx);
      });
      list.forEach(function (u) {
        if (!u.alive && !u._deadAt) u._deadAt = now;
        var alpha = 1;
        if (!u.alive) {
          alpha = 1 - (now - u._deadAt) / 650;
          if (alpha <= 0) return;
        }
        updateDisplay(u, now);
        drawUnit(g, u, now, alpha);
      });
    }

    function updateDisplay(u, now) {
      if (u._moveAnim) {
        var a = u._moveAnim;
        var p = (now - a.t0) / a.dur;
        if (!(p > 0)) p = 0;
        if (p >= 1) {
          u._dx = u.x; u._dy = u.y; u._moveAnim = null;
        } else {
          var n = a.pts.length - 1;
          var seg = Math.min(n - 1, Math.max(0, Math.floor(p * n)));
          var lp = p * n - seg;
          lp = lp * lp * (3 - 2 * lp);
          var p0 = a.pts[seg], p1 = a.pts[seg + 1];
          u._dx = p0.x + (p1.x - p0.x) * lp;
          u._dy = p0.y + (p1.y - p0.y) * lp;
        }
      } else {
        u._dx += (u.x - u._dx) * 0.18;
        u._dy += (u.y - u._dy) * 0.18;
        if (Math.abs(u._dx - u.x) < 0.002) u._dx = u.x;
        if (Math.abs(u._dy - u.y) < 0.002) u._dy = u.y;
      }
      u._hp += (u.troops - u._hp) * 0.14;
      if (Math.abs(u._hp - u.troops) < 1) u._hp = u.troops;
    }

    function drawUnit(g, u, now, alpha) {
      var px = u._dx * TILE + TILE / 2;
      var py = u._dy * TILE + TILE / 2;
      g.save();
      g.globalAlpha = alpha;

      /* 影子 */
      g.fillStyle = 'rgba(0,0,0,.42)';
      g.beginPath();
      g.ellipse(px, py + 16, 17, 5.5, 0, 0, Math.PI * 2);
      g.fill();

      /* 当前行动者光环 */
      if (u.id === B.activeId && !B.over) {
        var rr = 22 + Math.sin(now / 300) * 1.5;
        g.strokeStyle = 'rgba(232,196,90,.9)';
        g.lineWidth = 2;
        g.setLineDash([4, 4]);
        g.lineDashOffset = -now / 55;
        g.beginPath();
        g.arc(px, py, rr, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.lineDashOffset = 0;
      }

      /* 底盘 */
      var grd = g.createRadialGradient(px - 5, py - 7, 2, px, py, 17);
      grd.addColorStop(0, '#3c4553');
      grd.addColorStop(1, '#11151c');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(px, py, 16, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = u.color;
      g.lineWidth = 3;
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.15)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(px, py, 12.5, 0, Math.PI * 2);
      g.stroke();

      /* 姓氏 */
      g.font = 'bold 18px "Noto Serif SC","Songti SC",SimSun,serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 3.5;
      g.strokeStyle = 'rgba(0,0,0,.85)';
      g.fillStyle = '#f2e8cf';
      var ch = u.name.charAt(0);
      g.strokeText(ch, px, py + 1);
      g.fillText(ch, px, py + 1);

      /* 兵力条 */
      var bw = 42, bh = 5, bx = px - bw / 2, by = py - 31;
      g.fillStyle = 'rgba(0,0,0,.72)';
      g.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      var pct = clamp(u._hp / u.maxTroops, 0, 1);
      g.fillStyle = hpColor(pct);
      g.fillRect(bx, by, bw * pct, bh);
      g.strokeStyle = 'rgba(255,255,255,.20)';
      g.lineWidth = 1;
      g.strokeRect(bx - 0.5, by - 0.5, bw + 1, bh + 1);

      /* 气力条 */
      g.fillStyle = 'rgba(0,0,0,.65)';
      g.fillRect(bx, by + 7, bw, 2.5);
      g.fillStyle = '#4fa3d1';
      g.fillRect(bx, by + 7, bw * clamp(u.energy / 100, 0, 1), 2.5);

      /* 姓名与兵力 */
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.font = '600 11px "Noto Serif SC","Microsoft YaHei",sans-serif';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,.9)';
      g.strokeText(u.name, px, py + 21);
      g.fillStyle = '#e8e2d3';
      g.fillText(u.name, px, py + 21);

      g.font = '10px "Microsoft YaHei",sans-serif';
      g.lineWidth = 2.5;
      g.strokeText(shortNum(u._hp), px, py + 35);
      g.fillStyle = 'rgba(200,205,212,.9)';
      g.fillText(shortNum(u._hp), px, py + 35);

      /* 状态图标 */
      if (u.burns && u.burns.length) {
        g.fillStyle = '#ff8a3c';
        g.beginPath();
        g.moveTo(px - 22, py - 18);
        g.quadraticCurveTo(px - 26, py - 24, px - 22, py - 27);
        g.quadraticCurveTo(px - 18, py - 23, px - 22, py - 18);
        g.fill();
      }
      var am = modSum(u, 'atk'), dm = modSum(u, 'def');
      if (am > 0 || dm > 0) {
        g.strokeStyle = '#e8c45a';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(px + 20, py - 21);
        g.lineTo(px + 25, py - 26);
        g.lineTo(px + 30, py - 21);
        g.stroke();
      }
      if (am < 0) {
        g.strokeStyle = '#b48ad6';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(px + 20, py - 26);
        g.lineTo(px + 25, py - 21);
        g.lineTo(px + 30, py - 26);
        g.stroke();
      }

      g.restore();
    }

    /* ==========================================================
     * 特效
     * ========================================================== */
    function addFx(o) {
      o.t0 = nowMs();
      fx.push(o);
      if (fx.length > 80) fx.shift();
    }

    function addFloat(x, y, text, color, size) {
      addFx({ kind: 'float', x: x, y: y, text: text, color: color, size: size || 13, dur: 900 });
    }
    function addFloatUnit(u, text, color, size) {
      addFloat(u.x * TILE + TILE / 2, u.y * TILE + 4, text, color, size);
    }
    function addBolt(x1, y1, x2, y2, color, dur) {
      addFx({ kind: 'bolt', x1: x1, y1: y1, x2: x2, y2: y2, color: color, dur: dur || 260 });
    }
    function addSlash(x1, y1, x2, y2, color, dur) {
      addFx({ kind: 'slash', x1: x1, y1: y1, x2: x2, y2: y2, color: color, dur: dur || 280 });
    }
    function addBoom(x, y, r, color, dur) {
      addFx({ kind: 'boom', x: x, y: y, r: r || 20, color: color || '#ff9a5a', dur: dur || 420 });
    }
    function addRing(x, y, r, color, dur) {
      addFx({ kind: 'ring', x: x, y: y, r: r || 24, color: color || '#e8c45a', dur: dur || 420 });
    }
    function shake(ms, pow) {
      shakeUntil = Math.max(shakeUntil, nowMs() + ms);
      shakePow = Math.max(shakePow, pow || 3);
    }

    function drawFx(g, now) {
      for (var i = fx.length - 1; i >= 0; i--) {
        var f = fx[i];
        var p = (now - f.t0) / f.dur;
        /* rAF 时间戳偶尔会略早于 setTimeout 中记录的 performance.now()，
           这里钳制进度，避免出现负半径导致 canvas 抛错 */
        if (!(p > 0)) p = 0;
        if (p >= 1) { fx.splice(i, 1); continue; }
        g.save();
        if (f.kind === 'float') {
          var fy = f.y - p * 30;
          g.globalAlpha = 1 - Math.pow(p, 2);
          g.font = '700 ' + f.size + 'px "Noto Serif SC","Microsoft YaHei",sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.lineWidth = 3;
          g.strokeStyle = 'rgba(0,0,0,.85)';
          g.strokeText(f.text, f.x, fy);
          g.fillStyle = f.color;
          g.fillText(f.text, f.x, fy);
        } else if (f.kind === 'slash') {
          var ang = Math.atan2(f.y2 - f.y1, f.x2 - f.x1);
          var mx = (f.x1 + f.x2) / 2, my = (f.y1 + f.y2) / 2;
          g.translate(mx, my);
          g.rotate(ang);
          g.globalAlpha = 1 - p;
          g.strokeStyle = f.color;
          g.lineWidth = 3.5 * (1 - p) + 1;
          g.beginPath();
          g.arc(0, 0, 27, -1.15 + p * 0.4, 1.15 + p * 0.4);
          g.stroke();
          g.lineWidth = 1.8;
          g.globalAlpha = (1 - p) * 0.7;
          g.beginPath();
          g.arc(0, 0, 20, -1.25, 1.25);
          g.stroke();
        } else if (f.kind === 'bolt') {
          var ease = p * p * (3 - 2 * p);
          var bx = f.x1 + (f.x2 - f.x1) * ease;
          var by = f.y1 + (f.y2 - f.y1) * ease;
          var ddx = f.x2 - f.x1, ddy = f.y2 - f.y1;
          var dlen = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
          g.globalAlpha = 1;
          g.strokeStyle = f.color;
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(bx - ddx / dlen * 18, by - ddy / dlen * 18);
          g.lineTo(bx, by);
          g.stroke();
          g.fillStyle = f.color;
          g.shadowColor = f.color;
          g.shadowBlur = 10;
          g.beginPath();
          g.arc(bx, by, 3, 0, Math.PI * 2);
          g.fill();
          g.shadowBlur = 0;
        } else if (f.kind === 'boom') {
          g.globalAlpha = 1 - p;
          var rad = f.r * (0.4 + p * 1.3);
          var grd = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, rad);
          grd.addColorStop(0, 'rgba(255,245,210,.9)');
          grd.addColorStop(0.35, f.color);
          grd.addColorStop(1, 'rgba(160,50,20,0)');
          g.fillStyle = grd;
          g.beginPath();
          g.arc(f.x, f.y, rad, 0, Math.PI * 2);
          g.fill();
          var k;
          for (k = 0; k < 5; k++) {
            var a = k * 1.256 + f.t0;
            var d = rad * (0.6 + p * 0.7);
            g.fillStyle = f.color;
            g.globalAlpha = (1 - p) * 0.8;
            g.beginPath();
            g.arc(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 2 * (1 - p) + 0.5, 0, Math.PI * 2);
            g.fill();
          }
        } else if (f.kind === 'ring') {
          g.globalAlpha = 1 - p;
          g.strokeStyle = f.color;
          g.lineWidth = 3 * (1 - p) + 0.5;
          g.beginPath();
          g.arc(f.x, f.y, f.r * (0.4 + p * 1.4), 0, Math.PI * 2);
          g.stroke();
        }
        g.restore();
      }
    }

    /* ==========================================================
     * 事件时间轴
     * ========================================================== */
    function durationOf(ev) {
      var d;
      switch (ev.k) {
        case 'move': d = (ev.path ? ev.path.length : 1) * 120 + 60; break;
        case 'attack': d = 300; break;
        case 'counter': d = 260; break;
        case 'skill': d = 460; break;
        case 'damage': d = 170; break;
        case 'burn': d = 170; break;
        case 'heal': d = 190; break;
        case 'mod': d = 170; break;
        case 'die': d = 330; break;
        case 'round': d = 760; break;
        default: d = 110;
      }
      return Math.max(60, d / speed);
    }

    function applyEvent(ev) {
      var u = ev.unit;
      switch (ev.k) {
        case 'move':
          startMoveAnim(ev.unit, ev.path);
          break;
        case 'attack': {
          var a = ev.unit, t = ev.target;
          var ax = a.x * TILE + TILE / 2, ay = a.y * TILE + TILE / 2;
          var tx = t.x * TILE + TILE / 2, ty = t.y * TILE + TILE / 2;
          if (ev.kind === 'ranged') addBolt(ax, ay, tx, ty, '#e8cf87', 240);
          else {
            addSlash(ax, ay, tx, ty, '#ffe9b0', 260);
            addBoom(tx, ty, 9, '#ff9a6a', 300);
          }
          shake(180, ev.flank > 0 ? 4.5 : 2.8);
          break;
        }
        case 'counter': {
          var ca = ev.unit, ct = ev.target;
          addSlash(ca.x * TILE + TILE / 2, ca.y * TILE + TILE / 2,
            ct.x * TILE + TILE / 2, ct.y * TILE + TILE / 2, '#c9a0e8', 220);
          break;
        }
        case 'skill': {
          var sk = A.SKILLS[ev.skillId];
          if (!sk) break;
          var su = ev.unit;
          var sx = su.x * TILE + TILE / 2, sy = su.y * TILE + TILE / 2;
          var cx = ev.center.x * TILE + TILE / 2, cy = ev.center.y * TILE + TILE / 2;
          banner(sk.name, 'skill');
          addRing(sx, sy, 26, 'rgba(232,196,90,.9)', 420);

          if (ev.skillId === 'fire') {
            addBolt(sx, sy, cx, cy, '#ff7a30', 260);
            addBoom(cx, cy, 34, '#ff7a30', 520);
            ev.targets.forEach(function (t) {
              addBoom(t.x * TILE + TILE / 2, t.y * TILE + TILE / 2, 20, '#ff9a3c', 420);
            });
          } else if (ev.skillId === 'volley') {
            var i;
            for (i = 0; i < 6; i++) {
              var ax2 = cx - 40 + i * 16;
              addBolt(ax2, Math.max(0, cy - 150), cx - 30 + i * 12, cy + 8, 'rgba(230,210,150,.9)', 280);
            }
            addBoom(cx, cy, 26, '#d8c98a', 420);
            ev.targets.forEach(function (t) {
              addBoom(t.x * TILE + TILE / 2, t.y * TILE + TILE / 2, 13, '#c9b073', 360);
            });
          } else if (ev.skillId === 'peerless') {
            addRing(sx, sy, 30, '#ffd27a', 500);
            addRing(sx, sy, 16, '#ff9a5a', 420);
            shake(260, 5);
            ev.targets.forEach(function (t) {
              addSlash(sx, sy, t.x * TILE + TILE / 2, t.y * TILE + TILE / 2, '#ffe2a0', 300);
            });
          } else if (ev.skillId === 'inspire' || ev.skillId === 'guard') {
            ev.targets.forEach(function (t) {
              addRing(t.x * TILE + TILE / 2, t.y * TILE + TILE / 2, 24, ev.skillId === 'inspire' ? '#e8c45a' : '#7db8e0', 520);
              addFloatUnit(t, sk.name, ev.skillId === 'inspire' ? '#f0cf72' : '#8fc8f0', 12);
            });
          } else if (ev.skillId === 'rest') {
            addRing(sx, sy, 26, '#7de29a', 520);
            addFloatUnit(su, '休整', '#7de29a', 12);
          } else if (ev.skillId === 'disrupt') {
            ev.targets.forEach(function (t) {
              addBolt(sx, sy, t.x * TILE + TILE / 2, t.y * TILE + TILE / 2, '#b48ad6', 280);
              addRing(t.x * TILE + TILE / 2, t.y * TILE + TILE / 2, 20, '#b48ad6', 420);
            });
          } else if (ev.skillId === 'duel') {
            addSlash(sx, sy, cx, cy, '#ffe2a0', 380);
            addBoom(cx, cy, 26, '#ffb05a', 460);
            shake(320, 7);
          } else if (ev.skillId === 'snipe') {
            addBolt(sx, sy, cx, cy, '#a8e0ff', 160);
            addBoom(cx, cy, 14, '#a8e0ff', 320);
          } else {
            addBolt(sx, sy, cx, cy, '#ffe0a0', 260);
            ev.targets.forEach(function (t) {
              if (t.side === su.side) return;
              addBoom(t.x * TILE + TILE / 2, t.y * TILE + TILE / 2, 18, '#ff9a5a', 380);
            });
          }
          break;
        }
        case 'damage':
          addFloatUnit(ev.unit, '-' + fmt(ev.amount), '#ff8a6a', ev.kind === 'burn' ? 12 : 14);
          if (ev.kind === 'burn') {
            addBoom(ev.unit.x * TILE + TILE / 2, ev.unit.y * TILE + TILE / 2, 12, '#ff9a3c', 320);
          } else {
            addBoom(ev.unit.x * TILE + TILE / 2, ev.unit.y * TILE + TILE / 2, 7, '#ffb08a', 260);
            shake(130, 2);
          }
          break;
        case 'heal':
          addFloatUnit(ev.unit, '+' + fmt(ev.amount), '#7de29a', 14);
          addRing(ev.unit.x * TILE + TILE / 2, ev.unit.y * TILE + TILE / 2, 22, '#7de29a', 380);
          break;
        case 'mod':
          addFloatUnit(ev.unit, ev.text, ev.good ? '#e8cf87' : '#c0a0e0', 12);
          addRing(ev.unit.x * TILE + TILE / 2, ev.unit.y * TILE + TILE / 2, 18,
            ev.good ? '#e8cf87' : '#b48ad6', 360);
          break;
        case 'burn':
          addFloatUnit(ev.unit, '灼烧 -' + fmt(ev.amount), '#ff9a3c', 12);
          break;
        case 'die':
          ev.unit._deadAt = nowMs();
          addBoom(ev.unit.x * TILE + TILE / 2, ev.unit.y * TILE + TILE / 2, 26, '#d1655a', 520);
          addFloatUnit(ev.unit, '溃灭', '#ff6a5a', 15);
          shake(220, 4);
          break;
        case 'round':
          banner('第 ' + ev.round + ' 回合', 'round');
          break;
      }
    }

    function startMoveAnim(u, path) {
      if (!path || !path.length) return;
      var pts = [{ x: u._dx, y: u._dy }];
      path.forEach(function (p) { pts.push({ x: p.x, y: p.y }); });
      u._moveAnim = {
        pts: pts,
        t0: nowMs(),
        dur: Math.max(140, (path.length * 120) / speed)
      };
    }

    function playEvents(events, done) {
      if (closed) return;
      renderLog();
      renderAll();
      if (!events || !events.length) {
        if (!closed) done();
        return;
      }
      var t = 0;
      events.forEach(function (ev) {
        var d = durationOf(ev);
        var delay = t;
        timers.push(setTimeout(function () {
          if (!closed) applyEvent(ev);
        }, delay));
        t += d;
      });
      timers.push(setTimeout(function () {
        if (closed) return;
        renderLog();
        renderAll();
        done();
      }, t + 20));
    }

    /* ==========================================================
     * HUD
     * ========================================================== */
    function armyHTML(f, cur, init) {
      var pct = init ? clamp(cur / init * 100, 0, 100) : 0;
      return '<div class="nm"><i class="flag" style="background:' + f.color + '"></i>' +
        '<b>' + esc(f.name) + '</b>' +
        '<span>' + fmt(cur) + ' <em>/ ' + fmt(init) + '</em></span></div>' +
        '<div class="bar"><i style="width:' + pct.toFixed(1) + '%;background:' + f.color + '"></i></div>';
    }

    function renderTop() {
      m.q('#btArmyA').innerHTML = armyHTML(B.factions.atk, B.total('atk'), B.initialTotal('atk'));
      m.q('#btArmyD').innerHTML = armyHTML(B.factions.def, B.total('def'), B.initialTotal('def'));
      m.q('#btRound').innerHTML = '第 <b>' + Math.max(1, B.round) + '</b> / ' + B.maxRound + ' 回合';
    }

    function renderOrder() {
      var h = '', shown = 0;
      var start = Math.max(0, B.turnIndex);
      for (var i = start; i < B.order.length && shown < 6; i++) {
        var u = B.getUnit(B.order[i]);
        if (!u || !u.alive) continue;
        var on = u.id === B.activeId;
        h += '<div class="btOrd' + (on ? ' on' : '') + '" style="--c:' + u.color + '">' +
          '<i></i><span class="nm">' + esc(u.name) + '</span>' +
          '<span class="tr">' + shortNum(u.troops) + '</span></div>';
        shown++;
      }
      if (!h) h = '<div class="dim" style="font-size:11px;padding:4px 7px">—</div>';
      m.q('#btOrder').innerHTML = h;
    }

    function renderUnit() {
      var el = m.q('#btUnit');
      var u = B.activeUnit();
      if (!u) {
        el.innerHTML = '<div class="dim" style="font-size:12px">战斗已结束</div>';
        return;
      }
      var arch = A.ARCHETYPES[u.archetype];
      var ter = A.terrainAt(B.map, u.x, u.y);
      var pct = clamp(u.troops / u.maxTroops * 100, 0, 100);
      var h = '<div class="un">' + esc(u.name) + '<span class="tag">' + arch.name + '</span>' +
        (u.side === B.playerSide ? '<span class="tag mine">我方</span>' : '<span class="tag foe">敌方</span>') +
        '</div>';
      h += '<div class="meta">统 ' + u.lead + '　武 ' + u.war + '　智 ' + u.int + '　·　' + esc(arch.desc) + '</div>';
      h += '<div class="bar"><i style="width:' + pct.toFixed(1) + '%;background:' + hpColor(pct / 100) + '"></i></div>';
      h += '<div class="btMini"><span>兵力 <b>' + fmt(u.troops) + '</b> / ' + fmt(u.maxTroops) + '</span>' +
        '<span>士气 <b>' + Math.round(u.morale) + '</b></span>' +
        '<span>气力 <b>' + Math.round(u.energy) + '</b></span></div>';
      h += '<div class="btMini"><span>地形 <b>' + (ter ? esc(ter.name) : '—') + '</b>' +
        (ter && ter.def ? '（减伤 ' + Math.round(ter.def * 100) + '%）' : '') + '</span>' +
        '<span>移动 <b>' + u.move + '</b></span><span>射程 <b>' + B.rangeOf(u) + '</b></span></div>';
      var chips = '';
      (u.mods || []).forEach(function (md) {
        var bad = (md.atk || 0) < 0 || (md.def || 0) < 0;
        chips += '<span class="btChip' + (bad ? ' bad' : '') + '">' + esc(md.name) + ' ' + md.turns + '回合</span>';
      });
      if (u.burns && u.burns.length) {
        chips += '<span class="btChip bad">灼烧 ' + u.burns[0].turns + '回合</span>';
      }
      if (chips) h += '<div class="btChips">' + chips + '</div>';
      el.innerHTML = h;
    }

    function hasSkillTarget(u, sid) {
      if (sid === 'rest' && u.troops >= u.maxTroops) return false;
      var centers = B.skillCenters(u, sid);
      for (var i = 0; i < centers.length; i++) {
        if (B.skillValid(u, sid, centers[i])) return true;
      }
      return false;
    }

    function renderActions() {
      var el = m.q('#btActions');
      if (B.over) { el.innerHTML = '<div class="btWait">点击右下角「确 定」返回大地图</div>'; return; }
      var u = B.activeUnit();
      if (!u) { el.innerHTML = '<div class="btWait">等待下一回合…</div>'; return; }

      var mine = u.side === B.playerSide && !auto;
      if (auto) { el.innerHTML = '<div class="btWait">自动战斗中…… <span class="dim">点击「手动接管」可亲自指挥</span></div>'; return; }
      if (u.side !== B.playerSide) {
        el.innerHTML = '<div class="btWait">' + esc(B.factions[u.side].name) + '军行动中……</div>';
        return;
      }
      if (busy) { el.innerHTML = '<div class="btWait">行动中……</div>'; return; }

      var h = '';
      var canAtk = B.attackTargets(u).length > 0;
      h += '<button class="btn sm" data-a="attack" ' + (canAtk ? '' : 'disabled') + '>攻击</button>';

      u.skills.forEach(function (sid, i) {
        var sk = A.SKILLS[sid];
        if (!sk) return;
        var ready = B.skillReady(u, sid) && hasSkillTarget(u, sid);
        var cd = u.cd[sid] || 0;
        h += '<button class="btSkill' + (mode === 'skill' && skillId === sid ? ' on' : '') + '"' +
          ' data-skill="' + sid + '" ' + (ready ? '' : 'disabled') +
          ' title="' + esc(sk.desc) + '">' +
          sk.name + '<small>' + (cd > 0 ? '冷却 ' + cd : (u.energy < sk.cost ? '气力不足' : '气 ' + sk.cost)) + '</small></button>';
      });

      h += '<button class="btn sm" data-a="wait">待机</button>';
      if (u.moved) h += '<button class="btn sm" data-a="undo">撤销移动</button>';
      el.innerHTML = h;
    }

    function renderHint() {
      var u = B.activeUnit();
      var h = '';
      if (B.over) {
        h = '战斗结束 · 点击右下角「确 定」返回';
      } else if (!u) {
        h = '……';
      } else if (auto) {
        h = '自动战斗中 · 点击「手动接管」可亲自指挥';
      } else if (u.side !== B.playerSide) {
        h = '<span class="hot">' + esc(B.factions[u.side].name) + '</span> 军行动中……';
      } else if (busy) {
        h = '行动中……';
      } else if (mode === 'skill' && skillId) {
        h = '<span class="hot">' + A.SKILLS[skillId].name + '</span> · 点击目标施放（Esc 取消）';
      } else if (mode === 'attack') {
        h = '<span class="hot">选择攻击目标</span> · 点击红圈敌军（Esc 取消）';
      } else if (mode === 'action') {
        h = '点击<b>红圈敌军</b>攻击 · 选择<b>技能</b>施放 · 也可<b>撤销移动</b>或<b>待机</b>';
      } else {
        h = '点击<b>蓝格</b>移动 · 点击<b>敌军</b>接敌/攻击 · <b>数字键</b>施放技能 · <b>空格</b>待机 · 右键取消';
      }
      m.q('#btHint').innerHTML = h;
    }

    function renderLog() {
      var h = '';
      B.log.slice(-70).forEach(function (e) {
        h += '<div class="' + (e.cls || '') + '">' + esc(e.text) + '</div>';
      });
      var el = m.q('#btLog');
      el.innerHTML = h;
      el.scrollTop = el.scrollHeight;
    }

    function renderFooter() {
      var done = m.q('[data-x="done"]');
      done.disabled = !B.over;
      done.textContent = B.over ? '确　定' : '战斗进行中';

      var autoBtn = m.q('[data-x="auto"]');
      autoBtn.disabled = !B.playerSide || B.over;
      autoBtn.textContent = auto ? '手动接管' : '自动战斗';
      autoBtn.classList.toggle('gold', auto);

      var ret = m.q('[data-x="retreat"]');
      ret.disabled = !B.playerSide || B.over;
      ret.textContent = retreatArmed ? '确认撤退？' : '撤　退';
      ret.classList.toggle('danger', retreatArmed);

      m.q('[data-x="speed"]').textContent = '速度 ×' + speed;
    }

    function renderAll() {
      renderTop();
      renderOrder();
      renderUnit();
      renderActions();
      renderHint();
      renderFooter();
    }

    /* ==========================================================
     * 回合驱动
     * ========================================================== */
    function beginTurn() {
      if (closed) return;
      if (B.over) { showVerdict(); return; }
      var u = B.activeUnit();
      if (!u) {
        var evs = B.advance();
        playEvents(evs, beginTurn);
        return;
      }
      turnToken++;
      var token = turnToken;
      mode = 'move';
      skillId = null;

      var playerTurn = u.side === B.playerSide && !auto;
      if (playerTurn) {
        busy = false;
        renderAll();
      } else {
        busy = true;
        renderAll();
        timers.push(setTimeout(function () {
          if (closed || token !== turnToken || B.over) return;
          if (B.activeId !== u.id) return;
          if (!auto && u.side === B.playerSide) { busy = false; renderAll(); return; }
          var res = B.aiTakeTurn(u);
          playEvents(res.events, function () {
            postAction(u);
          });
        }, 430 / speed));
      }
    }

    function postAction(u) {
      if (closed) return;
      if (B.over) { showVerdict(); return; }
      busy = true;
      var res = B.finishUnit(u);
      playEvents(res.events, function () {
        if (B.over) { showVerdict(); return; }
        beginTurn();
      });
    }

    /* ==========================================================
     * 玩家操作
     * ========================================================== */
    function canInteract() {
      if (closed || B.over || busy) return false;
      var u = B.activeUnit();
      return !!u && u.side === B.playerSide && !auto;
    }

    function tileFromEvent(e) {
      var r = canvas.getBoundingClientRect();
      return {
        x: Math.floor((e.clientX - r.left) / r.width * B.W),
        y: Math.floor((e.clientY - r.top) / r.height * B.H)
      };
    }

    function doMove(path, after) {
      if (!canInteract()) return;
      var u = B.activeUnit();
      if (!path || !path.length) return;
      busy = true;
      var evs = B.moveUnit(u, path);
      if (!evs.length) { busy = false; renderAll(); return; }
      mode = 'action';
      skillId = null;
      playEvents(evs, function () {
        busy = false;
        if (after) after();
        else renderAll();
      });
    }

    function findAttackSpot(u, enemy) {
      var reach = B.reachable(u);
      var best = null;
      reach.tiles.forEach(function (t) {
        if (t.x === u.x && t.y === u.y) return;
        if (B.unitAt(t.x, t.y)) return;
        if (B.rangeOfAt(u, t) < dist(t, enemy)) return;
        if (!best || t.cost < best.cost) best = t;
      });
      return best;
    }

    function executeAttack(target) {
      if (!canInteract()) return;
      var u = B.activeUnit();
      if (!u || !target) return;
      busy = true;
      var evs = B.attack(u, target.id);
      if (!evs.length) {
        busy = false;
        UItoast('目标不在攻击范围内', 'bad');
        renderAll();
        return;
      }
      skillId = null;
      playEvents(evs, function () {
        postAction(u);
      });
    }

    function executeSkill(sid, center) {
      if (!canInteract()) return;
      var u = B.activeUnit();
      busy = true;
      var evs = B.useSkill(u, sid, center);
      if (!evs.length) {
        busy = false;
        UItoast('无法施放', 'bad');
        renderAll();
        return;
      }
      mode = 'action';
      skillId = null;
      playEvents(evs, function () {
        postAction(u);
      });
    }

    function doWait() {
      if (!canInteract()) return;
      var u = B.activeUnit();
      busy = true;
      B.pushLog(u.name + ' 按兵不动', 'wait');
      addFloatUnit(u, '待机', 'rgba(200,205,212,.9)', 12);
      postAction(u);
    }

    function chooseSkill(sid) {
      if (!canInteract()) return;
      var u = B.activeUnit();
      var sk = A.SKILLS[sid];
      if (!sk) return;
      if (sk.target === 'self') {
        executeSkill(sid, { x: u.x, y: u.y });
        return;
      }
      mode = 'skill';
      skillId = sid;
      renderAll();
    }

    function cancelTargeting() {
      if (B.over) return;
      var u = B.activeUnit();
      if (!u) return;
      mode = u.moved ? 'action' : 'move';
      skillId = null;
      renderAll();
    }

    function onCanvasClick(e) {
      if (!canInteract()) return;
      var u = B.activeUnit();
      var tile = tileFromEvent(e);
      if (!A.inBounds(tile.x, tile.y, B.W, B.H)) return;

      if (mode === 'skill' && skillId) {
        if (B.skillValid(u, skillId, tile)) executeSkill(skillId, tile);
        else UItoast('该位置不是有效目标', 'bad');
        return;
      }

      var target = B.unitAt(tile.x, tile.y);
      var enemy = !!(target && target.side !== u.side);
      var inRange = enemy && dist(u, target) <= B.rangeOf(u);

      if (mode === 'attack') {
        if (inRange) executeAttack(target);
        else UItoast('请选择红圈内的敌军（Esc 取消）', 'bad');
        return;
      }

      if (enemy) {
        if (inRange) {
          executeAttack(target);
          return;
        }
        if (!u.moved) {
          var spot = findAttackSpot(u, target);
          if (spot) {
            var path = B.findPath(u, spot.x, spot.y);
            if (path && path.length) {
              doMove(path, function () {
                mode = 'attack';
                UItoast('已接敌，点击敌军发动攻击', 'good');
                renderAll();
              });
              return;
            }
          }
          UItoast('移动力不足，无法接近该敌军', 'bad');
        } else {
          UItoast('距离不足，无法攻击该敌军', 'bad');
        }
        return;
      }

      if (target) return;

      if (!u.moved) {
        var p = B.findPath(u, tile.x, tile.y);
        if (p && p.length) { doMove(p); return; }
        if (tile.x === u.x && tile.y === u.y) return;
        UItoast('该位置无法到达', 'bad');
      }
    }

    /* ==========================================================
     * 提示
     * ========================================================== */
    function updateTip(tile, clientX, clientY) {
      var tip = m.q('#btTip');
      if (B.over) { tip.classList.remove('on'); return; }
      if (!tile || !A.inBounds(tile.x, tile.y, B.W, B.H)) { tip.classList.remove('on'); return; }
      var ter = A.terrainAt(B.map, tile.x, tile.y);
      var u = B.unitAt(tile.x, tile.y);
      var h = '';
      if (ter) {
        h += '<b>' + esc(ter.name) + '</b> · 移动消耗 ' + ter.cost +
          (ter.def ? ' · 减伤 ' + Math.round(ter.def * 100) + '%' : '') +
          (ter.range ? ' · 射程 +1' : '') + (ter.pass ? '' : ' · 不可通行');
      }

      var active = B.activeUnit();
      if (u) {
        var arch = A.ARCHETYPES[u.archetype];
        h += '<div style="margin-top:4px"><b style="color:' + u.color + '">' + esc(u.name) + '</b> ' +
          '<span class="dim">' + (u.side === B.playerSide ? '我方' : '敌方') + ' · ' + arch.name + '</span></div>';
        h += '<div>兵力 ' + fmt(u.troops) + ' / ' + fmt(u.maxTroops) + ' · 士气 ' + Math.round(u.morale) +
          ' · 气 ' + Math.round(u.energy) + '</div>';
        h += '<div>统 ' + u.lead + '　武 ' + u.war + '　智 ' + u.int + '</div>';
        if (active && !busy && u.side !== active.side && mode !== 'skill') {
          if (dist(active, u) <= B.rangeOf(active)) {
            h += '<div class="r">预计伤害 ' + fmt(B.previewAttack(active, u)) + '</div>';
            if (dist(active, u) === 1) {
              h += '<div class="dim">可能遭到反击</div>';
            }
          }
        }
        if (u.mods && u.mods.length) {
          h += '<div class="g">';
          u.mods.forEach(function (md) { h += esc(md.name) + '（' + md.turns + '） '; });
          h += '</div>';
        }
      }

      if (mode === 'skill' && skillId && active && !busy) {
        var sk = A.SKILLS[skillId];
        var valid = B.skillValid(active, skillId, tile);
        if (valid) {
          var aff = B.skillAffected(active, skillId, tile);
          var n = aff.enemies.length + aff.allies.length;
          var dmgTotal = 0;
          aff.enemies.forEach(function (e) { dmgTotal += B.previewSkill(active, skillId, e); });
          h += '<div style="margin-top:4px" class="g">' + esc(sk.name) + ' · 波及 ' + n + ' 支部队' +
            (dmgTotal ? ' · 预计伤害 ' + fmt(dmgTotal) : '') + '</div>';
        } else {
          h += '<div style="margin-top:4px" class="r">目标无效</div>';
        }
      }

      tip.innerHTML = h;
      tip.classList.add('on');
      var rect = wrap.getBoundingClientRect();
      var x = clientX - rect.left + 16;
      var y = clientY - rect.top + 16;
      if (x + 250 > rect.width) x = clientX - rect.left - 250;
      if (y + 160 > rect.height) y = Math.max(4, clientY - rect.top - 160);
      tip.style.left = Math.max(4, x) + 'px';
      tip.style.top = Math.max(4, y) + 'px';
    }

    /* ==========================================================
     * 结算
     * ========================================================== */
    function showVerdict() {
      if (resultShown || closed) return;
      resultShown = true;
      busy = false;
      auto = false;
      mode = 'idle';
      skillId = null;
      retreatArmed = false;

      var mine = B.playerSide;
      var win;
      if (mine) win = B.winner === mine;
      else win = B.winner === 'atk';

      var big, sub;
      if (mine === 'atk') {
        big = win ? '大 捷' : '败 退';
        sub = B.reason;
      } else if (mine === 'def') {
        big = win ? '守 城 成 功' : '城 池 陷 落';
        sub = B.reason;
      } else {
        big = B.winner === 'atk' ? '攻 方 胜 利' : '守 方 胜 利';
        sub = B.reason;
      }

      var initA = B.initialTotal('atk'), initD = B.initialTotal('def');
      var curA = B.total('atk'), curD = B.total('def');
      var ov = m.q('#btOverlay');
      ov.className = 'btOverlay on ' + (win ? 'win' : 'lose');
      ov.innerHTML =
        '<div class="big">' + esc(big) + '</div>' +
        '<div class="why">' + esc(sub) + '</div>' +
        '<div class="cas">' +
          esc(B.factions.atk.name) + '军　' + fmt(initA) + ' → ' + fmt(curA) +
            '（损 ' + fmt(initA - curA) + '）<br>' +
          esc(B.factions.def.name) + '军　' + fmt(initD) + ' → ' + fmt(curD) +
            '（损 ' + fmt(initD - curD) + '）<br>' +
          '历 ' + Math.max(1, B.round) + ' 回合 · ' + esc(B.cityNames.def) + '城下' +
        '</div>';

      renderAll();
      renderLog();
    }

    function finishBattle() {
      if (finished || !B.over) return;
      finished = true;
      var report = B.buildReport();
      cleanup();
      if (opts.onFinish) opts.onFinish(report);
    }

    function cleanup() {
      if (closed) return;
      closed = true;
      if (raf) cancelAnimationFrame(raf);
      timers.forEach(function (t) { clearTimeout(t); });
      timers.length = 0;
      if (bannerTimer) clearTimeout(bannerTimer);
      if (retreatTimer) clearTimeout(retreatTimer);
      document.removeEventListener('keydown', onKey, true);
      m.close();
    }

    function banner(text, cls) {
      var el = m.q('#btBanner');
      if (!el) return;
      el.textContent = text;
      el.className = 'btBanner';
      void el.offsetWidth;
      el.className = 'btBanner on ' + (cls || '');
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(function () {
        if (el) el.className = 'btBanner';
      }, 950 / speed);
    }

    function UItoast(msg, type) {
      if (SG.UI && SG.UI.toast) SG.UI.toast(msg, type);
    }

    /* ==========================================================
     * 事件绑定
     * ========================================================== */
    function onKey(e) {
      if (closed) return;
      if (e.key === 'Escape') {
        if (mode === 'skill' || mode === 'attack') {
          cancelTargeting();
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        if (canInteract()) {
          e.preventDefault();
          e.stopPropagation();
          doWait();
        }
        return;
      }
      if (/^[1-4]$/.test(e.key) && canInteract()) {
        var u = B.activeUnit();
        var sid = u.skills[parseInt(e.key, 10) - 1];
        if (sid && B.skillReady(u, sid) && hasSkillTarget(u, sid)) {
          e.preventDefault();
          chooseSkill(sid);
        }
      }
    }

    function toggleAuto() {
      if (!B.playerSide || B.over) return;
      auto = !auto;
      var u = B.activeUnit();
      if (auto) {
        renderAll();
        /* 若正轮到我方且尚未开始行动，立刻交给 AI 接管 */
        if (u && u.side === B.playerSide && !busy) beginTurn();
      } else {
        renderAll();
      }
    }

    function toggleSpeed() {
      speed = (speed === 1) ? 2 : 1;
      renderAll();
    }

    function onRetreat() {
      if (!B.playerSide || B.over) return;
      if (!retreatArmed) {
        retreatArmed = true;
        renderFooter();
        if (retreatTimer) clearTimeout(retreatTimer);
        retreatTimer = setTimeout(function () {
          retreatArmed = false;
          renderFooter();
        }, 2600);
        return;
      }
      retreatArmed = false;
      if (retreatTimer) clearTimeout(retreatTimer);
      B.retreat(B.playerSide);
      showVerdict();
    }

    m.mask.addEventListener('click', function (e) {
      var a = e.target.closest('[data-a]');
      if (a && !a.disabled) {
        if (a.dataset.a === 'wait') doWait();
        else if (a.dataset.a === 'undo') {
          if (!canInteract()) return;
          var u = B.activeUnit();
          if (B.undoMove(u)) {
            mode = 'move';
            skillId = null;
            renderAll();
            UItoast('已撤销移动');
          }
        } else if (a.dataset.a === 'attack') {
          if (!canInteract()) return;
          if (!B.attackTargets(B.activeUnit()).length) { UItoast('攻击范围内没有敌军', 'bad'); return; }
          mode = 'attack';
          skillId = null;
          renderAll();
        }
        return;
      }

      var sk = e.target.closest('[data-skill]');
      if (sk && !sk.disabled) { chooseSkill(sk.dataset.skill); return; }

      var x = e.target.closest('[data-x]');
      if (!x) return;
      if (x.dataset.x === 'done') { finishBattle(); return; }
      if (x.dataset.x === 'auto') { toggleAuto(); return; }
      if (x.dataset.x === 'speed') { toggleSpeed(); return; }
      if (x.dataset.x === 'retreat') { onRetreat(); return; }
    });

    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (mode === 'skill' || mode === 'attack') cancelTargeting();
    });
    canvas.addEventListener('mousemove', function (e) {
      if (closed) return;
      hover = tileFromEvent(e);
      updateTip(hover, e.clientX, e.clientY);
    });
    canvas.addEventListener('mouseleave', function () {
      hover = null;
      var tip = m.q('#btTip');
      if (tip) tip.classList.remove('on');
    });
    document.addEventListener('keydown', onKey, true);

    /* ==========================================================
     * 启动
     * ========================================================== */
    function loop() {
      if (closed) return;
      /* 统一使用 performance.now()，避免 rAF 时间戳与特效记录时间不同源 */
      draw(nowMs());
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    renderAll();
    renderLog();
    timers.push(setTimeout(function () { if (!closed) banner('第 1 回合', 'round'); }, 280));
    beginTurn();
  }

  SG.BattleUI = { play: play };

})(window);
