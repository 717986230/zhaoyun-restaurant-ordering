import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { reportClientErrors } from "@zhaoyun/api-client";
import { api, App } from "./App";
import "../../../src/pos.css";

// A crash on a waiter's tablet reaches the server's log.
reportClientErrors("pos", () => api.baseUrl);

const root = document.getElementById("posApp");
if (!root) throw new Error("POS app root was not found");
createRoot(root).render(<StrictMode><App /></StrictMode>);
