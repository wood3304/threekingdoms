/* ==========================================================
 * 三国志 · 战场核心
 * 网格 / 寻路 / 战斗结算 / 技能 / 自动决策
 * 纯逻辑，不依赖 DOM，可在 Node 中测试
 * ========================================================== */
(function (global) {
  'use strict';
  var SG = global.SG;
  var A = SG.BattleAssets;
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function dist(a, c) { return Math.abs(a.x - c.x) + Math.abs(a.y - c.y); }
  function cheb(a, c) { return Math.max(Math.abs(a.x - c.x), Math.abs(a.y - c.y)); }
  function key(x, y) { return x + ',' + y; }
  function pushLog(bt, text, cls) {
    bt.log.push({ text: text, cls: cls || '', round: bt.round });
    if (bt.log.length > 200) bt.log.shift();
  }

  var Core = SG.BattleCore = {};

  /* ==========================================================
   * 创建战场
   * ========================================================== */
  Core.create = function (req, opts) {
    opts = opts || {};
    var G = SG.G;
    var playerFid = G ? G.player : null;
    var playerSide = (opts.playerSide != null) ? opts.playerSide :
      (req.atk.fid === playerFid ? 'atk' : (req.def.fid === playerFid ? 'def' : null));
    var city = (G && G.cities[req.def.cityId]) ||
      { id: req.def.cityId, name: req.def.cityName, def: req.def.defence || 50 };
    var map = A.buildMap(city);

    var atkF = (G && G.factions[req.atk.fid]) || { name: '攻方', color: '#b0463a' };
    var defF = (G && G.factions[req.def.fid]) || { name: '守方', color: '#3d7a9a' };

    var bt = {
      req: req,
      W: map.w, H: map.h, map: map,
      units: [],
      order: [], turnIndex: -1, activeId: null,
      round: 0, maxRound: A.MAX_ROUND,
      over: false, winner: null, reason: '',
      playerSide: playerSide,
      defence: (req.def.defence == null ? 50 : req.def.defence),
      atkFid: req.atk.fid, defFid: req.def.fid,
      factions: { atk: atkF, def: defF },
      cityNames: { atk: req.atk.cityName, def: req.def.cityName },
      log: [], initial: null
    };

    /* ---- 方法：查询 ---- */
    bt.getUnit = function (id) {
      for (var i = 0; i < bt.units.length; i++) if (bt.units[i].id === id) return bt.units[i];
      return null;
    };
    bt.unitAt = function (x, y) {
      for (var i = 0; i < bt.units.length; i++) {
        var u = bt.units[i];
        if (u.alive && u.x === x && u.y === y) return u;
      }
      return null;
    };
    bt.activeUnit = function () {
      if (!bt.activeId) return null;
      var u = bt.getUnit(bt.activeId);
      return (u && u.alive && !u.acted) ? u : null;
    };
    bt.canAct = function (u) {
      return !bt.over && !!u && u.alive && u.id === bt.activeId && !u.acted;
    };
    bt.total = function (side) {
      var n = 0;
      bt.units.forEach(function (u) { if (u.side === side) n += Math.max(0, u.troops); });
      return Math.round(n);
    };
    bt.initialTotal = function (side) {
      if (!bt.initial) return 0;
      return side === 'atk' ? bt.initial.atkTotal : bt.initial.defTotal;
    };
    bt.pushLog = function (text, cls) { pushLog(bt, text, cls); };

    /* ---- 布阵 ---- */
    buildSide(bt, req.atk.units || [], 'atk');
    buildSide(bt, req.def.units || [], 'def');

    bt.initial = {
      atkTotal: bt.total('atk'),
      defTotal: bt.total('def'),
      atkUnits: snapshotSide(bt, 'atk'),
      defUnits: snapshotSide(bt, 'def')
    };

    pushLog(bt, '两军对垒于「' + bt.cityNames.def + '」城下。', 'round');

    /* ---- 判定：一方无兵 ---- */
    var hasAtk = false, hasDef = false;
    bt.units.forEach(function (u) {
      if (u.side === 'atk') hasAtk = true;
      else hasDef = true;
    });
    if (!hasAtk && !hasDef) finish(bt, 'def', '两军皆无战意');
    else if (!hasAtk) finish(bt, 'def', '我军未及列阵便已溃散');
    else if (!hasDef) finish(bt, 'atk', '守军望风而逃');
    else startRound(bt, 1);

    /* ---- 方法：移动 / 攻击 / 技能 ---- */
    attachActions(bt);

    return bt;
  };

  /* ==========================================================
   * 部队生成
   * ========================================================== */
  function passableAt(bt, x, y) {
    var t = A.terrainAt(bt.map, x, y);
    return !!(t && t.pass);
  }

  function sideSpots(bt, side) {
    var gate = bt.map.gateY;
    /* 同一列至少隔一格，前后两列错开半格，避免武将拥挤重叠 */
    var frontOff = [0, 2, -2, 4, -4, 1, -1, 3, -3, 5, -5];
    var backOff = [1, -1, 3, -3, 5, -5, 0, 2, -2, 4, -4];
    var frontX = side === 'atk' ? 2 : 11;
    var backX = side === 'atk' ? 1 : 12;
    var front = [], back = [];
    frontOff.forEach(function (o) {
      var y = gate + o;
      if (y >= 0 && y < bt.H) front.push({ x: frontX, y: y });
    });
    backOff.forEach(function (o) {
      var y = gate + o;
      if (y >= 0 && y < bt.H) back.push({ x: backX, y: y });
    });
    return { front: front, back: back };
  }

  function buildSide(bt, srcs, side) {
    var spots = sideSpots(bt, side);
    var gate = bt.map.gateY;
    var used = {};

    function freeNear(y) {
      var best = null, bd = 999, x, yy;
      for (yy = 0; yy < bt.H; yy++) {
        for (x = 0; x < bt.W; x++) {
          if (side === 'atk' && x > 3) continue;
          if (side === 'def' && x < bt.W - 5) continue;
          if (!passableAt(bt, x, yy) || bt.unitAt(x, yy)) continue;
          var d = Math.abs(yy - y);
          if (d < bd) { bd = d; best = { x: x, y: yy }; }
        }
      }
      return best || { x: side === 'atk' ? 0 : bt.W - 1, y: y };
    }

    function take(pref) {
      var order = [pref, pref === 'front' ? 'back' : 'front'];
      for (var oi = 0; oi < order.length; oi++) {
        var arr = order[oi] === 'back' ? spots.back : spots.front;
        for (var i = 0; i < arr.length; i++) {
          var p = arr[i];
          var k = p.x + ',' + p.y;
          if (used[k]) continue;
          if (!passableAt(bt, p.x, p.y) || bt.unitAt(p.x, p.y)) continue;
          used[k] = 1;
          return p;
        }
      }
      return freeNear(gate);
    }

    srcs.forEach(function (s, idx) {
      if (!s || !(s.troops > 0)) return;
      var arch = A.archetypeOf(s);
      var spot = take(arch === 'strategist' ? 'back' : 'front');
      if (!spot || !passableAt(bt, spot.x, spot.y) || bt.unitAt(spot.x, spot.y)) {
        spot = freeNear(gate);
      }
      var maxT = Math.max(1, Math.round(s.troops));
      var u = {
        id: side + '_' + idx,
        gid: s.gid || null,
        srcIdx: idx,
        side: side,
        name: s.name || '守备兵',
        lead: s.lead || 50, war: s.war || 50, int: s.int || 50,
        archetype: arch,
        range: A.ARCHETYPES[arch].range,
        move: A.ARCHETYPES[arch].move,
        troops: maxT,
        maxTroops: maxT,
        morale: clamp(Math.round(s.morale == null ? 80 : s.morale), 0, 100),
        training: clamp(Math.round(s.training == null ? 60 : s.training), 0, 100),
        energy: 40,
        x: spot.x, y: spot.y, sx: spot.x, sy: spot.y,
        acted: false, moved: false,
        cd: {}, mods: [], burns: [],
        alive: true,
        skills: A.skillsFor(s, arch),
        color: bt.factions[side].color,
        kills: 0
      };
      bt.units.push(u);
    });
  }

  function snapshotSide(bt, side) {
    var out = [];
    bt.units.forEach(function (u) {
      if (u.side !== side) return;
      out.push({
        gid: u.gid, name: u.name,
        troops: u.troops, cap: u.maxTroops, morale: u.morale
      });
    });
    return out;
  }

  /* ==========================================================
   * 回合流转
   * ========================================================== */
  function speedOf(u) {
    return u.lead * 0.7 + u.war * 0.3 + (A.ARCHETYPES[u.archetype].speed || 0);
  }

  function buildOrder(bt) {
    bt.order = bt.units.filter(function (u) { return u.alive; })
      .sort(function (a, b) { return speedOf(b) - speedOf(a); })
      .map(function (u) { return u.id; });
  }

  function startRound(bt, n) {
    var events = [];

    if (n > bt.maxRound) {
      finish(bt, 'def', '久攻不下，粮尽退兵');
      return events;
    }

    if (n > 1) {
      /* 状态结算：灼烧 / 增益 / 冷却 / 气力 */
      bt.units.forEach(function (u) {
        if (!u.alive) return;

        if (u.burns && u.burns.length) {
          var keep = [];
          u.burns.forEach(function (br) {
            var dmg = Math.max(1, Math.round(u.maxTroops * br.ratio));
            var res = applyDamage(bt, u, dmg, { kind: 'burn' });
            events = events.concat(res.events);
            if (res.amount > 0) {
              events.push({ k: 'burn', unit: u, amount: res.amount });
              pushLog(bt, u.name + ' 军遭火焚，损兵 ' + res.amount + '（余 ' + Math.round(u.troops) + '）', 'burn');
            }
            br.turns -= 1;
            if (br.turns > 0 && u.alive) keep.push(br);
          });
          u.burns = keep;
        }

        if (u.mods && u.mods.length) {
          u.mods = u.mods.filter(function (m) {
            m.turns -= 1;
            return m.turns > 0;
          });
        }

        Object.keys(u.cd).forEach(function (sid) {
          if (u.cd[sid] > 0) u.cd[sid] -= 1;
        });

        u.energy = Math.min(100, u.energy + 8);
        u.morale = Math.min(100, u.morale + 0.5);
      });

      checkOver(bt);
      if (bt.over) return events;
    }

    bt.round = n;
    bt.units.forEach(function (u) {
      if (!u.alive) return;
      u.acted = false;
      u.moved = false;
      u.sx = u.x;
      u.sy = u.y;
    });
    buildOrder(bt);
    bt.turnIndex = 0;
    bt.activeId = bt.order.length ? bt.order[0] : null;

    pushLog(bt, '—— 第 ' + n + ' 回合 ——', 'round');
    events.push({ k: 'round', round: n });
    return events;
  }

  function finish(bt, winner, reason) {
    if (bt.over) return;
    bt.over = true;
    bt.winner = winner;
    bt.reason = reason;
    bt.activeId = null;
    pushLog(bt, '—— ' + reason + ' ——', 'end');
  }

  function checkOver(bt) {
    if (bt.over) return true;
    var atk = false, def = false;
    bt.units.forEach(function (u) {
      if (!u.alive) return;
      if (u.side === 'atk') atk = true; else def = true;
    });
    if (!atk) { finish(bt, 'def', '攻方全军覆没'); return true; }
    if (!def) { finish(bt, 'atk', '守军全灭，城池陷落'); return true; }
    return false;
  }

  /* ==========================================================
   * 行动方法
   * ========================================================== */
  function attachActions(bt) {
    /* ---- 寻路 ---- */
    bt.reachable = function (u) {
      var best = {}, prev = {};
      var startK = key(u.x, u.y);
      best[startK] = 0;
      var open = [{ x: u.x, y: u.y, cost: 0 }];

      while (open.length) {
        var bi = 0, i;
        for (i = 1; i < open.length; i++) if (open[i].cost < open[bi].cost) bi = i;
        var cur = open.splice(bi, 1)[0];
        if (cur.cost > (best[key(cur.x, cur.y)] || 0) + 1e-9) continue;

        for (i = 0; i < DIRS.length; i++) {
          var nx = cur.x + DIRS[i][0], ny = cur.y + DIRS[i][1];
          if (!A.inBounds(nx, ny, bt.W, bt.H)) continue;
          var ter = A.terrainAt(bt.map, nx, ny);
          if (!ter || !ter.pass) continue;
          var occ = bt.unitAt(nx, ny);
          if (occ && occ !== u) continue;
          var nc = cur.cost + ter.cost;
          if (nc > u.move) continue;
          var k = key(nx, ny);
          if (best[k] == null || nc < best[k]) {
            best[k] = nc;
            prev[k] = key(cur.x, cur.y);
            open.push({ x: nx, y: ny, cost: nc });
          }
        }
      }

      var tiles = Object.keys(best).map(function (k) {
        var p = k.split(',');
        return { x: +p[0], y: +p[1], cost: best[k] };
      });
      return { tiles: tiles, best: best, prev: prev };
    };

    bt.findPath = function (u, tx, ty) {
      var r = bt.reachable(u);
      var k = key(tx, ty);
      if (r.best[k] == null) return null;
      var path = [], cur = k, guard = 0;
      var startK = key(u.x, u.y);
      while (cur !== startK && guard++ < 400) {
        var p = cur.split(',');
        path.unshift({ x: +p[0], y: +p[1] });
        cur = r.prev[cur];
        if (!cur) break;
      }
      return path;
    };

    bt.moveUnit = function (u, path) {
      if (!bt.canAct(u) || u.moved) return [];
      if (!path || !path.length) return [];
      var cur = { x: u.x, y: u.y }, cost = 0, i;
      for (i = 0; i < path.length; i++) {
        var p = path[i];
        if (dist(cur, p) !== 1) return [];
        var ter = A.terrainAt(bt.map, p.x, p.y);
        if (!ter || !ter.pass) return [];
        var occ = bt.unitAt(p.x, p.y);
        if (occ && occ !== u) return [];
        cost += ter.cost;
        cur = p;
      }
      if (cost > u.move) return [];
      u.x = cur.x;
      u.y = cur.y;
      u.moved = true;
      return [{ k: 'move', unit: u, path: path }];
    };

    bt.undoMove = function (u) {
      if (!bt.canAct(u) || !u.moved) return false;
      if (bt.unitAt(u.sx, u.sy)) return false;
      u.x = u.sx;
      u.y = u.sy;
      u.moved = false;
      return true;
    };

    /* ---- 射程 ---- */
    bt.rangeOfAt = function (u, stand) {
      var r = u.range;
      var ter = A.terrainAt(bt.map, stand.x, stand.y);
      if (r > 1 && ter && ter.range) r += 1;
      return r;
    };
    bt.rangeOf = function (u) { return bt.rangeOfAt(u, { x: u.x, y: u.y }); };

    bt.attackTargets = function (u) {
      var r = bt.rangeOf(u);
      return bt.units.filter(function (t) {
        return t.alive && t.side !== u.side && dist(u, t) <= r;
      });
    };

    /* ---- 普通攻击 ---- */
    bt.attack = function (u, targetId) {
      if (!bt.canAct(u)) return [];
      var t = bt.getUnit(targetId);
      if (!t || !t.alive || t.side === u.side) return [];
      if (dist(u, t) > bt.rangeOf(u)) return [];

      var events = [];
      var flank = 0;
      bt.units.forEach(function (x) {
        if (x.alive && x.side === u.side && x.id !== u.id && dist(x, t) === 1) flank++;
      });
      var flankMul = 1 + 0.12 * Math.min(2, flank);

      var dmg = damageRaw(bt, u, t, flankMul, {});
      var res = applyDamage(bt, t, dmg, { kind: 'attack' });
      events.push({
        k: 'attack', unit: u, target: t,
        dmg: res.amount, kind: u.range > 1 ? 'ranged' : 'melee', flank: flank
      });
      events = events.concat(res.events);

      u.energy = Math.min(100, u.energy + 15);
      u.morale = Math.min(100, u.morale + 1.5);
      u.kills += res.killed ? 1 : 0;

      pushLog(bt, u.name + ' 攻 ' + t.name +
        (flank > 0 ? '（夹击 +' + (flank * 12) + '%）' : '') +
        '，歼敌 ' + res.amount, 'atk');

      /* 近身反击 */
      if (res.amount > 0 && t.alive && dist(u, t) === 1 && !bt.over) {
        var cdmg = damageRaw(bt, t, u, 0.35, {});
        var cres = applyDamage(bt, u, cdmg, { kind: 'counter' });
        events.push({ k: 'counter', unit: t, target: u, dmg: cres.amount });
        events = events.concat(cres.events);
        pushLog(bt, t.name + ' 反击 ' + u.name + '，歼敌 ' + cres.amount, 'counter');
      }

      checkOver(bt);
      return events;
    };

    /* ---- 技能 ---- */
    bt.skillReady = function (u, sid) {
      var sk = A.SKILLS[sid];
      if (!sk) return false;
      return (u.cd[sid] || 0) <= 0 && u.energy >= sk.cost;
    };

    bt.skillCenters = function (u, sid) {
      return skillCentersAt(bt, u, sid, { x: u.x, y: u.y });
    };

    bt.skillAffected = function (u, sid, center) {
      return affectedAt(bt, u, sid, center, { x: u.x, y: u.y });
    };

    bt.skillValid = function (u, sid, center) {
      if (!bt.canAct(u) || !center) return false;
      if (!bt.skillReady(u, sid)) return false;
      var sk = A.SKILLS[sid];
      if (!sk) return false;
      var stand = { x: u.x, y: u.y };
      if (sk.target === 'self' || sk.selfCenter) {
        if (center.x !== stand.x || center.y !== stand.y) return false;
      } else {
        var r = skillRangeAt(bt, u, sk, stand);
        if (dist(stand, center) > r) return false;
      }
      var aff = affectedAt(bt, u, sid, center, stand);
      if (sk.target === 'self' || sk.target === 'ally') return aff.allies.length > 0;
      return aff.enemies.length > 0;
    };

    bt.useSkill = function (u, sid, center) {
      if (!bt.canAct(u) || !bt.skillValid(u, sid, center)) return [];
      var sk = A.SKILLS[sid];
      var stand = { x: u.x, y: u.y };
      var aff = affectedAt(bt, u, sid, center, stand);
      var events = [{
        k: 'skill', unit: u, skillId: sid,
        center: { x: center.x, y: center.y },
        targets: aff.enemies.concat(aff.allies)
      }];

      u.energy = Math.max(0, u.energy - sk.cost);
      u.cd[sid] = sk.cd;

      if (sk.target === 'ally' || sk.target === 'self') {
        if (!aff.allies.length) return [];
        var healed = 0, buffed = 0;

        aff.allies.forEach(function (a) {
          if (sk.heal) {
            var heal = Math.min(
              Math.round(a.maxTroops * sk.heal),
              Math.max(0, a.maxTroops - a.troops)
            );
            if (heal > 0) {
              a.troops += heal;
              healed += heal;
              events.push({ k: 'heal', unit: a, amount: heal });
            }
          }
          if (sk.buff) {
            a.mods.push({
              name: sk.name, turns: sk.buff.turns || 2,
              atk: sk.buff.atk || 0, def: sk.buff.def || 0
            });
            buffed += 1;
            events.push({ k: 'mod', unit: a, text: sk.name, good: true });
          }
          if (sk.morale) a.morale = clamp(a.morale + sk.morale, 0, 100);
        });

        if (sk.heal) {
          pushLog(bt, u.name + ' 发动「' + sk.name + '」，恢复兵力 ' + healed, 'skill');
        } else {
          pushLog(bt, u.name + ' 发动「' + sk.name + '」，' + buffed + ' 支友军得到支援', 'skill');
        }
      } else {
        if (!aff.enemies.length) return [];
        var totalLoss = 0;

        aff.enemies.forEach(function (e) {
          if (sk.power) {
            var dmg = damageRaw(bt, u, e, sk.power * skillPowerMul(u), {});
            var res = applyDamage(bt, e, dmg, { kind: 'skill' });
            events = events.concat(res.events);
            totalLoss += res.amount;
          }
          if (sk.burn) {
            e.burns.push({ turns: sk.burn.turns, ratio: sk.burn.ratio });
            events.push({ k: 'mod', unit: e, text: '灼烧', good: false });
          }
          if (sk.push) pushUnit(bt, e, u, sk.push, events);
          if (sk.debuff) {
            e.mods.push({
              name: sk.name, turns: sk.debuff.turns || 2,
              atk: sk.debuff.atk || 0, def: sk.debuff.def || 0
            });
            events.push({ k: 'mod', unit: e, text: sk.name, good: false });
          }
          if (sk.morale) e.morale = clamp(e.morale + sk.morale, 0, 100);
        });

        pushLog(bt, u.name + ' 发动「' + sk.name + '」，' +
          aff.enemies.length + ' 支敌军受创，歼敌 ' + totalLoss, 'skill');
      }

      /* 单挑反噬 */
      if (sk.recoil) {
        var rd = Math.round(u.maxTroops * sk.recoil);
        var rres = applyDamage(bt, u, rd, { kind: 'recoil' });
        events = events.concat(rres.events);
        if (rres.amount > 0) pushLog(bt, u.name + ' 单挑负伤，折损 ' + rres.amount + ' 兵', 'counter');
      }

      checkOver(bt);
      return events;
    };

    /* ---- 结束当前单位行动 ---- */
    bt.finishUnit = function (u) {
      if (bt.over) return { events: [], over: true };
      if (u) u.acted = true;
      var evs = bt.advance();
      return { events: evs, over: bt.over };
    };

    bt.advance = function () {
      var events = [];
      var guard = 0;
      while (!bt.over && guard++ < 200) {
        bt.turnIndex++;
        if (bt.turnIndex >= bt.order.length) {
          events = events.concat(startRound(bt, bt.round + 1));
          break;
        }
        var u = bt.getUnit(bt.order[bt.turnIndex]);
        if (!u || !u.alive) continue;
        bt.activeId = u.id;
        u.sx = u.x;
        u.sy = u.y;
        break;
      }
      return events;
    };

    /* ---- 撤退 ---- */
    bt.retreat = function (side) {
      if (bt.over) return;
      if (side === 'atk') finish(bt, 'def', '我军撤退，攻城未果');
      else finish(bt, 'atk', '守军弃城而走');
    };

    /* ---- 预估伤害 ---- */
    bt.previewAttack = function (u, t) {
      if (!u || !t) return 0;
      return damageRaw(bt, u, t, 1, { noVariance: true });
    };
    bt.previewSkill = function (u, sid, t) {
      var sk = A.SKILLS[sid];
      if (!sk || !t) return 0;
      return damageRaw(bt, u, t, (sk.power || 0) * skillPowerMul(u), { noVariance: true });
    };

    /* ---- 自动行动 ---- */
    bt.aiTakeTurn = function (u) {
      if (!bt.canAct(u) || bt.over) return { events: [] };
      var enemies = bt.units.filter(function (x) { return x.alive && x.side !== u.side; });
      if (!enemies.length) return { events: [] };

      /* 若本回合已经移动过（例如中途改为自动），只能原地行动 */
      var reach = u.moved
        ? { tiles: [{ x: u.x, y: u.y, cost: 0 }] }
        : bt.reachable(u);
      var best = null;

      function consider(score, stand, action) {
        if (score <= 0) return;
        if (!best || score > best.score) {
          best = { score: score, stand: { x: stand.x, y: stand.y }, action: action };
        }
      }

      reach.tiles.forEach(function (tile) {
        var stand = { x: tile.x, y: tile.y };
        var pos = positionScore(bt, u, stand, enemies);

        /* 技能 */
        u.skills.forEach(function (sid) {
          if (!bt.skillReady(u, sid)) return;
          var centers = skillCentersAt(bt, u, sid, stand);
          centers.forEach(function (center) {
            var aff = affectedAt(bt, u, sid, center, stand);
            var score = skillScore(bt, u, sid, center, aff, stand);
            if (score > 0) consider(score + pos, stand, { type: 'skill', sid: sid, center: center });
          });
        });

        /* 普攻 */
        var r = bt.rangeOfAt(u, stand);
        enemies.forEach(function (e) {
          if (dist(stand, e) > r) return;
          var dmg = damageRaw(bt, u, e, 1, { noVariance: true });
          var score = dmg * (dmg >= e.troops ? 2.4 : 1);
          if (e.range > 1) score += 30;              /* 优先处理远程威胁 */
          if (e.skills && e.skills.length) score += 10;
          score += pos;
          if (dist(stand, e) === 1) {
            var counter = damageRaw(bt, e, u, 0.35, { noVariance: true });
            score -= counter * 0.55;
          }
          consider(score, stand, { type: 'attack', target: e });
        });
      });

      var events = [];

      if (!best) {
        /* 无法攻击：向敌军靠拢，优先占据有利地形 */
        var nearest = null, nd = 9999;
        enemies.forEach(function (e) {
          var d = dist(u, e);
          if (d < nd) { nd = d; nearest = e; }
        });
        var bestTile = null, bestVal = -Infinity;
        reach.tiles.forEach(function (tile) {
          if (tile.x === u.x && tile.y === u.y) return;
          var ter = A.terrainAt(bt.map, tile.x, tile.y);
          var d = nearest ? dist(tile, nearest) : 0;
          var ideal = u.range > 1 ? Math.min(u.range, 4) : 1;
          var val = -Math.abs(d - ideal) * 10 + (ter ? ter.def : 0) * 55;
          if (val > bestVal) { bestVal = val; bestTile = tile; }
        });
        if (bestTile) {
          var p = bt.findPath(u, bestTile.x, bestTile.y);
          if (p && p.length) events = events.concat(bt.moveUnit(u, p));
        }
        return { events: events };
      }

      /* 先移动，再行动 */
      if (best.stand.x !== u.x || best.stand.y !== u.y) {
        var path = bt.findPath(u, best.stand.x, best.stand.y);
        if (path && path.length) events = events.concat(bt.moveUnit(u, path));
      }

      if (best.action) {
        if (best.action.type === 'attack') {
          events = events.concat(bt.attack(u, best.action.target.id));
        } else {
          events = events.concat(bt.useSkill(u, best.action.sid, best.action.center));
        }
      }
      return { events: events };
    };

    /* ---- 战斗报告 ---- */
    bt.buildReport = function () {
      bt.units.forEach(function (u) {
        var arr = u.side === 'atk' ? bt.req.atk.units : bt.req.def.units;
        var src = arr && arr[u.srcIdx];
        if (src) src.troops = u.alive ? Math.max(0, Math.round(u.troops)) : 0;
      });
      return {
        winner: bt.winner,
        reason: bt.reason,
        atkLeft: bt.total('atk'),
        defLeft: bt.total('def'),
        initial: bt.initial,
        rounds: [],
        tactical: true,
        roundCount: bt.round,
        units: bt.units.map(function (u) {
          return {
            gid: u.gid, name: u.name, side: u.side,
            troops: Math.round(u.troops), alive: u.alive
          };
        })
      };
    };
  }

  /* ==========================================================
   * 伤害 / 状态
   * ========================================================== */
  function modVal(u, stat) {
    var v = 0;
    (u.mods || []).forEach(function (m) { v += (m[stat] || 0); });
    return v;
  }

  function damageRaw(bt, a, t, mult, opts) {
    opts = opts || {};
    /* 部队规模决定基础杀伤，但不过度依赖当前兵力，
       以免兵多的一方滚雪球式碾压，让走位与技能仍有发挥空间 */
    var base = (150 + a.maxTroops * 0.012 + a.troops * 0.004) * (0.82 + a.war / 95);
    base *= 0.85 + a.training / 400;
    base *= 0.8 + a.morale / 250;
    base *= 0.9 + a.energy / 500;
    base *= A.ARCHETYPES[a.archetype].atk;
    base *= 1 + modVal(a, 'atk');
    base *= mult;

    var ter = A.terrainAt(bt.map, t.x, t.y);
    var red = ter ? ter.def : 0;
    /* 城防提供基础守备优势，但不再是对所有守军的全额城墙减伤 */
    if (t.side === 'def') red += (bt.defence / 100) * 0.12;
    red += modVal(t, 'def');
    red = clamp(red, 0, 0.65);
    base *= (1 - red);

    if (!opts.noVariance) base *= 0.9 + Math.random() * 0.2;
    return Math.max(20, Math.round(base));
  }

  function skillPowerMul(u) {
    return u.archetype === 'strategist' ? 1.12 : 1;
  }

  function applyDamage(bt, t, amount, opts) {
    opts = opts || {};
    if (!t || !t.alive || !(amount > 0)) return { amount: 0, killed: false, events: [] };
    var actual = Math.min(Math.round(amount), Math.round(t.troops));
    if (actual <= 0) return { amount: 0, killed: false, events: [] };

    t.troops = Math.max(0, t.troops - actual);
    t.energy = Math.min(100, t.energy + 8);
    t.morale = clamp(t.morale - Math.max(0.4, Math.min(5, actual / Math.max(1, t.maxTroops) * 35)), 0, 100);

    var events = [{ k: 'damage', unit: t, amount: actual, kind: opts.kind || 'hit' }];
    var killed = false;
    if (t.troops <= 0) {
      t.troops = 0;
      t.alive = false;
      killed = true;
      events.push({ k: 'die', unit: t });
      pushLog(bt, '▶ ' + t.name + ' 所部溃灭！', 'kill');
    }
    return { amount: actual, killed: killed, events: events };
  }

  function pushUnit(bt, target, source, n, events) {
    var dx = target.x - source.x, dy = target.y - source.y;
    var sx = 0, sy = 0;
    if (Math.abs(dx) >= Math.abs(dy)) sx = dx > 0 ? 1 : -1;
    else sy = dy > 0 ? 1 : -1;
    if (!sx && !sy) return;

    var path = [], x = target.x, y = target.y, i;
    for (i = 0; i < n; i++) {
      var nx = x + sx, ny = y + sy;
      if (!A.inBounds(nx, ny, bt.W, bt.H)) break;
      var ter = A.terrainAt(bt.map, nx, ny);
      if (!ter || !ter.pass) break;
      if (bt.unitAt(nx, ny)) break;
      path.push({ x: nx, y: ny });
      x = nx; y = ny;
    }
    if (!path.length) return;
    target.x = x;
    target.y = y;
    events.push({ k: 'move', unit: target, path: path, forced: true });
    pushLog(bt, target.name + ' 被击退 ' + path.length + ' 格', 'atk');
  }

  /* ==========================================================
   * 技能作用范围
   * ========================================================== */
  function skillRangeAt(bt, u, sk, stand) {
    var r = sk.range || 0;
    if (r >= 2) {
      var ter = A.terrainAt(bt.map, stand.x, stand.y);
      if (ter && ter.range) r += 1;
    }
    return r;
  }

  function skillCentersAt(bt, u, sid, stand) {
    var sk = A.SKILLS[sid];
    var out = [], x, y;
    if (!sk) return out;
    if (sk.target === 'self' || sk.selfCenter) {
      return [{ x: stand.x, y: stand.y }];
    }
    var r = skillRangeAt(bt, u, sk, stand);
    for (y = 0; y < bt.H; y++) {
      for (x = 0; x < bt.W; x++) {
        if (dist(stand, { x: x, y: y }) > r) continue;
        if (sk.target === 'enemy') {
          var e = bt.unitAt(x, y);
          if (e && e.alive && e.side !== u.side) out.push({ x: x, y: y });
        } else if (sk.target === 'ally') {
          var a = bt.unitAt(x, y);
          if (a && a.alive && a.side === u.side) out.push({ x: x, y: y });
        } else {
          out.push({ x: x, y: y });
        }
      }
    }
    return out;
  }

  function affectedAt(bt, u, sid, center, stand) {
    var sk = A.SKILLS[sid];
    var enemies = [], allies = [];
    if (!sk || !center) return { enemies: enemies, allies: allies };

    var cx = center.x, cy = center.y;
    if (sk.selfCenter) { cx = stand.x; cy = stand.y; }

    bt.units.forEach(function (t) {
      if (!t.alive) return;
      if (sk.target === 'self') {
        if (t === u) allies.push(t);
        return;
      }
      if (cheb({ x: cx, y: cy }, t) > (sk.radius || 0)) return;
      if (sk.target === 'ally') {
        if (t.side === u.side) allies.push(t);
      } else {
        if (t.side !== u.side) enemies.push(t);
      }
    });
    return { enemies: enemies, allies: allies };
  }

  /* ==========================================================
   * 自动决策评分
   * ========================================================== */
  function positionScore(bt, u, stand, enemies) {
    var ter = A.terrainAt(bt.map, stand.x, stand.y);
    var s = (ter ? ter.def : 0) * 150;
    if (!enemies.length) return s;

    var nearest = 999, adj = 0;
    enemies.forEach(function (e) {
      var d = dist(stand, e);
      if (d < nearest) nearest = d;
      if (d <= 1) adj++;
    });

    var r = bt.rangeOfAt(u, stand);
    if (r > 1) {
      s += -Math.abs(nearest - Math.min(r, 4)) * 6 - adj * 24;
    } else {
      s += -nearest * 5;
    }
    return s;
  }

  function skillScore(bt, u, sid, center, aff, stand) {
    var sk = A.SKILLS[sid], score = 0;
    if (!sk) return -1;

    if (sk.target === 'ally' || sk.target === 'self') {
      if (!aff.allies.length) return -1;
      aff.allies.forEach(function (a) {
        if (sk.heal) {
          score += Math.min(
            Math.round(a.maxTroops * sk.heal),
            Math.max(0, a.maxTroops - a.troops)
          ) * 0.9;
        }
        if (sk.buff) {
          score += 70;
          if (sk.buff.atk) score += 45;
          if (sk.buff.def) score += 35;
          if (sk.buff.turns) score += 5;
        }
        if (sk.morale && a.morale < 92) score += 25;
      });
      return score;
    }

    if (!aff.enemies.length) return -1;
    aff.enemies.forEach(function (e) {
      if (sk.power) {
        var dmg = damageRaw(bt, u, e, sk.power * skillPowerMul(u), { noVariance: true });
        score += dmg * (dmg >= e.troops ? 2.2 : 1);
        if (sk.burn) score += e.maxTroops * sk.burn.ratio * sk.burn.turns * 0.5;
      }
      if (sk.debuff) score += 70;
      if (sk.morale) score += 15;
    });
    if (aff.enemies.length > 1) score += 30;
    return score;
  }

})(window);
