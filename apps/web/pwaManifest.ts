export const pwaManifest = {
  name: "VICAM",
  short_name: "VICAM",
  description: "Gestión comercial operativa",
  lang: "es-EC",
  start_url: "/app",
  scope: "/",
  display: "standalone" as const,
  background_color: "#FFFFFF",
  theme_color: "#0075DE",
  icons: [
    { src: "/icons/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" as const },
    { src: "/icons/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" as const },
    {
      src: "/icons/pwa-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable" as const,
    },
  ],
};
