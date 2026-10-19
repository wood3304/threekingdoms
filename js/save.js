/* ==========================================================
 * 三国志 · 存档系统
 * localStorage 自动存档 + 3 个手动存档位 + JSON 导入导出
 * ========================================================== */
(function (global) {
  'use strict';
  var SG = global.SG;

  var K_AUTO = 'sanguo_autosave';
  var K_SLOT = 'sanguo_slot_';       /* + 1..3 */
  var K_META = 'sanguo_meta_';
  var SLOTS = 3;

  function safeLS() {
    try {
      var k = '__sanguo_test__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return global.localStorage;
    } catch (e) {
      return null;
    }
  }
  var LS = safeLS();

  SG.storageAvailable = !!LS;
  SG.SLOT_COUNT = SLOTS;

  function metaOf(G) {
    return {
      date: SG.dateText(),
      year: G.year, month: G.month, turn: G.turn,
      faction: G.factions[G.player] ? G.factions[G.player].name : '?',
      color: G.factions[G.player] ? G.factions[G.player].color : '#888',
      cities: SG.factionCities(G.player).length,
      troops: SG.factionTroops(G.player),
      over: G.over,
      savedAt: new Date().toLocaleString('zh-CN')
    };
  }

  function write(key, G) {
    if (!LS) return { ok: false, msg: '浏览器不支持本地存储' };
    try {
      LS.setItem(key, JSON.stringify(G));
      LS.setItem(K_META + key, JSON.stringify(metaOf(G)));
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: '存档失败：' + e.message };
    }
  }

  function read(key) {
    if (!LS) return null;
    var raw = LS.getItem(key);
    if (!raw) return null;
    try {
      var G = JSON.parse(raw);
      if (!G || !G.cities || !G.factions) return null;
      return G;
    } catch (e) {
      return null;
    }
  }

  SG.autosave = function () {
    if (!SG.G) return { ok: false };
    return write(K_AUTO, SG.G);
  };

  SG.saveToSlot = function (n) {
    if (!SG.G) return { ok: false, msg: '没有进行中的游戏' };
    return write(K_SLOT + n, SG.G);
  };

  SG.loadFromSlot = function (n) {
    var G = read(K_SLOT + n);
    if (!G) return null;
    SG.G = G;
    return G;
  };

  SG.loadAutosave = function () {
    var G = read(K_AUTO);
    if (!G) return null;
    SG.G = G;
    return G;
  };

  SG.hasAutosave = function () { return !!read(K_AUTO); };

  SG.slotInfo = function (n) {
    if (!LS) return null;
    var raw = LS.getItem(K_META + K_SLOT + n);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  };

  SG.autoInfo = function () {
    if (!LS) return null;
    var raw = LS.getItem(K_META + K_AUTO);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  };

  SG.deleteSlot = function (n) {
    if (!LS) return;
    LS.removeItem(K_SLOT + n);
    LS.removeItem(K_META + K_SLOT + n);
  };

  SG.deleteAutosave = function () {
    if (!LS) return;
    LS.removeItem(K_AUTO);
    LS.removeItem(K_META + K_AUTO);
  };

  /* ---------- 导出 / 导入 ---------- */
  SG.exportSave = function () {
    var G = SG.G;
    if (!G) return;
    var data = JSON.stringify({ app: 'sanguo-web', v: 1, savedAt: new Date().toISOString(), game: G }, null, 0);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var f = G.factions[G.player];
    a.href = url;
    a.download = '三国志存档_' + (f ? f.name : '') + '_' + G.year + '年' + G.month + '月.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  };

  SG.importSave = function (file, cb) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var obj = JSON.parse(fr.result);
        var G = obj && obj.game ? obj.game : obj;
        if (!G || !G.cities || !G.factions || !G.player) throw new Error('文件格式不正确');
        SG.G = G;
        cb && cb(null, G);
      } catch (e) {
        cb && cb(e);
      }
    };
    fr.onerror = function () { cb && cb(new Error('读取文件失败')); };
    fr.readAsText(file, 'utf-8');
  };

})(window);
