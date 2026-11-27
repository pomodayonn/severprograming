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
import { Header } from "./Shell";

/** 11/17：初めて来た人にも「何をするサイトか」が分かるように、ログイン・登録の上に説明を出す */
function About() {
  return (
    <div className="about">
      <p className="lead">授業の資料とノートを、科目ごとにまとめて管理できます。</p>
      <ul>
        <li>授業資料を見ながらノートを取る</li>
        <li>学習項目のつながりを確認する</li>
        <li>AIでノートを整理し、テストで復習する</li>
      </ul>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (<div className="app"><Header plain /><div className="authwrap"><div className="card"><div className="authlogo"><Mascot size={60} mood="cheer" /></div><h1 className="ctitle">{title}</h1><About /><div className="cbody">{children}</div></div></div></div>);
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
    <div className="row c"><span className="mute">初めて利用する方</span><button className="btn line" disabled={busy} onClick={() => send("frastLoginButton")}>新規登録</button></div>
    <GoogleButton busy={busy} onClick={() => send("googleLogin")} /></Card>);
}

export function Register() {
  const [mail, setMail] = useState(""), [pass, setPass] = useState(""), [passConfirm, setPassConfirm] = useState("");
  const { busy, err, setErr, send } = useEvent("G002");
  const register = () => send("frastloginbutton", { mail, pass, passConfirm });
  const clear = (f: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { f(e.target.value); setErr(""); };
  return (<Card title="新規登録">
    <label>メールアドレス<input type="email" value={mail} onChange={clear(setMail)} autoComplete="email" /></label>
    <label>パスワード<input type="password" value={pass} onChange={clear(setPass)} autoComplete="new-password" /></label>
    <label>パスワード（確認）<input type="password" value={passConfirm} onChange={clear(setPassConfirm)} onKeyDown={e => e.key === "Enter" && register()} autoComplete="new-password" /></label>
    <p className="mute hint">8〜16文字の英数字（英字・数字の両方が必要）</p>
    {err && <div className="err">{err}</div>}
    <div className="row c"><button className="btn pri lg wide" disabled={busy} onClick={register}>{busy ? "登録中…" : "登録"}</button></div>
    <GoogleButton busy={busy} onClick={() => send("googleLogin")} />
    <div className="row c"><button className="link" onClick={() => send("back")}>← ログインへ戻る</button></div></Card>);
}