const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);

  const base64 = (
    base64String +
    padding
  )
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);

  return Uint8Array.from(
    [...rawData].map((char) => char.charCodeAt(0))
  );
}

export async function enablePushNotifications(
  userId: string
) {
  try {
    if (!("serviceWorker" in navigator)) {
      throw new Error(
        "Push notifications are not supported by this browser."
      );
    }

    if (!("PushManager" in window)) {
      throw new Error(
        "Push notifications are not supported by this browser."
      );
    }

    if (!VAPID_PUBLIC_KEY) {
      throw new Error(
        "Push notification configuration is missing."
      );
    }

    // Ask the browser for permission
    const permission =
      await Notification.requestPermission();

    if (permission !== "granted") {
      throw new Error(
        "Notification permission was not granted."
      );
    }

    // Get our ChessConnect service worker
    const registration =
      await navigator.serviceWorker.ready;

    // Check if this device already has a subscription
    let subscription =
      await registration.pushManager.getSubscription();

    // Create subscription if necessary
    if (!subscription) {
      subscription =
        await registration.pushManager.subscribe({
          userVisibleOnly: true,

          applicationServerKey:
            urlBase64ToUint8Array(
              VAPID_PUBLIC_KEY
            ),
        });
    }

    const subscriptionJson =
      subscription.toJSON();

    if (
      !subscriptionJson.endpoint ||
      !subscriptionJson.keys?.p256dh ||
      !subscriptionJson.keys?.auth
    ) {
      throw new Error(
        "Could not create a valid push subscription."
      );
    }

    // Detect device
    const userAgent =
      navigator.userAgent.toLowerCase();

    let deviceType = "desktop";

    if (
      /android|iphone|ipad|ipod/.test(
        userAgent
      )
    ) {
      deviceType = "mobile";
    }

    // Save subscription in Supabase
    const { supabase } =
      await import("./supabase");

    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: userId,
          endpoint:
            subscriptionJson.endpoint,
          p256dh:
            subscriptionJson.keys.p256dh,
          auth:
            subscriptionJson.keys.auth,
          device_type: deviceType,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict:
            "user_id,endpoint",
        }
      );

    if (error) {
      console.error(
        "[ChessConnect] Could not save push subscription:",
        error
      );

      throw new Error(
        "Could not save notification settings."
      );
    }

    console.log(
      "[ChessConnect] Push notifications enabled."
    );

    return {
      success: true,
      deviceType,
    };
  } catch (error) {
    console.error(
      "[ChessConnect] Push setup failed:",
      error
    );

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not enable notifications.",
    };
  }
}
