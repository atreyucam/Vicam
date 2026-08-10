/* global self */

self.addEventListener("push", (event) => {
  const payload = (() => {
    try {
      return event.data ? event.data.json() : {};
    } catch {
      return { body: event.data ? event.data.text() : "" };
    }
  })();
  const title = typeof payload.title === "string" ? payload.title : "VICAM";
  const body =
    typeof payload.body === "string" ? payload.body : "Tienes una actualización pendiente.";
  const resourceUrl =
    typeof payload.url === "string" && payload.url.startsWith("/app")
      ? payload.url
      : "/app/notifications";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { resourceUrl },
      icon: "/icons/pwa-192.png",
      badge: "/icons/pwa-192.png",
      tag: typeof payload.tag === "string" ? payload.tag : undefined,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const resourceUrl = event.notification.data?.resourceUrl || "/app/notifications";
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then((clients) => {
      const existing = clients.find(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      if (existing) {
        existing.navigate(resourceUrl);
        return existing.focus();
      }
      return self.clients.openWindow(resourceUrl);
    }),
  );
});
