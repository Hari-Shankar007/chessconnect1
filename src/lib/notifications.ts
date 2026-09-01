let permissionRequested = false;

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;

  if (Notification.permission === "granted") return true;

  if (Notification.permission === "denied") return false;

  if (!permissionRequested) {
    permissionRequested = true;

    const result = await Notification.requestPermission();

    return result === "granted";
  }

  return false;
}

export async function registerPushNotifications(): Promise<PushSubscription | null> {
  try {
    if (!("serviceWorker" in navigator)) {
      console.log("Service workers are not supported");
      return null;
    }

    if (!("PushManager" in window)) {
      console.log("Push notifications are not supported");
      return null;
    }

    const permissionGranted = await ensureNotificationPermission();

    if (!permissionGranted) {
      console.log("Notification permission was not granted");
      return null;
    }

    if (!VAPID_PUBLIC_KEY) {
      console.error("VITE_VAPID_PUBLIC_KEY is missing");
      return null;
    }

    const registration = await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    console.log("Push notification subscription created");

    return subscription;
  } catch (error) {
    console.error("Failed to register push notifications:", error);
    return null;
  }
}

export function showBrowserNotification(
  title: string,
  body: string,
  onClick?: () => void
): void {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  const notif = new Notification(title, {
    body,
    icon: "/Black_White_Minimalist_Square_Frame_Fashion_Custom_Tailor_Logo.png",
    tag: "educhess-message",
  });

  if (onClick) {
    notif.onclick = () => {
      window.focus();
      onClick();
      notif.close();
    };
  }
}

export function playNotificationSound(): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as {
        webkitAudioContext: typeof AudioContext;
      }).webkitAudioContext;

    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.frequency.value = 880;
    osc.type = "sine";

    gain.gain.setValueAtTime(0.3, ctx.currentTime);

    gain.gain.exponentialRampToValueAtTime(
      0.01,
      ctx.currentTime + 0.5
    );

    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    // AudioContext not available or not allowed
  }
}
