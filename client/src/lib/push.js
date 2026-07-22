function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// Verbose, staged logging on purpose: silent push-setup failures are very
// hard to diagnose remotely, so every step reports what happened.
export async function setupPush(vapidPublicKey, apiPost) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[push] unsupported in this browser: serviceWorker/PushManager missing');
    return;
  }
  if (!vapidPublicKey) {
    console.warn('[push] no VAPID public key from /api/config — check server .env');
    return;
  }
  console.log(
    '[push] current Notification.permission =',
    typeof Notification !== 'undefined' ? Notification.permission : 'no Notification API'
  );
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
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      console.log('[push] created new push subscription');
    } else {
      console.log('[push] reusing existing push subscription');
    }
    await apiPost('/api/register', { subscription: sub });
    console.log('[push] subscription registered with server ✅');
  } catch (err) {
    console.error('[push] subscribe/register FAILED', err);
  }
}
