/* Snowball Pilot 官网脚本：明暗主题、平台检测推荐下载、最新版本号。 */
(function () {
  'use strict';

  /* ----- 明暗主题：跟随系统，可手动切换并记住 ----- */
  var THEME_KEY = 'sbp_theme';
  var themeBtn = document.getElementById('theme-toggle');

  function syncThemeBtn() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    themeBtn.textContent = dark ? '☀️ 浅色' : '🌙 深色';
  }
  themeBtn.addEventListener('click', function () {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var next = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    syncThemeBtn();
  });
  syncThemeBtn();

  /* ----- 下载项 ----- */
  var LATEST_URL = 'https://github.com/songliao/Snowball-Pilot/releases/latest/download';
  var OPTIONS = {
    'mac-arm64': { platform: 'macOS', label: 'Apple Silicon（M 系列芯片）', file: 'Snowball-Pilot-macOS-arm64.dmg' },
    'mac-x64': { platform: 'macOS', label: 'Intel 芯片', file: 'Snowball-Pilot-macOS-x64.dmg' },
    'win-setup': { platform: 'Windows', label: '安装版（Setup）', file: 'Snowball-Pilot-Windows-Setup.exe' },
    'win-portable': { platform: 'Windows', label: '便携版（免安装）', file: 'Snowball-Pilot-Windows-Portable.exe' },
    'ios': { platform: 'iOS', label: 'iPhone / iPad（TestFlight 公测）', url: 'https://testflight.apple.com/join/EgUZprFc' },
  };

  /* 检测当前设备的推荐下载项；无法识别时返回 null（不显示推荐区块） */
  function detectOption() {
    var uaData = navigator.userAgentData;
    if (uaData && uaData.getHighEntropyValue) {
      return uaData
        .getHighEntropyValue(['platform', 'architecture'])
        .then(function (hints) {
          if (hints.platform === 'macOS') return hints.architecture === 'arm' ? 'mac-arm64' : 'mac-x64';
          if (hints.platform === 'Windows') return 'win-setup';
          if (hints.platform === 'iOS') return 'ios';
          return fallbackUa();
        })
        .catch(function () { return fallbackUa(); });
    }
    return Promise.resolve(fallbackUa());
  }

  function fallbackUa() {
    var ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    // iPadOS 13+ 的 Safari 默认报桌面 Mac UA，用多点触控区分
    if (/Macintosh|Mac OS X/i.test(ua) && navigator.maxTouchPoints > 1) return 'ios';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'mac-arm64'; // UA 无法区分芯片，默认推荐 Apple Silicon
    if (/Windows/i.test(ua)) return 'win-setup';
    return null;
  }

  detectOption().then(function (id) {
    if (!id || !OPTIONS[id]) return;
    var opt = OPTIONS[id];
    document.getElementById('recommend').hidden = false;
    var btn = document.getElementById('recommend-btn');
    btn.textContent = '下载 for ' + opt.platform;
    btn.href = opt.url || LATEST_URL + '/' + opt.file;
    document.getElementById('recommend-note').textContent =
      '已为你自动选择：' + opt.label + '，不合适可在下方手动选择';
    var item = document.getElementById('opt-' + id);
    if (item) item.classList.add('recommended');
  });

  /* 最新版本号；API 限流或离线时静默降级为不带版本号 */
  fetch('https://api.github.com/repos/songliao/Snowball-Pilot/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' },
  })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (data && data.tag_name) document.getElementById('latest-version').textContent = ' ' + data.tag_name;
    })
    .catch(function () {});
})();
