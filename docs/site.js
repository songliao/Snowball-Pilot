/* Snowball Pilot 官网脚本：明暗主题、平台检测推荐下载、最新版本号、功能轮播。
   轮播逻辑移植自 SnowballDemo 的 FeatureCarousel.tsx，行为保持一致。 */
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

  /* ----- 功能轮播（移植自 FeatureCarousel.tsx） ----- */
  var AUTOPLAY_MS = 3000;
  var SWIPE_THRESHOLD = 46;
  var DRAG_RUBBER = 0.55;

  var root = document.getElementById('feature-carousel');
  var viewport = root.querySelector('.fc-viewport');
  var slides = Array.prototype.slice.call(viewport.querySelectorAll('.fc-slide'));
  var count = slides.length;
  var titleEl = root.querySelector('.fc-title');
  var taglineEl = root.querySelector('.fc-tagline');
  var countCurEl = root.querySelector('.fc-count-cur');
  root.querySelector('.fc-count-total').textContent = pad(count);

  var rail = root.querySelector('.fc-rail');
  var segs = slides.map(function (s, i) {
    var b = document.createElement('button');
    b.className = 'fc-seg';
    b.type = 'button';
    b.setAttribute('data-label', s.getAttribute('data-title'));
    if (i === 0) b.setAttribute('data-edge', 'start');
    if (i === count - 1) b.setAttribute('data-edge', 'end');
    b.setAttribute('aria-label', '第 ' + (i + 1) + ' 页：' + s.getAttribute('data-title'));
    b.addEventListener('click', function () { goTo(i); });
    rail.appendChild(b);
    return b;
  });

  var reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  var index = 0;
  var prevIndex = null;
  var dir = 1;
  var paused = false;
  var dragging = false;
  var remain = AUTOPLAY_MS; // 暂停期间用剩余时长记账，使 JS 计时与 CSS 进度条动画始终一致
  var runStart = 0;
  var lastIndex = 0;
  var timer = 0;

  function pad(n) { return String(n).padStart(2, '0'); }

  function render() {
    for (var i = 0; i < count; i++) {
      var s = slides[i];
      s.classList.toggle('is-active', i === index);
      s.classList.toggle('is-leaving', i === prevIndex);
      s.setAttribute('aria-hidden', i === index ? 'false' : 'true');
    }
    segs.forEach(function (seg, i) {
      seg.classList.toggle('is-active', i === index);
      if (i === index) seg.setAttribute('aria-current', 'true');
      else seg.removeAttribute('aria-current');
      // 进度条只挂在当前段上，换段即重建，动画自然从头播
      var fill = seg.querySelector('.fc-seg-fill');
      if (fill) fill.remove();
      if (i === index) {
        fill = document.createElement('span');
        fill.className = 'fc-seg-fill';
        seg.appendChild(fill);
      }
    });
    var cur = slides[index];
    titleEl.textContent = cur.getAttribute('data-title');
    taglineEl.textContent = cur.getAttribute('data-tagline');
    countCurEl.textContent = pad(index + 1);
    root.style.setProperty('--fc-dir', dir);
    schedule();
  }

  function goTo(next) {
    var cur = index;
    var norm = ((next % count) + count) % count;
    if (norm === cur) return;
    // 前进距离超过一半则视为后退，用于决定入场方向
    var forward = (((norm - cur) % count) + count) % count;
    dir = forward <= count / 2 ? 1 : -1;
    prevIndex = cur;
    index = norm;
    render();
  }

  function step(delta) { goTo(index + delta); }

  /* 只在真正在跑的时间段内扣减，暂停期间不流逝，与进度条动画的暂停保持一致 */
  function settleElapsed() {
    if (!runStart) return;
    remain = Math.max(0, remain - (Date.now() - runStart));
    runStart = 0;
  }

  function schedule() {
    window.clearTimeout(timer);
    settleElapsed();
    if (index !== lastIndex) {
      lastIndex = index;
      remain = AUTOPLAY_MS; // 换页即重新开始一轮
    }
    if (reduceMq.matches || paused || dragging) return;
    runStart = Date.now();
    timer = window.setTimeout(function () { step(1); }, remain);
  }

  root.addEventListener('pointerenter', function () { paused = true; schedule(); });
  root.addEventListener('pointerleave', function () { paused = false; schedule(); });
  // focus 事件不冒泡，用 focusin/focusout 达到 React onFocus/onBlur 的效果
  root.addEventListener('focusin', function () { paused = true; schedule(); });
  root.addEventListener('focusout', function (e) {
    if (root.contains(e.relatedTarget)) return;
    paused = false;
    schedule();
  });

  root.querySelectorAll('.fc-arrow').forEach(function (btn) {
    btn.addEventListener('click', function () { step(Number(btn.getAttribute('data-step'))); });
  });

  root.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });

  /* 拖拽 / 滑动切换：必须捕获指针，否则移出元素后 pointermove 收不到 */
  var drag = { x0: 0, y0: 0, dx: 0, locked: false };

  function endDrag(e) {
    var dx = drag.dx;
    drag = { x0: 0, y0: 0, dx: 0, locked: false };
    dragging = false;
    root.classList.remove('is-dragging');
    if (e.currentTarget.hasPointerCapture && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (Math.abs(dx) > SWIPE_THRESHOLD) step(dx < 0 ? 1 : -1);
    root.style.setProperty('--fc-drag', '0px');
    schedule();
  }

  viewport.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { x0: e.clientX, y0: e.clientY, dx: 0, locked: false };
    dragging = true;
    root.classList.add('is-dragging');
    e.currentTarget.setPointerCapture(e.pointerId);
    schedule();
  });

  viewport.addEventListener('pointermove', function (e) {
    // 未按下时指针坐标是绝对值，拿来算位移会把内容整个推出去 —— 直接忽略
    if (!(e.currentTarget.hasPointerCapture && e.currentTarget.hasPointerCapture(e.pointerId))) return;
    var mx = e.clientX - drag.x0;
    var my = e.clientY - drag.y0;
    if (!drag.locked) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      if (Math.abs(my) > Math.abs(mx)) {
        // 纵向滑动，交给页面滚动
        endDrag(e);
        return;
      }
      drag.locked = true;
    }
    drag.dx = mx;
    root.style.setProperty('--fc-drag', drag.dx * DRAG_RUBBER + 'px');
  });

  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  /* 所有页固定取同一高度（最高的那页），尺寸恒定，切换时页面不抖 */
  function measure() {
    var max = 0;
    for (var i = 0; i < count; i++) max = Math.max(max, slides[i].offsetHeight);
    if (max) viewport.style.height = max + 'px';
  }
  if ('ResizeObserver' in window) {
    var ro = new ResizeObserver(measure);
    slides.forEach(function (s) { ro.observe(s); });
  } else {
    window.addEventListener('resize', measure);
  }

  root.style.setProperty('--fc-autoplay', AUTOPLAY_MS + 'ms');
  render();
  measure();
})();
