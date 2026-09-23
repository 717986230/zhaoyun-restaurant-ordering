import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { I18nProvider, initialAdminLanguage } from "./app/i18n";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "../../../src/admin.css";

document.documentElement.lang = initialAdminLanguage();

const root = document.getElementById("adminApp");
if (!root) throw new Error("Admin app root was not found");
createRoot(root).render(<StrictMode><I18nProvider><ErrorBoundary><App /></ErrorBoundary></I18nProvider></StrictMode>);
