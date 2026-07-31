import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "../../../src/admin.css";

const root = document.getElementById("adminApp");
if (!root) throw new Error("Admin app root was not found");
createRoot(root).render(<StrictMode><App /></StrictMode>);
