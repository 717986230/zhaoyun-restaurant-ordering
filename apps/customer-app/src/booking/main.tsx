import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { reportClientErrors } from "@zhaoyun/api-client";
import { apiBaseUrl } from "../app/api";
import { applyColorScheme, storedColorScheme } from "../app/useColorScheme";
import { cachedMenuSettings, cachedMenuTheme } from "../app/useCatalog";
import { applyMenuTheme } from "../app/useMenuTheme";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { BookingPage } from "./BookingPage";
import "../../../../src/styles.css";
import "./booking.css";

const reportError = reportClientErrors("menu", apiBaseUrl);
// A page that scrolls like a page, not the menu's fixed screen (booking.css).
document.documentElement.classList.add("bk-root");
// The menu's light or dark and its 菜单样式, as this phone last saw them: the
// accent's darker shade on a light page, the restaurant's festive colours.
const scheme = storedColorScheme() ?? cachedMenuSettings()?.defaultScheme ?? "dark";
applyColorScheme(scheme);
applyMenuTheme(cachedMenuTheme(), scheme);

const root = document.getElementById("booking");
if (!root) throw new Error("Booking page root was not found");

createRoot(root).render(<StrictMode><ErrorBoundary onError={reportError}><BookingPage /></ErrorBoundary></StrictMode>);
