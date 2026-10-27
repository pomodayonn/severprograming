import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppProvider } from "./state/app";
import "./index.css";

createRoot(document.getElementById("root")!).render(<StrictMode><AppProvider><App /></AppProvider></StrictMode>);
// PWA：本番(https)のときだけサビワーカーを登録
if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register("/sw.js").catch(() => { /* 未対応 */ });
