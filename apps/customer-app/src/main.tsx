import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { markPlatform } from "@zhaoyun/native-bridge";
import { App } from "./app/App";
import { applyColorScheme, storedColorScheme } from "./app/useColorScheme";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "../../../src/styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
    mutations: { retry: 0 }
  }
});

markPlatform();
// Before the first render, so a guest who picked light never sees a dark flash.
applyColorScheme(storedColorScheme());

const root = document.getElementById("app");
if (!root) throw new Error("Customer app root was not found");

createRoot(root).render(<StrictMode><ErrorBoundary><QueryClientProvider client={queryClient}><App /></QueryClientProvider></ErrorBoundary></StrictMode>);
