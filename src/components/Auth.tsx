// G001 ログイン画面 / G002 アカウント登録画面
// ボタンを押したら Controller.handleRequest(画面ID, イベントID) に渡す。中身は AccountManager → NeonAuthClient
import { useState } from "react";
import { Mascot } from "./Mascot";
import { useApp } from "../state/app";
import { controller, type ControllerResult } from "../controller/Controller";
import { NeonAuthClient } from "../boundary/NeonAuthClient";
import type { Screen } from "../types";
import { Header } from "./Shell";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (<div className="app"><Header plain /><div className="authwrap"><div className="card"><div className="authlogo"><Mascot size={84} mood="cheer" /></div><div className="ctitle"><mark>{title}</mark></div><div className="cbody">{children}</div></div></div></div>);
}

/** ボタンを Controller に渡し、結果に応じて画面を移るかエラーを出す。送信中は押せなくする */
function useEvent(screen: Screen) {
  const { enter, nav } = useApp();
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const send = async (eventId: string, params: Record<string, string> = {}) => {
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
    <div className="row c"><button className="btn line" disabled={busy} onClick={onClick}>Google でログイン</button></div></>);
}

export function Login() {
  const [mail, setMail] = useState(""), [pass, setPass] = useState("");
  const { busy, err, setErr, send } = useEvent("G001");
  const login = () => send("login", { mail, pass });
  return (<Card title="ログイン">
    <label>メールアドレス<input type="email" value={mail} onChange={e => { setMail(e.target.value); setErr(""); }} autoComplete="email" /></label>
    <label>パスワード<input type="password" value={pass} onChange={e => { setPass(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && login()} autoComplete="current-password" /></label>
    {err && <div className="err">{err}</div>}
    <div className="row c"><button className="btn dark" disabled={busy} onClick={login}>{busy ? "ログイン中…" : "ログイン"}</button></div>
    <div className="row c"><button className="btn line" disabled={busy} onClick={() => send("frastLoginButton")}>新規登録</button></div>
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
    <div className="row c"><button className="btn dark" disabled={busy} onClick={register}>{busy ? "登録中…" : "登録"}</button></div>
    <GoogleButton busy={busy} onClick={() => send("googleLogin")} />
    <div className="row c"><button className="link" onClick={() => send("back")}>← ログインへ戻る</button></div></Card>);
}