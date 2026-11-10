// G001 ログイン画面 / G002 アカウント登録画面（メールアドレスとパスワード。ログインは Neon Auth に任せる）
import { useState } from "react";
import { Mascot } from "./Mascot";
import { useApp } from "../state/app";
import { auth, DEMO_ACCOUNT, type AuthResult } from "../services/auth";
import { emailOk, passwordOk } from "../lib/logic";
import { Header } from "./Shell";

const nfkc = (s: string) => s.normalize("NFKC").trim(); // 全角英数で打っても同じ文字として扱う
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (<div className="app"><Header plain /><div className="authwrap"><div className="card"><div className="authlogo"><Mascot size={84} mood="cheer" /></div><div className="ctitle"><mark>{title}</mark></div><div className="cbody">{children}</div></div></div></div>);
}
function GoogleButton({ busy }: { busy: boolean }) {
  if (!auth.neon) return null; // お試しログインでは出さない
  return (<><div className="or"><span>または</span></div>
    <div className="row c"><button className="btn line" disabled={busy} onClick={() => void auth.signInWithGoogle()}>Google でログイン</button></div></>);
}
/** 送信中はボタンを押せなくし、結果に応じて画面を進めるかエラーを出す */
function useSubmit(onOk: (r: Extract<AuthResult, { ok: true }>) => void) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const run = async (f: () => Promise<AuthResult | string>) => {
    if (busy) return; setErr(""); setBusy(true);
    const r = await f(); setBusy(false);
    if (typeof r === "string") setErr(r); else if (!r.ok) setErr(r.error); else onOk(r);
  };
  return { busy, err, setErr, run };
}

export function Login() {
  const { enter, nav } = useApp();
  const [email, setEmail] = useState(""), [pw, setPw] = useState("");
  const { busy, err, setErr, run } = useSubmit(r => enter(r.student));
  const submit = () => run(async () => {
    if (!nfkc(email) || !pw) return "入力されていない項目があります";
    return auth.signIn(nfkc(email).toLowerCase(), nfkc(pw));
  });
  return (<Card title="ログイン">
    <label>メールアドレス<input type="email" value={email} onChange={e => { setEmail(e.target.value); setErr(""); }} autoComplete="email" /></label>
    <label>パスワード<input type="password" value={pw} onChange={e => { setPw(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && submit()} autoComplete="current-password" /></label>
    {err && <div className="err">{err}</div>}
    <div className="row c"><button className="btn dark" disabled={busy} onClick={submit}>{busy ? "ログイン中…" : "ログイン"}</button></div>
    <div className="row c"><button className="btn line" disabled={busy} onClick={() => nav({ s: "G002" })}>新規登録</button></div>
    <GoogleButton busy={busy} />
    {!auth.neon && <p className="mute hint">お試しモード（端末の中だけで動きます）：<b>{DEMO_ACCOUNT.email}</b> ／ <b>{DEMO_ACCOUNT.password}</b></p>}</Card>);
}

export function Register() {
  const { enter, nav } = useApp();
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [pw2, setPw2] = useState("");
  const { busy, err, setErr, run } = useSubmit(r => enter(r.student));
  const submit = () => run(async () => {
    const m = nfkc(email).toLowerCase(), p = nfkc(pw);
    if (!m || !pw || !pw2) return "入力されていない項目があります";
    if (!emailOk(m)) return "メールアドレスの形が正しくありません";
    if (!passwordOk(p)) return "パスワードは8〜16文字で、英字と数字の両方を含めてください";
    if (p !== nfkc(pw2)) return "パスワードが一致しません";
    return auth.signUp(m, p);
  });
  const clear = (f: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { f(e.target.value); setErr(""); };
  return (<Card title="新規登録">
    <label>メールアドレス<input type="email" value={email} onChange={clear(setEmail)} autoComplete="email" /></label>
    <label>パスワード<input type="password" value={pw} onChange={clear(setPw)} autoComplete="new-password" /></label>
    <label>パスワード　再入力<input type="password" value={pw2} onChange={clear(setPw2)} onKeyDown={e => e.key === "Enter" && submit()} autoComplete="new-password" /></label>
    <p className="mute hint">パスワードは8〜16文字で、英字と数字を両方入れてください</p>
    {err && <div className="err">{err}</div>}
    <div className="row c"><button className="btn dark" disabled={busy} onClick={submit}>{busy ? "登録中…" : "登録"}</button></div>
    <GoogleButton busy={busy} />
    <div className="row c"><button className="link" onClick={() => nav({ s: "G001" })}>← ログインへ戻る</button></div></Card>);
}