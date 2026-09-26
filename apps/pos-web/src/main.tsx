import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "../../../src/pos.css";

const root = document.getElementById("posApp");
if (!root) throw new Error("POS app root was not found");
createRoot(root).render(<StrictMode><App /></StrictMode>);
