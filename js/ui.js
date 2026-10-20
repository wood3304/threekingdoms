/* ==========================================================
 * 三国志 · 界面层
 * 地图渲染 / 城池面板 / 战斗演出 / 存档面板
 * ========================================================== */
(function (global) {
  'use strict';
  var SG = global.SG;
  var UI = {};
  SG.UI = UI;

  /* ---------- 小工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function fmt(n) { return (Math.round(n) || 0).toLocaleString('en-US'); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function genPower(g) { return g.lead * 1.5 + g.war * 1.2 + g.int * 0.6; }

  UI.toast = function (msg, type) {
    var w = $('toastWrap');
    if (!w) return;
    var d = document.createElement('div');
    d.className = 'toast ' + (type || '');
    d.textContent = msg;
    w.appendChild(d);
    setTimeout(function () {
      d.style.transition = '.4s';
      d.style.opacity = '0';
      d.style.transform = 'translateY(-8px)';
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 420);
    }, 2800);
  };

  function openModal(opt) {
    var mask = document.createElement('div');
    mask.className = 'mask';
    mask.innerHTML =
      '<div class="dialog ' + (opt.cls || '') + '">' +
      (opt.title === false ? '' : '<h3>' + (opt.title || '') + (opt.noClose ? '' : '<span class="x">✕</span>') + '</h3>') +
      '<div class="body">' + (opt.body || '') + '</div>' +
      (opt.foot ? '<div class="foot">' + opt.foot + '</div>' : '') +
      '</div>';
    $('modals').appendChild(mask);
    var api = {
      mask: mask,
      q: function (sel) { return mask.querySelector(sel); },
      qa: function (sel) { return Array.prototype.slice.call(mask.querySelectorAll(sel)); },
      close: function () { if (mask.parentNode) mask.parentNode.removeChild(mask); }
    };
    var x = mask.querySelector('h3 .x');
    if (x) x.onclick = api.close;
    if (!opt.noClose) {
      mask.addEventListener('mousedown', function (e) { if (e.target === mask) api.close(); });
    }
    return api;
  }
  UI.openModal = openModal;

  /* ---------- 顶部 ---------- */
  function renderTop() {
    var G = SG.G;
    $('tbDate').textContent = SG.dateText();
    var f = G.factions[G.player];
    var tag = $('tbFaction');
    if (f) {
      tag.textContent = f.name + '　' + SG.factionCities(f.id).length + '城';
      tag.style.color = f.color;
      tag.style.borderColor = f.color;
      tag.style.background = 'rgba(255,255,255,.05)';
    }
  }

  /* ---------- 地图 ---------- */
  var TERRAIN =
    '<path class="river" d="M 90 300 C 250 330 380 300 520 320 C 650 340 760 300 900 265"/>' +
    '<path class="river" d="M 90 620 C 260 585 360 600 470 612 C 600 626 700 600 830 545"/>' +
    '<path class="mount" d="M 250 400 l 26 -34 l 26 34 z M 300 380 l 26 -34 l 26 34 z M 350 400 l 26 -34 l 26 34 z M 470 240 l 26 -34 l 26 34 z M 520 220 l 26 -34 l 26 34 z M 700 640 l 26 -34 l 26 34 z"/>' +
    '<path class="river" d="M 640 130 C 700 100 780 92 900 90" stroke-width="3" opacity=".35"/>';

  function renderMap() {
    var G = SG.G;
    var svg = $('map');
    var M = SG.MAP;
    var s = '<g>' + TERRAIN + '</g>';

    /* 道路 */
    s += '<g>';
    G.cityOrder.forEach(function (id) {
      var c = G.cities[id];
      SG.adj(id).forEach(function (nid) {
        if (nid <= id) return;
        var n = G.cities[nid];
        s += '<line class="road" x1="' + c.x + '" y1="' + c.y + '" x2="' + n.x + '" y2="' + n.y + '"/>';
      });
    });
    s += '</g>';

    /* 出击高亮道路 */
    if (UI._targets && UI._targets.length && G.sel) {
      var sel = G.cities[G.sel];
      s += '<g>';
      UI._targets.forEach(function (tid) {
        var t = G.cities[tid];
        s += '<line class="road hot" x1="' + sel.x + '" y1="' + sel.y + '" x2="' + t.x + '" y2="' + t.y + '"/>';
      });
      s += '</g>';
    }

    /* 城池 */
    s += '<g>';
    G.cityOrder.forEach(function (id) {
      var c = G.cities[id];
      var f = c.owner ? G.factions[c.owner] : null;
      var color = f ? f.color : '#6b7280';
      var r = 13 + Math.min(6, c.troops / 9000);
      var cls = 'city';
      if (G.sel === id) cls += ' sel';
      if (UI._targets && UI._targets.indexOf(id) >= 0) cls += ' target';
      s += '<g class="' + cls + '" data-id="' + id + '" transform="translate(' + c.x + ',' + c.y + ')">' +
        '<circle class="hit" r="26"/>' +
        '<circle class="dot" r="' + r.toFixed(1) + '" fill="' + color + '"/>' +
        '<text class="cname" y="-25">' + esc(c.name) + '</text>' +
        '<text class="ctroops" y="' + (r + 15).toFixed(1) + '">' + fmt(c.troops) + '</text>' +
        '</g>';
    });
    s += '</g>';

    svg.setAttribute('viewBox', M.x + ' ' + M.y + ' ' + M.w + ' ' + M.h);
    svg.innerHTML = s;

    var hint = $('mapHint');
    if (UI._mode === 'attack') hint.textContent = '· 出击模式 · 请点击红圈标记的敌方城池（按 Esc 取消）';
    else hint.textContent = '· 点击城池查看详情 · 滚轮无效，可用侧栏指令治理内政 ·';
  }

  /* ---------- 侧栏 ---------- */
  var ACTION_ICON = {
    develop: '开发', farm: '治水', patrol: '巡查', fortify: '筑城',
    train: '训练', draft: '征兵', levy: '征收', recruit: '登用'
  };

  function statRow(label, val, cls) {
    return '<div class="statRow"><span class="lb">' + label + '</span>' +
      '<span class="bar"><i class="' + cls + '" style="width:' + val + '%"></i></span>' +
      '<span class="vl">' + val + '</span></div>';
  }

  function renderSide() {
    var G = SG.G;
    var side = $('side');
    if (!G.sel || !G.cities[G.sel]) {
      side.innerHTML = '<div class="empty">点击地图上的城池<br>查看详情与下达指令</div>';
      return;
    }
    var c = G.cities[G.sel];
    var f = c.owner ? G.factions[c.owner] : null;
    var mine = c.owner === G.player;
    var gov = SG.governor(c);
    var gens = SG.cityGenerals(c);

    var h = '';
    h += '<div class="cpHead">' +
      '<div class="flag" style="background:' + (f ? f.color : '#6b7280') + '"></div>' +
      '<div><div class="nm">' + esc(c.name) + '</div>' +
      '<div class="own" style="color:' + (f ? f.color : '#888') + '">' +
      (f ? esc(f.name) + '　' + (mine ? '（我方）' : '（敌方）') : '无主') + '</div></div>' +
      '<div style="margin-left:auto;text-align:right"><div class="dim" style="font-size:11px">行动力</div>' +
      '<div class="gold" style="font-size:18px;font-weight:700">' + c.ap + '</div></div>' +
      '</div>';

    h += '<div class="cpBody">';

    h += '<div class="secTitle">城池状态</div>';
    h += statRow('农业', c.agri, 'bAgri');
    h += statRow('商业', c.comm, 'bComm');
    h += statRow('治安', c.order, 'bOrder');
    h += statRow('城防', c.def, 'bDef');
    h += statRow('训练', c.training, 'bTrain');
    h += statRow('士气', c.morale, 'bMorale');
    h += '<div class="kv"><span>驻留兵力</span><b>' + fmt(c.troops) + '</b></div>';
    h += '<div class="kv"><span>太守</span><b>' + (gov ? esc(gov.name) : '—') + '</b></div>';
    h += '<div class="kv"><span>相邻城池</span><b style="font-size:12px">' +
      SG.adj(c.id).map(function (id) {
        var n = G.cities[id];
        var nf = n.owner ? G.factions[n.owner] : null;
        return '<span style="color:' + (nf ? nf.color : '#888') + '">' + esc(n.name) + '</span>';
      }).join(' ') + '</b></div>';

    h += '<div class="secTitle">驻守武将（' + gens.length + '）</div>';
    h += '<div class="genList">';
    if (!gens.length) h += '<div class="dim" style="font-size:12px">城中无武将</div>';
    gens.forEach(function (g) {
      var wild = g.faction === null;
      h += '<div class="genItem" data-gen="' + g.id + '">' +
        '<span class="gn">' + esc(g.name) + (wild ? '<span class="dim" style="font-weight:400">·野</span>' : '') + '</span>' +
        '<span class="gv">统<em>' + g.lead + '</em> 武<em>' + g.war + '</em> 智<em>' + g.int + '</em> 政<em>' + g.pol + '</em> 魅<em>' + g.chr + '</em></span>' +
        (wild ? '' : '<span class="gv" style="margin-left:auto">忠<em>' + g.loyalty + '</em></span>') +
        '</div>';
    });
    h += '</div>';

    h += '<div class="secTitle">内政指令</div>';
    h += '<div class="actGrid">';
    SG.ACTIONS.forEach(function (a) {
      var cost = SG.ACTION_COST[a.key] || 0;
      var dis = !mine || c.ap <= 0;
      if (cost > 0 && f && f.gold < cost) dis = true;
      if (a.key === 'recruit') {
        var hasWild = gens.some(function (g) { return g.faction === null; });
        if (!hasWild) dis = true;
      }
      if (a.type === '军事' && a.key === 'draft' && c.order < 25) dis = true;
      var tag = cost > 0 ? cost + ' 金' : (a.key === 'draft' ? '250金/千兵' : '免费');
      h += '<button class="actBtn" data-act="' + a.key + '" ' + (dis ? 'disabled' : '') + '>' +
        a.name + '<small>' + tag + '</small></button>';
    });
    h += '</div>';

    h += '<div class="secTitle">军事</div>';
    var tgt = mine ? SG.attackTargets(c.id) : [];
    var canAtk = mine && c.ap > 0 && c.troops >= 1000 && tgt.length > 0;
    h += '<button class="btn primary" style="width:100%;padding:11px" data-act="__attack" ' + (canAtk ? '' : 'disabled') + '>' +
      (mine ? '出　阵（可攻 ' + tgt.length + ' 城）' : '非本方城池') + '</button>';

    if (mine && !gens.length) h += '<div class="dim" style="font-size:12px;margin-top:8px">城中无武将，无法出征</div>';

    h += '</div>';
    side.innerHTML = h;
  }

  /* ---------- 底栏 ---------- */
  function renderBottom() {
    var G = SG.G;
    var f = G.factions[G.player];
    var cities = SG.factionCities(G.player);
    var troops = SG.factionTroops(G.player);
    var h = '';
    h += '<div class="res"><span class="ic">金</span><b>' + fmt(f.gold) + '</b></div>';
    h += '<div class="res"><span class="ic">粮</span><b>' + fmt(f.food) + '</b></div>';
    h += '<div class="res"><span class="ic">城</span><b>' + cities.length + '</b><span class="dim">/ ' + G.cityOrder.length + '</span></div>';
    h += '<div class="res"><span class="ic">兵</span><b>' + fmt(troops) + '</b></div>';
    h += '<div class="spacer"></div>';
    h += '<button class="btn primary" id="endTurnBtn" ' + (G.over ? 'disabled' : '') + '>' +
      (G.over ? '游戏结束' : '结束回合 ▶') + '</button>';
    $('bottombar').innerHTML = h;
  }

  /* ---------- 编年史 ---------- */
  function renderLog() {
    var G = SG.G;
    var h = '';
    G.log.slice(0, 60).forEach(function (e) {
      h += '<div class="' + e.cls + '"><span class="tm">' + e.t + '</span>' + esc(e.text) + '</div>';
    });
    $('logList').innerHTML = h;
  }

  UI.renderAll = function () {
    if (!SG.G) return;
    document.body.classList.remove('inMenu');
    renderTop(); renderMap(); renderSide(); renderBottom(); renderLog();
  };

  /* ---------- 选择城池 ---------- */
  UI.select = function (id) {
    if (UI._mode === 'attack') {
      if (UI._targets && UI._targets.indexOf(id) >= 0) {
        UI._mode = null;
        openBattlePrep(id);
      } else {
        UI.toast('请选择红色标记的敌方城池', 'bad');
      }
      return;
    }
    SG.G.sel = id;
    renderMap(); renderSide();
  };

  /* ---------- 出击准备 ---------- */
  function openBattlePrep(toId) {
    var G = SG.G;
    var from = G.cities[G.sel];
    var to = G.cities[toId];
    var gens = SG.cityGenerals(from).filter(function (g) { return g.faction === from.owner; });
    if (!gens.length) { UI.toast('城中无武将，无法出征', 'bad'); UI._targets = null; renderMap(); return; }

    gens.sort(function (a, b) { return genPower(b) - genPower(a); });
    var picked = gens.slice(0, Math.min(3, gens.length)).map(function (g) { return g.id; });
    var defGens = SG.cityGenerals(to).filter(function (g) { return g.faction === to.owner; });

    var body = '';
    body += '<div style="display:flex;gap:18px;margin-bottom:14px">' +
      '<div style="flex:1"><div class="dim" style="font-size:12px">出征城池</div>' +
      '<div style="font-size:16px;color:#e8dfc0">' + esc(from.name) + '　<span class="gold">' + fmt(from.troops) + '</span> 兵</div></div>' +
      '<div style="color:#8a8f9a;align-self:center">➜</div>' +
      '<div style="flex:1;text-align:right"><div class="dim" style="font-size:12px">攻击目标</div>' +
      '<div style="font-size:16px;color:' + G.factions[to.owner].color + '">' + esc(to.name) + '　' + fmt(to.troops) + ' 兵</div></div>' +
      '</div>';
    body += '<div class="secTitle">选择出阵武将（最多 5 名）</div><div class="pickList" id="pickList">';
    gens.forEach(function (g) {
      body += '<div class="pick' + (picked.indexOf(g.id) >= 0 ? ' on' : '') + '" data-pick="' + g.id + '">' +
        esc(g.name) + ' <small>统' + g.lead + ' 武' + g.war + ' 智' + g.int + '｜上限' + fmt(SG.unitCap(g)) + '</small></div>';
    });
    body += '</div>';

    body += '<div class="secTitle">出征兵力</div>';
    body += '<div style="display:flex;align-items:center;gap:12px">' +
      '<input type="range" id="troopRange" min="1000" max="1000" step="500" value="1000">' +
      '<b id="troopVal" class="gold" style="width:80px;text-align:right">0</b></div>';
    body += '<div class="dim" id="troopHint" style="font-size:12px;margin-top:6px">可用上限随所选武将带兵能力变化，出征后城池将扣除相应兵力。</div>';

    body += '<div class="secTitle">守方情报</div>';
    body += '<div style="font-size:12.5px;color:#b9bcc4">' +
      (defGens.length
        ? defGens.map(function (g) { return esc(g.name) + '(统' + g.lead + ' 武' + g.war + ')'; }).join('、')
        : '无武将驻守') +
      '　｜　城防 <b class="gold">' + to.def + '</b>　训练 ' + to.training + '　士气 ' + to.morale + '</div>';
    body += '<div class="dim" style="font-size:11.5px;margin-top:5px">守军会分营列阵（至少 3 支），依城而守；请谨慎选择出征兵力。</div>';

    var m = openModal({
      title: '出阵 · ' + esc(from.name) + ' ➜ ' + esc(to.name),
      cls: 'battleBox',
      body: body,
      foot: '<button class="btn" data-x="cancel">取消</button>' +
        '<button class="btn primary" data-x="go">出　阵</button>'
    });

    function refresh() {
      var cap = 0;
      picked.forEach(function (id) { cap += SG.unitCap(G.generals[id]); });
      var max = Math.min(from.troops, cap);
      var r = m.q('#troopRange');
      r.max = Math.max(1000, Math.floor(max / 500) * 500);
      /* 默认带上全部可出征兵力，避免玩家误带千人送死 */
      if (!refresh._init) { r.value = r.max; refresh._init = true; }
      else if (+r.value > +r.max) r.value = r.max;
      m.q('#troopVal').textContent = fmt(+r.value);
      var hintEl = m.q('#troopHint');
      var left = Math.max(0, from.troops - (+r.value));
      if (left < 500) {
        hintEl.textContent = '注意：城内将几乎没有守军（剩余 ' + fmt(left) + '），谨防敌军偷袭。';
        hintEl.style.color = '#d1655a';
      } else {
        hintEl.textContent = '可用上限随所选武将带兵能力变化，出征后城池将扣除相应兵力。';
        hintEl.style.color = '';
      }
      m.qa('[data-pick]').forEach(function (el) {
        el.classList.toggle('on', picked.indexOf(el.dataset.pick) >= 0);
      });
    }

    m.mask.addEventListener('click', function (e) {
      var p = e.target.closest('[data-pick]');
      if (p) {
        var id = p.dataset.pick;
        var i = picked.indexOf(id);
        if (i >= 0) { if (picked.length > 1) picked.splice(i, 1); }
        else {
          if (picked.length >= 5) { UI.toast('最多选择 5 名武将', 'bad'); return; }
          picked.push(id);
        }
        refresh();
        return;
      }
      var x = e.target.closest('[data-x]');
      if (x) {
        if (x.dataset.x === 'cancel') { m.close(); UI._targets = null; renderMap(); return; }
        var amount = +m.q('#troopRange').value;
        var req = SG.prepareAttack(from.id, to.id, picked, amount);
        if (!req.ok) { UI.toast(req.msg, 'bad'); return; }
        m.close();
        UI._targets = null;
        UI._mode = null;
        SG.BattleUI.play(req, {
          playerSide: 'atk',
          onFinish: function (report) {
            SG.applyBattleResult(req, report);
            SG.autosave();
            UI.renderAll();
            if (to.owner === G.player) UI.select(to.id);
            checkEnd();
          }
        });
      }
    });

    m.q('#troopRange').addEventListener('input', function () {
      m.q('#troopVal').textContent = fmt(+this.value);
    });
    refresh();
  }

  /* ---------- 战斗演出 ----------
   * 战场绘制与操作见 js/battle-ui.js（SG.BattleUI.play）
   * ------------------------------------------ */

  /* ---------- 武将详情 ---------- */
  function openGeneral(gid) {
    var G = SG.G;
    var g = G.generals[gid];
    if (!g) return;
    var mine = g.faction === G.player;
    var body = '<div style="font-size:22px;color:#f0e9d6;margin-bottom:4px">' + esc(g.name) + '</div>' +
      '<div class="dim" style="font-size:12.5px;margin-bottom:12px">' +
      (g.faction ? '归属：' + esc(G.factions[g.faction].name) : '在野') +
      '　所在地：' + esc(g.city) + (mine ? '　忠诚：' + g.loyalty : '') + '</div>';
    var labels = [['统率', 'lead'], ['武力', 'war'], ['智力', 'int'], ['政治', 'pol'], ['魅力', 'chr']];
    labels.forEach(function (l) {
      body += statRow(l[0], g[l[1]], 'bMorale');
    });
    body += '<div class="kv" style="margin-top:10px"><span>带兵上限</span><b>' + fmt(SG.unitCap(g)) + '</b></div>';

    var foot = '<button class="btn" data-x="close">关闭</button>';
    if (mine) {
      var c = G.cities[g.city];
      var dests = SG.adj(c.id).filter(function (id) { return G.cities[id].owner === G.player; });
      if (dests.length) {
        body += '<div class="secTitle">调任（需相邻己方城池）</div><div class="pickList">';
        dests.forEach(function (id) {
          body += '<div class="pick" data-move="' + id + '">➜ ' + esc(G.cities[id].name) + '</div>';
        });
        body += '</div>';
      }
    }
    var m = openModal({ title: '武将', body: body, foot: foot });
    m.mask.addEventListener('click', function (e) {
      var x = e.target.closest('[data-x]');
      if (x) { m.close(); return; }
      var mv = e.target.closest('[data-move]');
      if (mv) {
        var r = SG.moveGeneral(gid, mv.dataset.move);
        UI.toast(r.msg, r.ok ? 'good' : 'bad');
        if (r.ok) { m.close(); UI.renderAll(); }
      }
    });
  }

  /* ---------- 出征模式 ---------- */
  function enterAttackMode() {
    var c = SG.city(SG.G.sel);
    if (!SG.canAttack(c)) { UI.toast('无法出征：行动力不足或兵力不足', 'bad'); return; }
    UI._targets = SG.attackTargets(c.id).map(function (t) { return t.id; });
    UI._mode = 'attack';
    renderMap();
    UI.toast('请点击地图上红圈标记的敌方城池');
  }

  function cancelMode() {
    UI._mode = null; UI._targets = null; renderMap();
  }

  /* ---------- 征兵弹窗 ---------- */
  function openDraft() {
    var G = SG.G;
    var c = SG.city(G.sel);
    var f = G.factions[G.player];
    var maxByGold = Math.floor(f.gold / 250) * 1000;
    var maxByFood = Math.floor(f.food);
    var cap = Math.floor((c.order < 40 ? 3000 : 20000) * (0.5 + c.order / 200));
    var max = Math.min(maxByGold, maxByFood, cap);
    max = Math.floor(max / 1000) * 1000;
    if (max < 1000) { UI.toast('金或粮不足，无法征兵', 'bad'); return; }
    var body = '<div class="dim" style="font-size:12.5px;margin-bottom:12px">' +
      '现有金 ' + fmt(f.gold) + '　粮 ' + fmt(f.food) + '　治安 ' + c.order + '<br>' +
      '每 1000 兵消耗 250 金 + 1000 粮</div>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
      '<input type="range" id="dr" min="1000" max="' + max + '" step="1000" value="' + Math.min(max, 3000) + '">' +
      '<b id="dv" class="gold" style="width:76px;text-align:right"></b></div>' +
      '<div class="dim" style="font-size:12px;margin-top:8px" id="dcost"></div>';
    var m = openModal({
      title: '征兵 · ' + esc(c.name), body: body,
      foot: '<button class="btn" data-x="c">取消</button><button class="btn primary" data-x="ok">征　兵</button>'
    });
    function upd() {
      var v = +m.q('#dr').value;
      m.q('#dv').textContent = fmt(v);
      m.q('#dcost').textContent = '消耗 ' + fmt(v / 1000 * 250) + ' 金 + ' + fmt(v) + ' 粮，治安 -' + Math.round(v / 4000);
    }
    m.q('#dr').addEventListener('input', upd);
    upd();
    m.mask.addEventListener('click', function (e) {
      var x = e.target.closest('[data-x]');
      if (!x) return;
      if (x.dataset.x === 'c') { m.close(); return; }
      var r = SG.doAction(c.id, 'draft', { amount: +m.q('#dr').value });
      UI.toast(r.msg, r.ok ? 'good' : 'bad');
      if (r.ok) { m.close(); UI.renderAll(); }
    });
  }

  /* ---------- 结束判定弹窗 ---------- */
  function checkEnd() {
    var G = SG.G;
    if (!G.over) return;
    var win = G.result === 'victory';
    var m = UI.openModal({
      title: win ? '天下统一' : '大势已去',
      noClose: true,
      body: '<div style="text-align:center;padding:20px 30px;font-size:17px;line-height:2.2">' +
        (win ? '☆ 恭喜！你已扫平群雄，一统天下 ☆' : '城池尽失，霸业成空……') +
        '<br><span class="dim" style="font-size:13px">历经 ' + G.turn + ' 个月　' + SG.dateText() + '</span></div>',
      foot: '<button class="btn primary" data-x="menu">返回势力选择</button>'
    });
    m.mask.addEventListener('click', function (e) {
      if (e.target.closest('[data-x]')) { m.close(); openFactionSelect(); }
    });
  }
  UI.checkEnd = checkEnd;

  /* ---------- 势力选择 ---------- */
  function openFactionSelect() {
    var defs = SG.FACTION_DEFS;
    var body = '<div style="margin-bottom:14px;font-size:13px;color:#9aa0ad">' +
      '公元 194 年，董卓已死，李傕郭汜乱政，天下群雄并起。<br>选择一个势力，开始你的霸业：</div>' +
      '<div class="facGrid" id="facGrid">';
    defs.forEach(function (f, i) {
      var cities = f.cities.length;
      var gens = f.generals.length;
      body += '<div class="facCard' + (i === 0 ? ' sel' : '') + '" data-fac="' + f.id + '">' +
        '<div class="fname" style="color:' + f.color + '">' + f.name + '</div>' +
        '<div class="fmeta">城池 <b>' + cities + '</b>　武将 <b>' + gens + '</b><br>' +
        '金 <b>' + f.gold + '</b>　粮 <b>' + f.food + '</b><br>' +
        '<span style="font-size:11px">' + f.cities.slice(0, 4).join('、') + (cities > 4 ? ' 等' : '') + '</span></div>' +
        '<div class="bars" style="background:' + f.color + '"></div>' +
        '</div>';
    });
    body += '</div>';

    var foot = '';
    if (SG.hasAutosave()) {
      var ai = SG.autoInfo();
      foot += '<button class="btn gold" data-x="cont">继续上次进度' +
        (ai ? '（' + ai.faction + ' ' + ai.date + '）' : '') + '</button>';
    }
    if (SG.storageAvailable) {
      foot += '<button class="btn" data-x="load">读取存档</button>';
    }
    foot += '<button class="btn primary" data-x="start">开始游戏</button>';

    var m = openModal({ title: '三国志 · 乱世开局', noClose: true, body: body, foot: foot });
    var sel = defs[0].id;
    m.mask.addEventListener('click', function (e) {
      var card = e.target.closest('[data-fac]');
      if (card) {
        sel = card.dataset.fac;
        m.qa('[data-fac]').forEach(function (el) { el.classList.toggle('sel', el === card); });
        return;
      }
      var x = e.target.closest('[data-x]');
      if (!x) return;
      var k = x.dataset.x;
      if (k === 'start') {
        m.close();
        SG.newGame(sel);
        SG.autosave();
        UI.renderAll();
        UI.toast('已选择 ' + SG.faction(sel).name + ' 势力，开始征战！', 'good');
      } else if (k === 'cont') {
        var G = SG.loadAutosave();
        if (!G) { UI.toast('自动存档已损坏', 'bad'); return; }
        m.close();
        UI.renderAll();
        UI.toast('已读取自动存档', 'good');
      } else if (k === 'load') {
        m.close();
        openSavePanel(openFactionSelect);
      }
    });
  }
  UI.openFactionSelect = openFactionSelect;

  /* ---------- 存档面板 ---------- */
  function openSavePanel(backFn) {
    function slotRow(key, label, info) {
      var h = '<div class="slot"><div class="sn">' + label + '</div>';
      if (info) {
        h += '<div class="sinfo"><b style="color:' + (info.color || '#dcd6c4') + '">' + esc(info.faction) + '</b>　' +
          esc(info.date) + '　城池 ' + info.cities + '　兵力 ' + fmt(info.troops) +
          (info.over ? '　<span class="dim">[已结束]</span>' : '') +
          '<br><span style="font-size:11px;color:#666c78">' + esc(info.savedAt || '') + '</span></div>';
      } else {
        h += '<div class="sinfo dim">— 空 —</div>';
      }
      h += '<div class="sact">';
      if (key !== 'auto') h += '<button class="btn sm" data-save="' + key + '">存档</button>';
      if (info) {
        h += '<button class="btn sm gold" data-load="' + key + '">读档</button>';
        if (key !== 'auto') h += '<button class="btn sm" data-del="' + key + '">删除</button>';
      }
      h += '</div></div>';
      return h;
    }

    function build() {
      var body = '';
      body += slotRow('auto', '自动', SG.autoInfo());
      for (var i = 1; i <= SG.SLOT_COUNT; i++) body += slotRow(i, '存档 ' + i, SG.slotInfo(i));
      body += '<div class="secTitle">存档文件</div>' +
        '<div class="dim" style="font-size:12.5px;line-height:1.9;margin-bottom:10px">' +
        '自动存档：每次结束回合后写入浏览器本地存储（localStorage）。<br>' +
        '导出的 JSON 文件可长期保存或分享给他人。</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
        '<button class="btn" data-x="export">导出当前进度为文件</button>' +
        '<button class="btn" data-x="import">从文件导入进度</button>' +
        '<input type="file" id="fileInput" accept=".json,application/json" style="display:none">' +
        '</div>';
      if (!SG.storageAvailable) {
        body = '<div class="toast bad" style="margin-bottom:12px">当前环境不支持 localStorage，只能使用文件导入导出。</div>' + body;
      }
      return body;
    }

    var m = openModal({
      title: '存档 / 读档', cls: '', body: build(),
      foot: '<button class="btn" data-x="close">关闭</button>'
    });

    m.mask.addEventListener('click', function (e) {
      var x = e.target.closest('[data-x]');
      if (x) {
        if (x.dataset.x === 'close') { m.close(); backFn && backFn(); }
        else if (x.dataset.x === 'export') {
          if (!SG.G) { UI.toast('没有进行中的游戏', 'bad'); return; }
          SG.exportSave();
          UI.toast('已导出存档文件', 'good');
        } else if (x.dataset.x === 'import') {
          m.q('#fileInput').click();
        }
        return;
      }
      var s = e.target.closest('[data-save]');
      if (s) {
        if (!SG.G) { UI.toast('没有进行中的游戏', 'bad'); return; }
        var r = SG.saveToSlot(s.dataset.save);
        UI.toast(r.ok ? '已保存到存档 ' + s.dataset.save : (r.msg || '保存失败'), r.ok ? 'good' : 'bad');
        if (r.ok) { m.q('.body').innerHTML = build(); }
        return;
      }
      var l = e.target.closest('[data-load]');
      if (l) {
        var key = l.dataset.load;
        var G = (key === 'auto') ? SG.loadAutosave() : SG.loadFromSlot(+key);
        if (!G) { UI.toast('读取失败', 'bad'); return; }
        m.close();
        UI.renderAll();
        UI.toast('读档成功：' + SG.dateText(), 'good');
        return;
      }
      var d = e.target.closest('[data-del]');
      if (d) {
        SG.deleteSlot(+d.dataset.del);
        m.q('.body').innerHTML = build();
        UI.toast('已删除存档 ' + d.dataset.del);
      }
    });

    /* 用事件委托，保证面板重绘后仍能响应导入 */
    m.mask.addEventListener('change', function (e) {
      if (!e.target || e.target.id !== 'fileInput') return;
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      SG.importSave(file, function (err) {
        if (err) { UI.toast('导入失败：' + err.message, 'bad'); return; }
        m.close();
        UI.renderAll();
        UI.toast('已导入存档：' + SG.dateText(), 'good');
      });
    });
  }
  UI.openSavePanel = openSavePanel;

  /* ---------- 武将一览 ---------- */
  function openGeneralList() {
    var G = SG.G;
    var list = SG.sortedGenerals(G.player, 'lead');
    var byCity = {};
    list.forEach(function (g) { (byCity[g.city] = byCity[g.city] || []).push(g); });

    var body = '<div class="dim" style="font-size:12.5px;margin-bottom:10px">共 ' + list.length + ' 名武将　按统率排序</div>';
    body += '<div style="max-height:56vh;overflow:auto"><table class="grid"><thead><tr>' +
      '<th>姓名</th><th>所在</th><th>统率</th><th>武力</th><th>智力</th><th>政治</th><th>魅力</th><th>忠诚</th><th>带兵上限</th>' +
      '</tr></thead><tbody>';
    list.forEach(function (g) {
      body += '<tr><td class="hi">' + esc(g.name) + '</td><td>' + esc(g.city) + '</td>' +
        '<td>' + g.lead + '</td><td>' + g.war + '</td><td>' + g.int + '</td>' +
        '<td>' + g.pol + '</td><td>' + g.chr + '</td>' +
        '<td>' + (g.loyalty >= 80 ? '<span style="color:#4fbf7a">' + g.loyalty + '</span>' : g.loyalty < 50 ? '<span style="color:#d1655a">' + g.loyalty + '</span>' : g.loyalty) + '</td>' +
        '<td>' + fmt(SG.unitCap(g)) + '</td></tr>';
    });
    body += '</tbody></table></div>';

    var m = openModal({ title: '武将一览', body: body, foot: '<button class="btn" data-x="c">关闭</button>' });
    m.mask.addEventListener('click', function (e) {
      if (e.target.closest('[data-x]')) m.close();
    });
  }

  /* ---------- 势力一览 ---------- */
  function openFactionList() {
    var G = SG.G;
    var rows = [];
    Object.keys(G.factions).forEach(function (id) {
      var f = G.factions[id];
      if (!f.alive) return;
      rows.push({
        f: f, cities: SG.factionCities(id).length, troops: SG.factionTroops(id),
        gold: f.gold, food: f.food
      });
    });
    rows.sort(function (a, b) { return b.cities - a.cities; });
    var body = '<table class="grid"><thead><tr><th>势力</th><th>君主</th><th>城池</th><th>兵力</th><th>金</th><th>粮</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      body += '<tr><td class="hi" style="color:' + r.f.color + '">' + esc(r.f.name) + (r.f.isPlayer ? ' ★' : '') + '</td>' +
        '<td>' + esc(r.f.ruler) + '</td><td>' + r.cities + '</td><td>' + fmt(r.troops) + '</td>' +
        '<td>' + fmt(r.gold) + '</td><td>' + fmt(r.food) + '</td></tr>';
    });
    body += '</tbody></table>';
    var m = openModal({ title: '天下势力', body: body, foot: '<button class="btn" data-x="c">关闭</button>' });
    m.mask.addEventListener('click', function (e) {
      if (e.target.closest('[data-x]')) m.close();
    });
  }

  /* ---------- 结束回合 ---------- */
  function doEndTurn() {
    var G = SG.G;
    if (!G || G.over || UI._turnBusy) return;
    UI._turnBusy = true;

    var before = SG.factionCities(G.player).length;

    function finishTurn(r) {
      UI._turnBusy = false;
      SG.autosave();
      UI._mode = null;
      UI._targets = null;
      UI.renderAll();
      if (r && r.summary) {
        var s = r.summary;
        UI.toast('月结算：金 ' + (s.gold >= 0 ? '+' : '') + fmt(s.gold) +
          '　粮 ' + (s.food - s.upkeep >= 0 ? '+' : '') + fmt(s.food - s.upkeep), 'good');
      }
      var after = SG.factionCities(G.player).length;
      if (after < before) UI.toast('告急！我方有城池失守！', 'bad');
      if (G.over) checkEnd();
    }

    SG.endTurn({
      /* 敌军来犯且目标是我方城池：玩家亲自守城 */
      onDefense: function (req, resume) {
        UI.renderAll();
        UI.toast('敌军来袭：' + req.atk.cityName + ' 攻 ' + req.def.cityName, 'bad');
        SG.BattleUI.play(req, {
          playerSide: 'def',
          onFinish: function (report) {
            SG.applyBattleResult(req, report);
            SG.autosave();
            UI.renderAll();
            resume();
          }
        });
      },
      done: finishTurn
    });
  }
  UI.endTurn = doEndTurn;

  /* ---------- 事件绑定 ---------- */
  UI.init = function () {
    /* 地图点击 */
    $('map').addEventListener('click', function (e) {
      var g = e.target.closest('.city');
      if (g) UI.select(g.dataset.id);
    });

    /* 侧栏 */
    $('side').addEventListener('click', function (e) {
      var gi = e.target.closest('[data-gen]');
      if (gi) { openGeneral(gi.dataset.gen); return; }
      var b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      var act = b.dataset.act;
      var city = SG.city(SG.G.sel);
      if (!city) return;
      if (act === '__attack') { enterAttackMode(); return; }
      if (act === 'draft') { openDraft(); return; }
      var r = SG.doAction(city.id, act);
      UI.toast(r.msg, r.ok ? 'good' : 'bad');
      if (r.ok) { SG.autosave(); UI.renderAll(); }
    });

    /* 顶栏 */
    $('topbar').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'btnGenerals') {
        if (!SG.G) return;
        openGeneralList();
      } else if (b.id === 'btnFactions') {
        if (!SG.G) return;
        openFactionList();
      } else if (b.id === 'btnSave') {
        openSavePanel();
      } else if (b.id === 'btnMenu') {
        openFactionSelect();
      }
    });

    /* 底栏 */
    $('bottombar').addEventListener('click', function (e) {
      if (e.target.closest('#endTurnBtn')) doEndTurn();
    });

    /* 快捷键 */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        cancelMode();
        var ms = document.querySelectorAll('.mask');
        if (ms.length) {
          var last = ms[ms.length - 1];
          if (last.querySelector('h3 .x')) last.remove();   /* 不可关闭的弹窗（战斗/结算）忽略 Esc */
        }
      }
      if (e.key === ' ' && !document.querySelector('.mask') && SG.G && !SG.G.over) {
        e.preventDefault(); doEndTurn();
      }
    });
  };

})(window);
