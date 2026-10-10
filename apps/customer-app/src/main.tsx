import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { markPlatform } from "@zhaoyun/native-bridge";
import { reportClientErrors } from "@zhaoyun/api-client";
import { apiBaseUrl } from "./app/api";
import { App } from "./app/App";
import { applyColorScheme, storedColorScheme } from "./app/useColorScheme";
import { cachedMenuSettings } from "./app/useCatalog";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "../../../src/styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
    mutations: { retry: 0 }
  }
});

const platform = markPlatform();
// The menu opens without a signal too (public/sw.js). Not in the tablet app,
// which carries its files with it, nor on the dev server, whose files change under it.
if (platform === "web" && import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}); });
}
// A crash on a guest's phone reaches the server's log, not only the phone.
const reportError = reportClientErrors("menu", apiBaseUrl);
// Before the first render, so a guest who picked light never sees a dark flash.
applyColorScheme(storedColorScheme() ?? cachedMenuSettings()?.defaultScheme ?? "dark");

const root = document.getElementById("app");
if (!root) throw new Error("Customer app root was not found");

createRoot(root).render(<StrictMode><ErrorBoundary onError={reportError}><QueryClientProvider client={queryClient}><App /></QueryClientProvider></ErrorBoundary></StrictMode>);
