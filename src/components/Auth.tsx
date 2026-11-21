// G001 ログイン画面 / G002 アカウント登録画面
// ボタンを押したら Controller.handleRequest(画面ID, イベントID) に渡す。中身は AccountManager → NeonAuthClient
//
// 【このファイルで何が起きているか】
// ログイン画面（G001）と登録画面（G002）です。
// 1. メールとパスワードを入れてボタンを押す
// 2. useEvent の send が Controller に渡す（例：G001:login）
// 3. Controller → AccountManager → NeonAuthClient → Neon Auth の順に進む
// 4. 成功：enter(学生) で科目一覧（G003）へ／失敗：r.error の文を赤字で出す
// 「Google でログイン」は Google のページに移動し、ログインすると戻ってくる（戻ったら app.tsx が気づく）
import { useState } from "react";
import { Mascot } from "./Mascot";
import { useApp } from "../state/app";
import { controller, type ControllerResult, type EventOf, type ParamsOf } from "../controller/Controller";
import { NeonAuthClient } from "../boundary/NeonAuthClient";
import { Header } from "./Shell";

/** 11/17：初めて来た人にも「何をするサイトか」が分かるように、ログイン・登録の上に説明を出す */
function About() {
  return (<div className="about"><p className="lead">講義の資料とノートを1か所にまとめて、<br />AIで整理し、模擬テストで確かめられる学習ノートです</p>
    <ul><li><i>📝</i>科目・学習項目ごとにノートを作り、資料と並べて書ける</li>
      <li><i>✦</i>資料やノートをAIが枠ごとに整理して、まとめを提案</li>
      <li><i>✅</i>単語テスト・記述テストを作って、解き直しもできる</li></ul></div>);
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (<div className="app"><Header plain /><div className="authwrap"><div className="card"><div className="authlogo"><Mascot size={84} mood="cheer" /></div><About /><div className="ctitle"><mark>{title}</mark></div><div className="cbody">{children}</div></div></div></div>);
}

/** ボタンを Controller に渡し、結果に応じて画面を移るかエラーを出す。送信中は押せなくする */
function useEvent<S extends "G001" | "G002">(screen: S) {
  const { enter, nav } = useApp();
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const send = async <E extends EventOf<S>>(eventId: E, params?: ParamsOf<S, E>) => {
    if (busy) return; setErr(""); setBusy(true);
    const r: ControllerResult = await controller.handleRequest(screen, eventId, params); setBusy(false);
    if (r.error) return setErr(r.error);
    if (r.student) enter(r.student); else if (r.next) nav({ s: r.next });
  };
  return { busy, err, setErr, send };
}

function GoogleButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  if (controller.accountManager.isTrial) return null; // お試しログインでは出さない
  return (<><div className="or"><span>または</span></div>
    <div className="row c"><button className="btn wide" disabled={busy} onClick={onClick}>Google でログイン</button></div></>);
}

export function Login() {
  const [mail, setMail] = useState(""), [pass, setPass] = useState("");
  const { busy, err, setErr, send } = useEvent("G001");
  const login = () => send("login", { mail, pass });
  return (<Card title="ログイン">
    <label>メールアドレス<input type="email" value={mail} onChange={e => { setMail(e.target.value); setErr(""); }} autoComplete="email" /></label>
    <label>パスワード<input type="password" value={pass} onChange={e => { setPass(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && login()} autoComplete="current-password" /></label>
    {err && <div className="err">{err}</div>}
    <div className="row c"><button className="btn pri lg wide" disabled={busy} onClick={login}>{busy ? "ログイン中…" : "ログイン"}</button></div>
    <div className="row c"><span className="mute">はじめての人は</span><button className="btn line" disabled={busy} onClick={() => send("frastLoginButton")}>新規登録</button></div>
    <GoogleButton busy={busy} onClick={() => send("googleLogin")} />
    {controller.accountManager.isTrial && <p className="mute hint">お試しモード（端末の中だけで動きます）：<b>{NeonAuthClient.DEMO.email}</b> ／ <b>{NeonAuthClient.DEMO.password}</b></p>}</Card>);
}

export function Register() {
  const [mail, setMail] = useState(""), [pass, setPass] = useState(""), [passConfirm, setPassConfirm] = useState("");
  const { busy, err, setErr, send } = useEvent("G002");
  const register = () => send("frastloginbutton", { mail, pass, passConfirm });
  const clear = (f: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { f(e.target.value); setErr(""); };
  return (<Card title="新規登録">
    <label>メールアドレス<input type="email" value={mail} onChange={clear(setMail)} autoComplete="email" /></label>
    <label>パスワード<input type="password" value={pass} onChange={clear(setPass)} autoComplete="new-password" /></label>
    <label>パスワード　再入力<input type="password" value={passConfirm} onChange={clear(setPassConfirm)} onKeyDown={e => e.key === "Enter" && register()} autoComplete="new-password" /></label>
    <p className="mute hint">パスワードは8〜16文字で、英字と数字を両方入れてください</p>
    {err && <div className="err">{err}</div>}
    <div className="row c"><button className="btn pri lg wide" disabled={busy} onClick={register}>{busy ? "登録中…" : "登録"}</button></div>
    <GoogleButton busy={busy} onClick={() => send("googleLogin")} />
    <div className="row c"><button className="link" onClick={() => send("back")}>← ログインへ戻る</button></div></Card>);
}