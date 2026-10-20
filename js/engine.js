/* ==========================================================
 * 三国志 · 核心引擎
 * 回合流程 / 内政指令 / 收支结算 / AI
 * ========================================================== */
(function (global) {
  'use strict';
  var SG = global.SG;

  /* ---------- 工具 ---------- */
  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  SG.rnd = rnd;
  SG.clamp = clamp;

  /* ---------- 全局状态 ---------- */
  SG.G = null;

  SG.log = function (text, cls) {
    var G = SG.G;
    if (!G) return;
    G.log.unshift({ t: G.year + '年' + G.month + '月', text: text, cls: cls || '' });
    if (G.log.length > 300) G.log.length = 300;
  };

  /* ---------- 访问器 ---------- */
  SG.city = function (id) { return SG.G.cities[id]; };
  SG.faction = function (id) { return SG.G.factions[id]; };
  SG.general = function (id) { return SG.G.generals[id]; };
  SG.adj = function (id) { return SG.G.adj[id] || []; };
  SG.pcity = function () { return SG.G.cities; };

  /* 城池太守：城内政治最高者 */
  SG.governor = function (city) {
    var best = null, bv = -1;
    city.generals.forEach(function (gid) {
      var g = SG.G.generals[gid];
      if (!g) return;
      var v = g.pol * 2 + g.chr + g.lead;
      if (v > bv) { bv = v; best = g; }
    });
    return best;
  };

  SG.cityGenerals = function (city) {
    return city.generals.map(function (id) { return SG.G.generals[id]; }).filter(Boolean);
  };

  SG.factionCities = function (fid) {
    return SG.G.cityOrder.map(function (id) { return SG.G.cities[id]; })
      .filter(function (c) { return c.owner === fid; });
  };

  SG.factionTroops = function (fid) {
    var n = 0;
    SG.factionCities(fid).forEach(function (c) { n += c.troops; });
    return n;
  };

  SG.sortedGenerals = function (fid, by) {
    var list = SG.G.generalOrder.map(function (id) { return SG.G.generals[id]; })
      .filter(function (g) { return g && g.faction === fid; });
    by = by || 'lead';
    list.sort(function (a, b) {
      return (b[by] * 10 + b.war) - (a[by] * 10 + a.war);
    });
    return list;
  };

  SG.unitCap = function (g) { return 1000 + g.lead * 80; };

  /* ---------- 新游戏 ---------- */
  SG.newGame = function (playerFactionId, wildSeed) {
    var G = {
      v: 1,
      year: 194, month: 1, turn: 1,
      player: playerFactionId,
      cities: {}, cityOrder: [], adj: {},
      factions: {}, generals: {}, generalOrder: [],
      log: [], sel: null, over: false, result: '',
      _seq: 0
    };
    SG.G = G;

    SG.CITY_DEFS.forEach(function (d) {
      var c = {
        id: d[0], name: d[0], x: d[1], y: d[2],
        agri: d[3], comm: d[4], order: d[5], def: d[6],
        troops: d[7], morale: 80, training: 60,
        owner: null, generals: [], ap: 1
      };
      G.cities[c.id] = c;
      G.cityOrder.push(c.id);
      G.adj[c.id] = [];
    });

    SG.CITY_EDGES.forEach(function (e) {
      if (G.adj[e[0]] && G.adj[e[1]]) { G.adj[e[0]].push(e[1]); G.adj[e[1]].push(e[0]); }
    });

    SG.FACTION_DEFS.forEach(function (f) {
      G.factions[f.id] = {
        id: f.id, name: f.name, color: f.color, ruler: f.ruler,
        capital: f.capital, gold: f.gold, food: f.food,
        alive: true, isPlayer: f.id === playerFactionId
      };
      f.cities.forEach(function (cn) {
        if (G.cities[cn]) G.cities[cn].owner = f.id;
      });
    });

    /* 武将 */
    SG.FACTION_DEFS.forEach(function (f) {
      var cities = f.cities.slice();
      var rulerChr = f.generals[0][5];
      f.generals.forEach(function (row, i) {
        var cityName = (i === 0) ? f.capital : cities[i % cities.length];
        var g = {
          id: 'g' + (++G._seq), name: row[0],
          lead: row[1], war: row[2], int: row[3], pol: row[4], chr: row[5],
          loyalty: i === 0 ? 100 : clamp(58 + Math.round(rulerChr / 5) + rnd(0, 14), 40, 100),
          city: cityName, faction: f.id
        };
        G.generals[g.id] = g;
        G.generalOrder.push(g.id);
        if (G.cities[cityName]) G.cities[cityName].generals.push(g.id);
      });
    });

    /* 在野武将随机分布 */
    if (wildSeed === undefined) wildSeed = Math.random();
    var pool = G.cityOrder.slice();
    SG.WILD_GENERALS.forEach(function (row, i) {
      var idx = Math.floor((wildSeed * 997 + i * 137) % pool.length);
      var cityName = pool[idx];
      var g = {
        id: 'g' + (++G._seq), name: row[0],
        lead: row[1], war: row[2], int: row[3], pol: row[4], chr: row[5],
        loyalty: 50, city: cityName, faction: null
      };
      G.generals[g.id] = g;
      G.generalOrder.push(g.id);
      G.cities[cityName].generals.push(g.id);
    });

    SG.refreshCityAP();
    SG.log('群雄并起，天下大乱。' + SG.faction(playerFactionId).name + '势力就此起兵！', 'imp');
    return G;
  };

  /* ---------- 行动力 ---------- */
  SG.refreshCityAP = function () {
    var G = SG.G;
    G.cityOrder.forEach(function (cid) {
      var c = G.cities[cid];
      var gov = SG.governor(c);
      c.ap = 1 + (gov && gov.pol >= 80 ? 1 : 0);
    });
  };

  SG.cityAP = function (city) {
    return city.ap;
  };

  /* ---------- 资源 ---------- */
  function spendGold(f, n) {
    if (f.gold < n) return false;
    f.gold -= n;
    return true;
  }
  SG.spendGold = spendGold;

  function spendFood(f, n) {
    if (f.food < n) return false;
    f.food -= n;
    return true;
  }
  SG.spendFood = spendFood;

  /* ---------- 内政指令 ---------- */
  SG.ACTION_COST = { develop: 300, farm: 300, patrol: 0, fortify: 400, train: 300, draft: 0, levy: 0, recruit: 200 };

  /* 执行内政 / 人事指令 */
  SG.doAction = function (cityId, key, opt) {
    var G = SG.G;
    var c = G.cities[cityId];
    if (!c) return { ok: false, msg: '城池不存在' };
    var f = G.factions[c.owner];
    if (!f) return { ok: false, msg: '无主城池' };
    if (c.ap <= 0) return { ok: false, msg: '本月该城行动力已用尽' };

    var gov = SG.governor(c);
    var pol = gov ? gov.pol : 40, chr = gov ? gov.chr : 40, lead = gov ? gov.lead : 40;
    var cost = SG.ACTION_COST[key] || 0;
    var res;

    switch (key) {
      case 'develop': {
        if (!spendGold(f, cost)) return { ok: false, msg: '金钱不足（需 ' + cost + '）' };
        var dc = clamp(2 + Math.floor(pol / 18) + rnd(0, 3), 1, 12);
        c.comm = clamp(c.comm + dc, 0, 100);
        res = '开发「' + c.name + '」商业 +' + dc + '（现 ' + c.comm + '）';
        break;
      }
      case 'farm': {
        if (!spendGold(f, cost)) return { ok: false, msg: '金钱不足（需 ' + cost + '）' };
        var da = clamp(2 + Math.floor(pol / 18) + rnd(0, 3), 1, 12);
        c.agri = clamp(c.agri + da, 0, 100);
        res = '治水「' + c.name + '」农业 +' + da + '（现 ' + c.agri + '）';
        break;
      }
      case 'patrol': {
        var doo = clamp(3 + Math.floor(chr / 22) + rnd(0, 3), 1, 14);
        c.order = clamp(c.order + doo, 0, 100);
        c.morale = clamp(c.morale + 2, 0, 100);
        res = '巡查「' + c.name + '」治安 +' + doo + '（现 ' + c.order + '）';
        break;
      }
      case 'fortify': {
        if (!spendGold(f, cost)) return { ok: false, msg: '金钱不足（需 ' + cost + '）' };
        var dd = clamp(3 + Math.floor(lead / 20) + rnd(0, 3), 1, 12);
        c.def = clamp(c.def + dd, 0, 100);
        res = '修筑「' + c.name + '」城防 +' + dd + '（现 ' + c.def + '）';
        break;
      }
      case 'train': {
        if (!spendGold(f, cost)) return { ok: false, msg: '金钱不足（需 ' + cost + '）' };
        var dt = clamp(4 + Math.floor(lead / 22) + rnd(0, 3), 1, 15);
        c.training = clamp(c.training + dt, 0, 100);
        res = '训练「' + c.name + '」部队 训练度 +' + dt + '（现 ' + c.training + '）';
        break;
      }
      case 'draft': {
        var want = Math.max(1000, Math.floor((opt && opt.amount) || 3000));
        var maxByGold = Math.floor(f.gold / 250) * 1000;
        var maxByFood = Math.floor(f.food);            /* 每兵消耗 1 粮 */
        var cap = Math.floor((c.order < 40 ? 3000 : 20000) * (0.5 + c.order / 200));
        var amount = Math.min(want, maxByGold, maxByFood, Math.max(0, cap));
        amount = Math.floor(amount / 1000) * 1000;
        if (amount <= 0) return { ok: false, msg: '资源不足或民心过低，无法征兵' };
        f.gold -= Math.round(amount / 1000 * 250);
        f.food -= amount;
        c.troops += amount;
        c.order = clamp(c.order - Math.round(amount / 4000), 0, 100);
        res = '在「' + c.name + '」征兵 ' + amount + '（现 ' + c.troops + '）';
        break;
      }
      case 'levy': {
        var mod = 0.5 + c.order / 200;
        var g = Math.round(c.comm * 6 * mod);
        f.gold += g;
        c.order = clamp(c.order - 6, 0, 100);
        c.morale = clamp(c.morale - 4, 0, 100);
        res = '「' + c.name + '」征收 → 金 +' + g + '，治安 -6';
        break;
      }
      case 'recruit': {
        if (!spendGold(f, cost)) return { ok: false, msg: '金钱不足（需 ' + cost + '）' };
        var wild = c.generals.map(function (id) { return G.generals[id]; })
          .filter(function (gg) { return gg && gg.faction === null; });
        if (!wild.length) return { ok: false, msg: '城中没有在野之士' };
        var target = wild[0], best = -1;
        wild.forEach(function (gg) { if (gg.lead + gg.int > best) { best = gg.lead + gg.int; target = gg; } });
        var p = clamp(0.25 + chr / 220, 0.1, 0.9);
        if (Math.random() < p) {
          target.faction = f.id;
          target.loyalty = clamp(50 + Math.round(chr / 6), 40, 100);
          res = '登用成功！' + target.name + ' 归顺 ' + f.name;
        } else {
          res = '登用 ' + target.name + ' 失败……';
        }
        break;
      }
      default:
        return { ok: false, msg: '未知指令' };
    }

    c.ap -= 1;
    SG.log(res, f.isPlayer ? '' : 'ai');
    return { ok: true, msg: res, city: c, faction: f };
  };

  /* ---------- 调任武将 ---------- */
  SG.moveGeneral = function (gid, toCityId) {
    var G = SG.G;
    var g = G.generals[gid];
    var to = G.cities[toCityId];
    if (!g || !to) return { ok: false, msg: '参数错误' };
    if (g.faction !== to.owner) return { ok: false, msg: '目标城池不属于本方' };
    if (g.city === toCityId) return { ok: false, msg: '该武将已在此城' };
    if (SG.adj(g.city).indexOf(toCityId) < 0) return { ok: false, msg: '只能调任到相邻城池' };
    var from = G.cities[g.city];
    var i = from.generals.indexOf(gid);
    if (i >= 0) from.generals.splice(i, 1);
    to.generals.push(gid);
    g.city = toCityId;
    SG.log(g.name + ' 由「' + from.name + '」调往「' + to.name + '」', G.factions[g.faction].isPlayer ? '' : 'ai');
    return { ok: true, msg: '已调任' };
  };

  /* ---------- 出击准备 ---------- */
  SG.attackTargets = function (cityId) {
    var G = SG.G, c = G.cities[cityId];
    if (!c || !c.owner) return [];
    return SG.adj(cityId).filter(function (id) {
      var t = G.cities[id];
      return t.owner !== c.owner;
    }).map(function (id) { return G.cities[id]; });
  };

  SG.canAttack = function (city) {
    if (!city || !city.owner) return false;
    if (city.ap <= 0) return false;
    if (city.troops < 1000) return false;
    return SG.attackTargets(city.id).length > 0;
  };

  SG.prepareAttack = function (fromId, toId, generalIds, troops) {
    var G = SG.G;
    var from = G.cities[fromId], to = G.cities[toId];
    if (!from || !to) return { ok: false, msg: '城池不存在' };
    if (SG.adj(fromId).indexOf(toId) < 0) return { ok: false, msg: '两城不相邻' };
    if (from.owner === to.owner) return { ok: false, msg: '不能攻击本方城池' };
    if (from.ap <= 0) return { ok: false, msg: '本月该城行动力已用尽' };
    if (!generalIds || !generalIds.length) return { ok: false, msg: '请选择出阵武将' };

    var caps = 0;
    var units = [];
    generalIds.forEach(function (gid) {
      var g = G.generals[gid];
      if (!g || g.city !== fromId || g.faction !== from.owner) return;
      caps += SG.unitCap(g);
    });
    var send = Math.min(Math.floor(troops || 0), from.troops, caps);
    if (send < 1000) return { ok: false, msg: '出征兵力不足（至少 1000）' };

    /* 按带兵上限比例分配 */
    var left = send;
    var valid = generalIds.map(function (gid) { return G.generals[gid]; })
      .filter(function (g) { return g && g.city === fromId && g.faction === from.owner; });
    valid.forEach(function (g, i) {
      var cap = SG.unitCap(g);
      var t = (i === valid.length - 1) ? left : Math.min(cap, Math.round(send * cap / caps));
      t = Math.min(t, left);
      left -= t;
      units.push({
        gid: g.id, name: g.name, lead: g.lead, war: g.war, int: g.int,
        troops: t, morale: from.morale, training: from.training
      });
    });
    units = units.filter(function (u) { return u.troops > 0; });

    var defUnits = SG.cityGenerals(to).filter(function (g) { return g.faction === to.owner; })
      .slice(0, 5).map(function (g) {
        return {
          gid: g.id, name: g.name, lead: g.lead, war: g.war, int: g.int,
          troops: 0, morale: to.morale, training: to.training
        };
      });

    /* 孤城也要分营列阵：守军至少分成 3 支（与攻方相当，最多 5 支），
       避免 1-2 名守将把数万守军堆成一支难以击破的孤军 */
    var wantDef = Math.min(5, Math.max(3, units.length));
    var guardNames = ['守备兵', '城防兵', '郡国兵'];
    var guardIdx = 0;
    while (defUnits.length < wantDef) {
      defUnits.push({
        gid: null, name: guardNames[guardIdx++ % guardNames.length],
        lead: 52, war: 52, int: 40,
        troops: 0, morale: to.morale, training: to.training
      });
    }

    /* 守军按带兵上限分摊守城兵力 */
    var totalCap = 0;
    defUnits.forEach(function (u) { totalCap += SG.unitCap(u); });
    if (defUnits.length) {
      var l2 = to.troops;
      defUnits.forEach(function (u, i) {
        var t = (i === defUnits.length - 1) ? l2 : Math.round(to.troops * SG.unitCap(u) / totalCap);
        t = Math.min(t, l2);
        l2 -= t;
        u.troops = t;
      });
    }

    return {
      ok: true,
      atk: { fid: from.owner, cityId: fromId, cityName: from.name, units: units, kind: 'atk' },
      def: { fid: to.owner, cityId: toId, cityName: to.name, units: defUnits, kind: 'def', defence: to.def }
    };
  };

  /* ---------- 战斗结果落地 ---------- */
  SG.applyBattleResult = function (req, report) {
    var G = SG.G;
    var from = G.cities[req.atk.cityId];
    var to = G.cities[req.def.cityId];
    var af = G.factions[req.atk.fid];
    var df = G.factions[req.def.fid];

    /* 出征兵力以战前快照为准（req 中的部队已被结算为战后兵力） */
    var sent = (report && report.initial && report.initial.atkTotal != null)
      ? report.initial.atkTotal
      : req.atk.units.reduce(function (n, u) { return n + (u.troops || 0); }, 0);
    var survivors = (report && report.atkLeft != null)
      ? report.atkLeft
      : sent;
    sent = Math.max(0, Math.round(sent));
    survivors = Math.max(0, Math.round(survivors));

    from.troops = Math.max(0, from.troops - sent);
    from.ap -= 1;
    from.morale = clamp(from.morale - 5, 0, 100);

    var text = '';
    if (report.winner === 'atk') {
      to.troops = survivors;
      to.owner = af.id;
      to.def = Math.round(to.def * 0.6);
      to.order = clamp(to.order - 25, 0, 100);
      to.morale = clamp(to.morale - 10, 0, 100);
      to.training = clamp(to.training - 10, 0, 100);
      to.ap = 0;

      /* 守将处理 */
      var stayGens = to.generals.slice();
      var moved = [];
      stayGens.forEach(function (gid) {
        var g = G.generals[gid];
        if (!g || g.faction === af.id || g.faction === null) return;
        var roll = Math.random();
        if (roll < 0.35) {
          g.faction = af.id;
          g.loyalty = clamp(40 + rnd(0, 20), 30, 80);
          moved.push(g.name + '归顺');
        } else if (roll < 0.7) {
          var esc = SG.adj(to.id).filter(function (id) { return G.cities[id].owner === df.id; });
          if (esc.length) {
            var dest = G.cities[esc[rnd(0, esc.length - 1)]];
            var i = to.generals.indexOf(gid);
            if (i >= 0) to.generals.splice(i, 1);
            dest.generals.push(gid);
            g.city = dest.id;
            moved.push(g.name + '退走' + dest.name);
          } else {
            g.faction = af.id;
            g.loyalty = 35;
            moved.push(g.name + '被俘归顺');
          }
        } else {
          /* 下野 */
          var j = to.generals.indexOf(gid);
          if (j >= 0) to.generals.splice(j, 1);
          g.faction = null; g.city = to.id; g.loyalty = 50;
          moved.push(g.name + '下野');
        }
      });

      text = '【' + af.name + '】攻陷「' + to.name + '」！（' + (moved.length ? moved.join('、') : '守将尽没') + '）';
      SG.log(text, 'imp');

      /* 出征武将入城 */
      req.atk.units.forEach(function (u) {
        var g = G.generals[u.gid];
        if (!g) return;
        var k = from.generals.indexOf(g.id);
        if (k >= 0) from.generals.splice(k, 1);
        to.generals.push(g.id);
        g.city = to.id;
        g.loyalty = clamp(g.loyalty + 3, 0, 100);
      });
      if (df && !SG.factionCities(df.id).length) {
        df.alive = false;
        SG.log('【' + df.name + '】势力灭亡！', 'imp');
      }
    } else {
      /* 攻方失败 */
      to.troops = Math.max(0, Math.round(report.defLeft == null ? 0 : report.defLeft));
      to.morale = clamp(to.morale - 8, 0, 100);
      /* 幸存攻军退回本城 */
      from.troops += survivors;
      text = '【' + af.name + '】进攻「' + to.name + '」失利，' + (report.reason || '大败而归') + '。';
      SG.log(text, 'bad');
    }
    return { text: text };
  };

  /* ---------- 结算 ---------- */
  function settleFaction(f) {
    var G = SG.G;
    var gold = 0, food = 0, upkeep = 0;
    SG.factionCities(f.id).forEach(function (c) {
      var mod = 0.5 + c.order / 200;
      gold += Math.round(c.comm * 3 * mod);
      food += Math.round(c.agri * 4 * mod);
      upkeep += Math.round(c.troops / 60);
      c.order = clamp(c.order + 1, 0, 100);
      c.def = clamp(c.def + 1, 0, 100);
      c.morale = clamp(c.morale + 2, 0, 100);
    });
    f.gold += gold;
    f.food += food - upkeep;
    var starve = false;
    if (f.food < 0) {
      f.food = 0;
      starve = true;
      SG.factionCities(f.id).forEach(function (c) {
        c.troops = Math.round(c.troops * 0.88);
        c.morale = clamp(c.morale - 15, 0, 100);
        c.order = clamp(c.order - 3, 0, 100);
      });
    }
    return { gold: gold, food: food, upkeep: upkeep, starve: starve };
  }

  /* ---------- AI ---------- */
  /* 单座城池的 AI 行动；若目标是玩家城池，则返回战斗请求交由玩家守城 */
  function aiCityTurn(f, c) {
    var G = SG.G;
    if (!c || c.owner !== f.id || c.ap <= 0) return null;

    /* 1) 判断是否出击 */
    var targets = SG.attackTargets(c.id).filter(function (t) {
      return c.troops > t.troops * 1.6 && c.troops > 9000;
    });
    if (targets.length && c.troops >= 12000 && Math.random() < 0.75) {
      targets.sort(function (a, b) { return a.troops - b.troops; });
      var t = targets[0];
      var gens = SG.sortedGenerals(f.id, 'lead').filter(function (g) { return g.city === c.id; }).slice(0, 3);
      if (gens.length) {
        var send = Math.floor(c.troops * (t.troops < c.troops * 0.6 ? 0.7 : 0.9));
        var req = SG.prepareAttack(c.id, t.id, gens.map(function (g) { return g.id; }), send);
        if (req.ok) {
          if (req.def.fid === G.player) return req;
          var rep = SG.resolveBattle(req);
          SG.applyBattleResult(req, rep);
          return null;
        }
      }
    }

    /* 2) 内政 */
    while (c.ap > 0) {
      var act = null;
      if (c.troops < 6000 && f.gold > 900 && f.food > 6000) act = 'draft';
      else if (c.order < 45) act = 'patrol';
      else if (c.agri < 55 && f.gold > 800) act = 'farm';
      else if (c.comm < 55 && f.gold > 800) act = 'develop';
      else if (c.def < 50 && f.gold > 900) act = 'fortify';
      else if (c.training < 70 && f.gold > 900) act = 'train';
      else if (f.gold > 3000 && Math.random() < 0.3) act = 'levy';
      else {
        var pool = ['develop', 'farm', 'patrol', 'fortify', 'train'];
        act = pool[rnd(0, pool.length - 1)];
      }
      var r = SG.doAction(c.id, act, { amount: 3000 });
      if (!r.ok) break;
    }

    /* 3) 登用在野 */
    var wild = c.generals.map(function (id) { return G.generals[id]; })
      .filter(function (g) { return g && g.faction === null; });
    if (wild.length && f.gold > 1200 && Math.random() < 0.6) {
      SG.doAction(c.id, 'recruit');
    }
    return null;
  }

  /* ---------- 回合推进 ----------
   * hooks.onDefense(req, resume) : 玩家守城时暂停，演出结束后调用 resume()
   * hooks.done(result)           : 本月全部结算完毕
   */
  SG.endTurn = function (hooks) {
    hooks = hooks || {};
    var G = SG.G;
    if (G.over) {
      if (hooks.done) hooks.done({ ok: false, over: true });
      return { ok: false, over: true };
    }

    var summary = [];
    var finished = false;

    /* AI 逐城行动队列，遇到玩家守城时暂停 */
    var tasks = [];
    Object.keys(G.factions).forEach(function (fid) {
      var f = G.factions[fid];
      if (!f.alive || f.isPlayer) return;
      tasks.push({ f: f, cities: shuffle(SG.factionCities(fid).slice()), i: 0 });
    });

    function finish() {
      if (finished) return;
      finished = true;

      /* 全场结算 */
      Object.keys(G.factions).forEach(function (fid) {
        var f = G.factions[fid];
        if (!f.alive) return;
        var r = settleFaction(f);
        if (f.isPlayer) summary.push(r);
        if (r.starve) SG.log('【' + f.name + '】粮草断绝，军心浮动！', 'bad');
      });

      /* 月份推进 */
      G.month += 1;
      G.turn += 1;
      if (G.month > 12) { G.month = 1; G.year += 1; }
      SG.refreshCityAP();

      /* 胜负判定 */
      SG.checkEnd();

      if (hooks.done) {
        hooks.done({ ok: true, summary: summary[0] || { gold: 0, food: 0, upkeep: 0 } });
      }
    }

    function playerWiped() {
      return SG.factionCities(G.player).length === 0;
    }

    function run() {
      if (finished) return;

      while (tasks.length) {
        var task = tasks[0];
        if (!task.f.alive) { tasks.shift(); continue; }
        if (task.i >= task.cities.length) { tasks.shift(); continue; }

        var c = task.cities[task.i++];
        var pending = aiCityTurn(task.f, c);

        if (pending) {
          if (hooks.onDefense) {
            var resumed = false;
            hooks.onDefense(pending, function () {
              if (resumed || finished) return;
              resumed = true;
              if (playerWiped()) { finish(); return; }
              run();
            });
            return;
          }
          var rep = SG.resolveBattle(pending);
          SG.applyBattleResult(pending, rep);
          if (playerWiped()) { finish(); return; }
        }

        if (playerWiped()) { finish(); return; }
      }
      finish();
    }

    run();
    return { ok: true, async: true };
  };

  SG.checkEnd = function () {
    var G = SG.G;
    var mine = SG.factionCities(G.player).length;
    if (mine === 0) { G.over = true; G.result = 'defeat'; SG.log('大势已去，基业尽失……', 'bad'); }
    else if (mine === G.cityOrder.length) { G.over = true; G.result = 'victory'; SG.log('天下一统！霸业已成！', 'imp'); }
  };

  /* ---------- 时间文本 ---------- */
  SG.dateText = function () {
    var G = SG.G;
    return G.year + '年 ' + G.month + '月';
  };

})(window);
