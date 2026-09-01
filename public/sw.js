// ============================================================
// ChessConnect Push Notification Service Worker
// ============================================================

// Service worker installation
self.addEventListener("install", (event) => {
  console.log("[ChessConnect SW] Installed");

  // Activate immediately
  self.skipWaiting();
});


// Service worker activation
self.addEventListener("activate", (event) => {
  console.log("[ChessConnect SW] Activated");

  // Take control of existing pages immediately
  event.waitUntil(self.clients.claim());
});


// ============================================================
// PUSH NOTIFICATION
// ============================================================

self.addEventListener("push", (event) => {
  console.log("[ChessConnect SW] Push received");

  let data = {
    title: "ChessConnect",
    body: "You have a new notification.",
    icon: "/Black_White_Minimalist_Square_Frame_Fashion_Custom_Tailor_Logo.png",
    badge: "/Black_White_Minimalist_Square_Frame_Fashion_Custom_Tailor_Logo.png",
    url: "/",
    tag: "chessconnect-notification",
    type: "message",
  };

  // Read notification data sent by Supabase
  if (event.data) {
    try {
      const incomingData = event.data.json();

      data = {
        ...data,
        ...incomingData,
      };
    } catch (error) {
      console.error(
        "[ChessConnect SW] Could not read push data:",
        error
      );

      // Try plain text as fallback
      try {
        data.body = event.data.text();
      } catch {
        // Keep default message
      }
    }
  }

  const notificationOptions = {
    body: data.body,

    icon:
      data.icon ||
      "/Black_White_Minimalist_Square_Frame_Fashion_Custom_Tailor_Logo.png",

    badge:
      data.badge ||
      "/Black_White_Minimalist_Square_Frame_Fashion_Custom_Tailor_Logo.png",

    tag: data.tag || "chessconnect-notification",

    renotify: true,

    requireInteraction:
      data.type === "call" ||
      data.type === "video-call",

    data: {
      url: data.url || "/",
      type: data.type || "message",
      chatId: data.chatId || null,
      senderId: data.senderId || null,
    },

    actions:
      data.type === "call" || data.type === "video-call"
        ? [
            {
              action: "open",
              title: "Answer",
            },
            {
              action: "dismiss",
              title: "Decline",
            },
          ]
        : [],
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || "ChessConnect",
      notificationOptions
    )
  );
});


// ============================================================
// NOTIFICATION CLICK
// ============================================================

self.addEventListener("notificationclick", (event) => {
  console.log(
    "[ChessConnect SW] Notification clicked:",
    event.action
  );

  const notification = event.notification;

  const notificationData = notification.data || {};

  const url = notificationData.url || "/";

  // Close notification
  notification.close();

  // If user selected Decline
  if (event.action === "dismiss") {
    return;
  }

  event.waitUntil(
    (async () => {
      // Find an already-open ChessConnect tab
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Try to find an existing ChessConnect window
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();

          // Send information to the React app
          client.postMessage({
            type: "PUSH_NOTIFICATION_CLICK",
            notificationType: notificationData.type,
            chatId: notificationData.chatId,
            senderId: notificationData.senderId,
          });

          return;
        }
      }

      // No ChessConnect tab is open.
      // Open the website.
      if (self.clients.openWindow) {
        await self.clients.openWindow(url);
      }
    })()
  );
});


// ============================================================
// NOTIFICATION CLOSE
// ============================================================

self.addEventListener("notificationclose", (event) => {
  console.log("[ChessConnect SW] Notification closed");
});
