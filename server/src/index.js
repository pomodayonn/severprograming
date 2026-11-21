import express from "express";
import cors from "cors"; //CORSの部品を読み込む
import { TokenVerifier } from "./service/TokenVerifier.js";
import { ApiController, sendError } from "./controller/ApiController.js";
import { AiUsageDAO } from "./dao/AiUsageDAO.js";
import { AiUsageManager } from "./managers/AiUsageManager.js";
import { AiService } from "./boundary/AiService.js";
import { defaultProviders } from "./boundary/AiProvider.js";

const app = express();

//許可するフロントの URL（来客名簿）
//.envのFRONT_ORIGIN を読む。カンマ区切りで複数書ける。なければ開発用の localhost:5173
const allowed = (process.env.FRONT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim());

//名簿に載っているURLからのアクセスだけを許可する
app.use(cors({ origin: allowed }));

//JSON を読む。1万文字×20回分の日本語が入るように、上限を 1MB にする（ふつうは 100KB）
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

//部品を組み立てる（DAO → Manager、Provider → Service、それらを Controller に渡す）
const aiUsageManager = new AiUsageManager(new AiUsageDAO());
const aiService = new AiService(defaultProviders());
const tokenVerifier = new TokenVerifier(process.env.NEON_AUTH_JWKS_URL, process.env.NEON_AUTH_URL);

//入口の係（ApiController）を作り、URL ごとに担当のメソッドへつなぐ
const api = new ApiController(tokenVerifier, aiUsageManager, aiService);
app.get("/api/remaining", (req, res) => api.getRemaining(req, res));
app.post("/api/organize", (req, res) => api.organize(req, res));
app.post("/api/essay-test", (req, res) => api.makeEssayTest(req, res));
app.post("/api/explain", (req, res) => api.explain(req, res));
app.post("/api/regenerate-question", (req, res) => api.regenerateQuestion(req, res));

//ない URL
app.use((req, res) => sendError(res, 404, "NOT_FOUND"));

//ここまでで拾えなかったエラー（JSON の形が壊れている・大きすぎる、など）
app.use((err, req, res, next) => {
  if (err?.type === "entity.parse.failed") return sendError(res, 400, "BAD_REQUEST", "JSON の形が壊れています");
  if (err?.type === "entity.too.large") return sendError(res, 413, "TOO_LONG", "送る内容が大きすぎます");
  console.error("[API] 思いがけないエラー:", err);
  sendError(res, 500, "SERVER");
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`server: http://localhost:${port}`));