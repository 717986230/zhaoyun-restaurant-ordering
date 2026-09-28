import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { reportClientErrors } from "@zhaoyun/api-client";
import { apiBaseUrl } from "../app/api";
import { applyColorScheme, storedColorScheme } from "../app/useColorScheme";
import { cachedMenuSettings } from "../app/useCatalog";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { BookingPage } from "./BookingPage";
import "../../../../src/styles.css";
import "./booking.css";

const reportError = reportClientErrors("menu", apiBaseUrl);
// A page that scrolls like a page, not the menu's fixed screen (booking.css).
document.documentElement.classList.add("bk-root");
// The menu's light or dark, as this phone last saw it.
applyColorScheme(storedColorScheme() ?? cachedMenuSettings()?.defaultScheme ?? "dark");

const root = document.getElementById("booking");
if (!root) throw new Error("Booking page root was not found");

createRoot(root).render(<StrictMode><ErrorBoundary onError={reportError}><BookingPage /></ErrorBoundary></StrictMode>);
