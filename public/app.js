(function () {
  const $ = (id) => document.getElementById(id);
  const gateForm = $('gate-form'), gateInput = $('gate-input'), gateError = $('gate-error');
  const statusLine = $('status-line');

  let name = localStorage.getItem('toy_name') || '';
  let side = localStorage.getItem('toy_side') || '';
  let config = null;
  let socket = null;

  const SCREENS = ['gate', 'main', 'activities', 'game-wordle', 'game-hunt', 'game-draw', 'profile', 'history', 'gallery', 'music'];
  const GAME_SCREENS = ['game-wordle', 'game-hunt', 'game-draw'];
  // maps a screen id to the activity key broadcast to your partner
  const SCREEN_TO_ACTIVITY = {
    main: 'idle',
    activities: 'activities',
    'game-wordle': 'wordle',
    'game-hunt': 'hunt',
    'game-draw': 'draw',
    profile: 'profile',
    history: 'history',
    gallery: 'gallery',
    music: 'music',
  };
  const ACTIVITY_LABELS = {
    idle: 'the main screen',
    activities: 'Activities',
    wordle: 'Wordle Together',
    hunt: 'Letter Hunt',
    draw: 'Draw Together',
    profile: 'their Profile',
    history: 'Our History',
    gallery: 'the Gallery',
    music: 'Music',
  };
  const gameModules = {};
  let currentScreenId = null;
  let partnerOnline = false;
  const toastEl = $('toast');
  let toastTimer = null;

  // Game modules (wordle.js, hunt.js, draw.js, history.js) register
  // themselves here so app.js can hand them the shared socket/side/name and
  // call enter()/leave() as the user navigates, without those scripts
  // needing their own auth flow.
  window.registerGame = function (id, module) {
    gameModules[id] = module;
  };
  window.App = { socket: null, side: '', name: '', partnerActivity: 'idle', profile: { partnerNickname: 'babe', bear: 'tenderheart-bear' } };

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
  }

  function applyNickname() {
    const nick = window.App.profile.partnerNickname || 'babe';
    document.querySelectorAll('.waiting-nickname').forEach((el) => { el.textContent = nick; });
  }

  function applyBearCursor() {
    const bear = window.App.profile.bear || 'tenderheart-bear';
    document.documentElement.style.setProperty('--cursor-idle', `url('/cursors/${bear}-idle.svg') 8 9, auto`);
    document.documentElement.style.setProperty('--cursor-wave', `url('/cursors/${bear}-hover.svg') 8 9, auto`);
    document.querySelectorAll('.bear-option').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.bear === bear);
    });
  }

  async function loadProfile() {
    try {
      window.App.profile = await apiGet('/api/profile');
    } catch (err) {
      console.warn('[profile] failed to load, using defaults', err);
    }
    applyNickname();
    applyBearCursor();
    renderPartnerLocationPill();
  }

  // The mini-games are co-op and make no sense solo — block them behind a
  // "waiting for partner" overlay until they're specifically in the SAME
  // activity as you, not just connected somewhere else in the app.
  function updateWaitingOverlays() {
    GAME_SCREENS.forEach((id) => {
      const overlay = document.querySelector('#' + id + ' .waiting-overlay');
      const partnerHere = window.App.partnerActivity === SCREEN_TO_ACTIVITY[id];
      if (overlay) overlay.classList.toggle('hidden', partnerHere);
    });
    const stillWaiting = window.App.partnerActivity !== SCREEN_TO_ACTIVITY[currentScreenId];
    if (stillWaiting && GAME_SCREENS.includes(currentScreenId)) {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }
  }

  function renderActivityBadges() {
    document.querySelectorAll('.activity-card').forEach((card) => {
      const badge = card.querySelector('.activity-badge');
      if (badge) badge.classList.toggle('hidden', card.dataset.activity !== window.App.partnerActivity);
    });
  }

  // Persistent, always-visible (while partner is online) indicator of where
  // your partner currently is in the app — not just the Activities screen's
  // per-card badges, which only cover the three co-op games.
  function renderPartnerLocationPill() {
    const pill = $('partner-location-pill');
    if (!pill) return;
    if (!partnerOnline || currentScreenId === 'gate') {
      pill.classList.add('hidden');
      return;
    }
    const myActivity = SCREEN_TO_ACTIVITY[currentScreenId];
    const togetherHere = !!myActivity && myActivity === window.App.partnerActivity;
    pill.classList.remove('hidden');
    pill.classList.toggle('together', togetherHere);
    if (togetherHere) {
      pill.textContent = "💕 you're both here";
    } else {
      const label = ACTIVITY_LABELS[window.App.partnerActivity] || 'somewhere in the app';
      pill.textContent = `💗 ${window.App.profile.partnerNickname || 'they'} is on ${label}`;
    }
  }

  function navigateTo(id) {
    if (currentScreenId && gameModules[currentScreenId] && gameModules[currentScreenId].leave) {
      gameModules[currentScreenId].leave();
    }
    SCREENS.forEach((s) => $(s).classList.add('hidden'));
    $(id).classList.remove('hidden');
    currentScreenId = id;
    if (window.App.socket && SCREEN_TO_ACTIVITY[id]) {
      window.App.socket.emit('activity:update', { activity: SCREEN_TO_ACTIVITY[id] });
    }
    if (GAME_SCREENS.includes(id)) updateWaitingOverlays();
    if (id === 'activities') renderActivityBadges();
    renderPartnerLocationPill();
    if (gameModules[id] && gameModules[id].enter) gameModules[id].enter();
  }

  function show(id) {
    navigateTo(id);
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-auth-name': name },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) throw new Error('request failed: ' + res.status);
    return res.json();
  }

  async function apiGet(path) {
    const res = await fetch(path, { headers: { 'x-auth-name': name } });
    if (!res.ok) throw new Error('request failed: ' + res.status);
    return res.json();
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  async function setupPush() {
    // Verbose, staged logging on purpose: silent push-setup failures are
    // very hard to diagnose remotely, so every step reports what happened.
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[push] unsupported in this browser: serviceWorker/PushManager missing');
      return;
    }
    if (!config || !config.vapidPublicKey) {
      console.warn('[push] no VAPID public key from /api/config — check server .env');
      return;
    }
    console.log('[push] current Notification.permission =', typeof Notification !== 'undefined' ? Notification.permission : 'no Notification API');
    let reg;
    try {
      reg = await navigator.serviceWorker.register('/sw.js');
      console.log('[push] service worker registered, scope =', reg.scope);
    } catch (err) {
      console.error('[push] service worker registration FAILED', err);
      return;
    }
    let permission;
    try {
      permission = await Notification.requestPermission();
      console.log('[push] Notification.requestPermission() resolved:', permission);
    } catch (err) {
      console.error('[push] requestPermission threw', err);
      return;
    }
    if (permission !== 'granted') {
      console.warn(
        permission === 'denied'
          ? '[push] permission is DENIED — the browser will not prompt again until you reset it in site settings (click the icon left of the address bar → Permissions → Notifications → Allow, then reload)'
          : '[push] permission dismissed without a choice — reload and respond to the prompt'
      );
      return;
    }
    try {
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
        });
        console.log('[push] created new push subscription');
      } else {
        console.log('[push] reusing existing push subscription');
      }
      await api('/api/register', { subscription: sub });
      console.log('[push] subscription registered with server ✅');
    } catch (err) {
      console.error('[push] subscribe/register FAILED', err);
    }
  }

  function connectSocket() {
    socket = io({ auth: { name } });
    window.App.socket = socket;
    window.App.side = side;
    window.App.name = name;
    window.App.apiGet = apiGet;
    window.App.apiPost = api;
    window.MusicPlayer.init();

    socket.on('connect_error', () => {
      statusLine.textContent = 'connection failed';
    });

    socket.on('presence', ({ online }) => {
      const otherSide = side === 'blue' ? 'pink' : 'blue';
      partnerOnline = online.includes(otherSide);
      // the partner-location pill already covers "both of you are here" (and
      // where exactly), so this line only needs to speak up for the offline case
      statusLine.textContent = partnerOnline
        ? ''
        : `waiting for ${window.App.profile.partnerNickname} to open the page…`;
      renderPartnerLocationPill();
    });

    socket.on('activity:state', ({ side: otherSide, activity }) => {
      const myOtherSide = side === 'blue' ? 'pink' : 'blue';
      if (otherSide !== myOtherSide) return;
      window.App.partnerActivity = activity;
      updateWaitingOverlays();
      renderActivityBadges();
      renderPartnerLocationPill();
    });

    socket.on('activity:ping', () => {
      showToast(`💌 ${window.App.profile.partnerNickname} wants to play together!`);
      window.SFX.play('ping');
    });

    socket.on('tap', ({ side: tappedSide, xFrac, yFrac }) => {
      const x = typeof xFrac === 'number' ? xFrac * window.innerWidth : null;
      const y = typeof yFrac === 'number' ? yFrac * window.innerHeight : null;
      tryFireFX(tappedSide, x, y);
      window.SFX.play('tap');
    });

    document.body.addEventListener('click', (e) => {
      // unlock the audio context on the very first interaction anywhere in
      // the app, not just heart-screen taps — music/sfx playback later in
      // the session relies on this having happened once
      window.SFX.unlock();
      // heart-tap-anywhere only applies on the heart screen itself, not
      // while browsing activities/games
      if (currentScreenId !== 'main') return;
      // gate first: a burst of rapid/queued taps (yours or theirs) should
      // never stack up and slam the other screen with overlapping heavy
      // animations at once — only one plays per cooldown window, rest drop.
      if (!tryFireFX(side, e.clientX, e.clientY)) return;
      const xFrac = e.clientX / window.innerWidth;
      const yFrac = e.clientY / window.innerHeight;
      // volatile: if we're offline right now, drop the tap instead of
      // queuing it to fire the moment we reconnect.
      socket.volatile.emit('tap', { xFrac, yFrac });
      // sfx plays only for the *other* person's tap (the socket.on('tap',
      // ...) handler above) — not your own, per feedback
    });
  }

  function setupNav() {
    $('activities-btn').addEventListener('click', () => navigateTo('activities'));
    document.querySelectorAll('.back-btn').forEach((btn) => {
      btn.addEventListener('click', () => navigateTo(btn.dataset.back));
    });
    const DIRECT_SCREEN_ACTIVITIES = ['history', 'gallery']; // these screens aren't prefixed with 'game-'
    document.querySelectorAll('.activity-card').forEach((card) => {
      const activity = card.dataset.activity;
      const target = DIRECT_SCREEN_ACTIVITIES.includes(activity) ? activity : 'game-' + activity;
      card.addEventListener('click', () => navigateTo(target));
    });

    $('music-btn').addEventListener('click', () => navigateTo('music'));

    const profileBtn = $('profile-btn');
    const profileForm = $('profile-form');
    const profileNicknameInput = $('profile-nickname');
    const profileSfxToggle = $('profile-sfx-toggle');
    const profileSaved = $('profile-saved');
    let selectedBear = window.App.profile.bear || 'tenderheart-bear';

    document.querySelectorAll('.bear-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedBear = btn.dataset.bear;
        document.querySelectorAll('.bear-option').forEach((b) => b.classList.toggle('active', b === btn));
        // live preview immediately, independent of hitting Save
        document.documentElement.style.setProperty('--cursor-idle', `url('/cursors/${selectedBear}-idle.svg') 8 9, auto`);
        document.documentElement.style.setProperty('--cursor-wave', `url('/cursors/${selectedBear}-hover.svg') 8 9, auto`);
      });
    });

    profileBtn.addEventListener('click', () => {
      profileNicknameInput.value = window.App.profile.partnerNickname || '';
      profileSfxToggle.checked = !window.SFX.isMuted();
      selectedBear = window.App.profile.bear || 'tenderheart-bear';
      applyBearCursor();
      profileSaved.textContent = '';
      navigateTo('profile');
    });
    profileSfxToggle.addEventListener('change', () => {
      window.SFX.setMuted(!profileSfxToggle.checked);
    });
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        window.App.profile = await api('/api/profile', { partnerNickname: profileNicknameInput.value, bear: selectedBear });
        applyNickname();
        applyBearCursor();
        profileSaved.textContent = 'saved 💕';
      } catch (err) {
        profileSaved.style.color = '#ff8080';
        profileSaved.textContent = "couldn't save, try again";
      }
    });
  }

  let lastFxAt = 0;
  const FX_COOLDOWN_MS = 450;

  function tryFireFX(fxSide, flashX, flashY) {
    const now = performance.now();
    if (now - lastFxAt < FX_COOLDOWN_MS) return false;
    lastFxAt = now;
    fireFX(fxSide, flashX, flashY);
    return true;
  }

  function fireFX(fxSide, flashX, flashY) {
    const color = fxSide === 'blue' ? '#4f8fff' : '#ff5fa8';
    const rect = $('heart-wrap').getBoundingClientRect();
    const x = rect.left + rect.width * (fxSide === 'blue' ? 0.3 : 0.7);
    const y = rect.top + rect.height * 0.35;
    window.TapFX.trigger(x, y, color, fxSide);

    const fx = flashX != null ? flashX : window.innerWidth * (fxSide === 'blue' ? 0.25 : 0.75);
    const fy = flashY != null ? flashY : window.innerHeight * 0.5;
    document.body.style.setProperty('--flash-x', (fx / window.innerWidth) * 100 + '%');
    document.body.style.setProperty('--flash-y', (fy / window.innerHeight) * 100 + '%');
    document.body.style.setProperty('--flash-color', color);
    document.body.classList.remove('flashing');
    void document.body.offsetWidth; // restart animation
    document.body.classList.add('flashing');
  }

  gateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    gateError.textContent = '';
    name = gateInput.value;
    try {
      const result = await api('/api/verify', { name });
      side = result.side;
      localStorage.setItem('toy_name', name);
      localStorage.setItem('toy_side', side);
      await enterMain();
    } catch {
      gateError.textContent = "that name isn't recognized";
    }
  });

  async function enterMain() {
    show('main');
    await loadProfile();
    await setupPush();
    connectSocket();
  }

  // Kick things off
  (async function init() {
    setupNav();
    config = await fetch('/api/config').then((r) => r.json());
    window.TapFX.init($('fx-canvas'));
    if (name && side) {
      try {
        await api('/api/verify', { name });
        await enterMain();
      } catch {
        localStorage.removeItem('toy_name');
        localStorage.removeItem('toy_side');
        show('gate');
      }
    } else {
      show('gate');
    }
  })();
})();
