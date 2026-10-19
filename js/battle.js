/* ==========================================================
 * 三国志 · 战斗系统
 * 纯计算：根据出击编成推演逐回合战报，不修改全局状态
 * ========================================================== */
(function (global) {
  'use strict';
  var SG = global.SG;

  var MAX_ROUND = 15;

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* 单支部队的攻击力 */
  function power(u) {
    return u.troops
      * (0.020 + u.war / 3000)
      * (0.60 + u.lead / 250)
      * (0.70 + u.training / 330)
      * (0.75 + u.morale / 400);
  }

  function alive(side) {
    return side.units.filter(function (u) { return u.troops > 0; });
  }

  function total(side) {
    var n = 0;
    side.units.forEach(function (u) { n += Math.max(0, Math.round(u.troops)); });
    return n;
  }

  function snap(u) {
    return {
      gid: u.gid, name: u.name,
      troops: Math.max(0, Math.round(u.troops)),
      cap: 1000 + u.lead * 80,
      morale: Math.round(u.morale)
    };
  }

  function snapshot(side) {
    return side.units.map(snap);
  }

  SG.resolveBattle = function (req) {
    var atk = req.atk, def = req.def;
    var defence = def.defence || 50;

    /* 深拷贝部队，避免污染调用方数据 */
    atk.units = atk.units.map(function (u) { return Object.assign({}, u); });
    def.units = def.units.map(function (u) { return Object.assign({}, u); })
      .filter(function (u) { return u.troops > 0; });

    var atkInit = total(atk), defInit = total(def);
    var rounds = [];
    var initial = { atkTotal: atkInit, defTotal: defInit, atkUnits: snapshot(atk), defUnits: snapshot(def) };

    if (defInit <= 0) {
      return { winner: 'atk', reason: '守军望风而逃', defLeft: 0, atkLeft: atkInit, initial: initial, rounds: [] };
    }

    for (var r = 1; r <= MAX_ROUND; r++) {
      var lines = [];

      /* --- 计略阶段：智力高的部队伺机施计 --- */
      [atk, def].forEach(function (side) {
        var enemy = (side === atk) ? def : atk;
        var wise = alive(side).filter(function (u) { return u.int >= 68; })
          .sort(function (a, b) { return b.int - a.int; })[0];
        var foes = alive(enemy);
        if (!wise || !foes.length) return;
        var p = (wise.int - 55) / 190;
        if (Math.random() < p) {
          var t = pick(foes);
          var dmg = Math.round(t.troops * 0.05 * (wise.int / 100));
          t.troops = Math.max(0, t.troops - dmg);
          t.morale = Math.max(0, t.morale - 4);
          lines.push('<b>【计略】</b>' + wise.name + ' 施计，' + t.name + ' 损兵 ' + dmg);
        }
      });

      /* --- 交战阶段：按（统率+武力）依次行动 --- */
      var order = alive(atk).concat(alive(def));
      order.sort(function (a, b) { return (b.lead + b.war) - (a.lead + a.war); });

      order.forEach(function (u) {
        if (u.troops <= 0) return;
        var enemy = (atk.units.indexOf(u) >= 0) ? def : atk;
        var foes = alive(enemy);
        if (!foes.length) return;

        foes.sort(function (a, b) { return a.troops - b.troops; });
        var t = Math.random() < 0.55 ? foes[0] : pick(foes);

        var dmg = power(u) * rnd(0.8, 1.2);
        if (enemy.kind === 'def') dmg *= (1 - defence / 350);
        dmg = Math.max(50, Math.round(dmg));

        t.troops = Math.max(0, t.troops - dmg);
        lines.push(u.name + ' 攻 ' + t.name + '，歼敌 ' + dmg + (enemy.kind === 'def' ? '（城防减伤）' : ''));
        if (t.troops <= 0) lines.push('<b>▶ ' + t.name + ' 所部溃灭！</b>');
      });

      /* --- 士气修正 --- */
      [atk, def].forEach(function (side) {
        var init = (side === atk) ? atkInit : defInit;
        if (total(side) < init * 0.6) {
          side.units.forEach(function (u) { u.morale = Math.max(0, u.morale - 6); });
        }
      });

      rounds.push({
        no: r,
        atkTotal: total(atk),
        defTotal: total(def),
        atkUnits: snapshot(atk),
        defUnits: snapshot(def),
        log: lines
      });

      /* --- 结束判定 --- */
      if (!alive(def).length) {
        return { winner: 'atk', reason: '守军全灭，城池陷落', defLeft: 0, atkLeft: total(atk), initial: initial, rounds: rounds };
      }
      if (!alive(atk).length) {
        return { winner: 'def', reason: '我军全灭', defLeft: total(def), atkLeft: 0, initial: initial, rounds: rounds };
      }
      if (total(atk) < atkInit * 0.25) {
        return { winner: 'def', reason: '损兵过重，被迫撤退', defLeft: total(def), atkLeft: total(atk), initial: initial, rounds: rounds };
      }
      if (r === MAX_ROUND) {
        return { winner: 'def', reason: '久攻不下，粮尽退兵', defLeft: total(def), atkLeft: total(atk), initial: initial, rounds: rounds };
      }
    }
  };
})(window);
