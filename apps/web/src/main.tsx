import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "@vicam/ui/styles.css";
import { App } from "./app/App";
import { SessionProvider } from "./app/session";
import { registerPwaShell } from "./app/pwaUpdate";
import "./app/shell.css";
import { queryClient } from "./api/queryClient";

document.documentElement.lang = "es-EC";
registerPwaShell();

const root = document.getElementById("root");
if (!root) throw new Error("No se encontró el contenedor principal de VICAM.");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
