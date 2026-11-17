import express from "express";
import cors from "cors"; //CORSの部品を読み込む
import { TokenVerifier } from "./service/TokenVerifier.js";
import { ApiController } from "./controller/ApiController.js";

const app = express();

//許可するフロントの URL（来客名簿）
//.envのFRONT_ORIGIN を読む。カンマ区切りで複数書ける。なければ開発用の localhost:5173
const allowed = (process.env.FRONT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim());

//名簿に載っているURLからのアクセスだけを許可する
app.use(cors({ origin: allowed }));

app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

//入口の係（ApiController）を作り、URL ごとに担当のメソッドへつなぐ
const api = new ApiController(new TokenVerifier(process.env.NEON_AUTH_JWKS_URL));
app.get("/api/remaining", (req, res) => api.getRemaining(req, res));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`server: http://localhost:${port}`));