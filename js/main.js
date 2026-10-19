/* ==========================================================
 * 三国志 · 启动入口
 * ========================================================== */
(function (global) {
  'use strict';
  var SG = global.SG;

  function boot() {
    SG.UI.init();

    if (SG.storageAvailable) {
      var info = SG.autoInfo();
      if (info) SG.UI.toast('检测到自动存档（' + info.faction + '　' + info.date + '）', 'good');
    } else {
      SG.UI.toast('当前浏览器不支持本地存储，存档请使用「导出文件」', 'bad');
    }

    SG.UI.openFactionSelect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
