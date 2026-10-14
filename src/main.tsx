import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { StoreProvider } from "./state/store";
import "./index.css";

createRoot(document.getElementById("root")!).render(<StrictMode><StoreProvider><App /></StoreProvider></StrictMode>);
// PWA：本番(https)のときだけサービスワーカーを登録
if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register("/sw.js").catch(() => { /* 未対応 */ });
