
// ============================================================
// ChessConnect Push Notification Service Worker
// ============================================================

// ============================================================
// INSTALL
// ============================================================

self.addEventListener("install", (event) => {
  console.log("[ChessConnect SW] Installed");

  // Activate immediately instead of waiting for old SW to finish
  event.waitUntil(self.skipWaiting());
});


// ============================================================
// ACTIVATE
// ============================================================

self.addEventListener("activate", (event) => {
  console.log("[ChessConnect SW] Activated");

  // Take control of existing ChessConnect pages immediately
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
    chatId: null,
    senderId: null,
  };

  // Read data sent by the push server / Supabase Edge Function
  if (event.data) {
    try {
      const incomingData = event.data.json();

      data = {
        ...data,
        ...incomingData,
      };
    } catch (error) {
      console.error(
        "[ChessConnect SW] Could not read push JSON:",
        error
      );

      // Fallback to plain text
      try {
        data.body = event.data.text();
      } catch {
        // Keep default notification
      }
    }
  }

  const isCall =
    data.type === "call" ||
    data.type === "video-call";

  const notificationOptions = {
    body: data.body || "You have a new notification.",

    icon:
      data.icon ||
      "/Black_White_Minimalist_Square_Frame_Fashion_Custom_Tailor_Logo.png",

    badge:
      data.badge ||
      "/Black_White_Minimalist_Square_Frame_Fashion_Custom_Tailor_Logo.png",

    tag: data.tag || "chessconnect-notification",

    // Allow another notification with the same tag to alert again
    renotify: true,

    // Calls stay visible until the user interacts with them
    requireInteraction: isCall,

    // Store information so notificationclick can use it
    data: {
      url: data.url || "/",
      type: data.type || "message",
      chatId: data.chatId || null,
      senderId: data.senderId || null,
    },

    // Call notifications get action buttons
    actions: isCall
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

  // Close notification immediately
  notification.close();

  // ----------------------------------------------------------
  // DECLINE
  // ----------------------------------------------------------

  if (event.action === "dismiss") {
    console.log("[ChessConnect SW] Notification dismissed");
    return;
  }

  // ----------------------------------------------------------
  // OPEN / ANSWER
  // ----------------------------------------------------------

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Try to use an existing ChessConnect tab
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();

          // Tell the React application what notification was clicked
          client.postMessage({
            type: "PUSH_NOTIFICATION_CLICK",
            notificationType: notificationData.type,
            chatId: notificationData.chatId,
            senderId: notificationData.senderId,
            action: event.action || "open",
          });

          return;
        }
      }

      // --------------------------------------------------------
      // No ChessConnect tab exists
      // Open ChessConnect
      // --------------------------------------------------------

      if (self.clients.openWindow) {
        await self.clients.openWindow(url);
      }
    })()
  );
});


// ============================================================
// NOTIFICATION CLOSE
// ============================================================

self.addEventListener("notificationclose", () => {
  console.log("[ChessConnect SW] Notification closed");
});

