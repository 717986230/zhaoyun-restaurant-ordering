import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminApi, reportClientErrors } from "@zhaoyun/api-client";
import { App } from "./app/App";
import { I18nProvider, initialAdminLanguage } from "./app/i18n";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "../../../src/admin.css";

document.documentElement.lang = initialAdminLanguage();
// A crash in the console reaches the server's log; the address is whatever the console is connected to.
const connection = new AdminApi();
const reportError = reportClientErrors("admin", () => connection.storage.baseUrl);

const root = document.getElementById("adminApp");
if (!root) throw new Error("Admin app root was not found");
createRoot(root).render(<StrictMode><I18nProvider><ErrorBoundary onError={reportError}><App /></ErrorBoundary></I18nProvider></StrictMode>);
