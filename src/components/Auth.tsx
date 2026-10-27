// G001 ログイン画面 / G002 アカウント登録画面
import { useEffect, useState } from "react";
import { Mascot } from "./Mascot";
import { useApp } from "../state/app";
import { accounts, saveAccounts, sha } from "../services/db";
import { loginIdOk, passwordOk, uid } from "../lib/logic";
import { Header } from "./Shell";

const nfkc = (s: string) => s.normalize("NFKC").trim(); // 全角英数で打っても同じ文字として扱う
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (<div className="app"><Header plain /><div className="authwrap"><div className="card"><div className="authlogo"><Mascot size={84} mood="cheer" /></div><div className="ctitle"><mark>{title}</mark></div><div className="cbody">{children}</div></div></div></div>);
}
const DEMO = { id: "demo-user", pw: "demo1234" };
export function Login() {
  const { enter, nav } = useApp();
  const [id, setId] = useState(""), [pw, setPw] = useState(""), [err, setErr] = useState("");
  useEffect(() => { (async () => { if (!accounts().some(x => x.loginId === DEMO.id)) saveAccounts([...accounts(), { id: "demo", loginId: DEMO.id, pass: await sha(DEMO.pw) }]); })(); }, []); // お試し用のアカウント
  const submit = async () => {
    if (!nfkc(id) || !pw) return setErr("入力されていない項目があります");
    const h = await sha(nfkc(pw)), a = accounts().find(x => x.loginId === nfkc(id) && x.pass === h);
    if (!a) return setErr("ログインIDまたはパスワードが違います"); // どちらが違うかは示さない
    enter(a);
  };
  return (<Card title="ログイン">
    <label>ログインID<input value={id} onChange={e => { setId(e.target.value); setErr(""); }} autoComplete="username" /></label>
    <label>パスワード<input type="password" value={pw} onChange={e => { setPw(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && submit()} autoComplete="current-password" /></label>
    {err && <div className="err">{err}</div>}
    <div className="row c"><button className="btn dark" onClick={submit}>ログイン</button></div>
    <div className="row c"><button className="btn line" onClick={() => nav({ s: "G002" })}>新規登録</button></div>
    <p className="mute hint">はじめての人は「新規登録」から。お試し用：ID <b>{DEMO.id}</b> ／ パスワード <b>{DEMO.pw}</b></p></Card>);
}
export function Register() {
  const { enter, nav } = useApp();
  const [id, setId] = useState(""), [pw, setPw] = useState(""), [pw2, setPw2] = useState(""), [err, setErr] = useState("");
  const submit = async () => {
    if (!nfkc(id) || !pw || !pw2) return setErr("入力されていない項目があります");
    if (!loginIdOk(nfkc(id))) return setErr("ログインIDは半角英数字（- _ も可）の8〜16文字で入力してください");
    if (!passwordOk(nfkc(pw))) return setErr("パスワードは8〜16文字で、英字と数字の両方を含めてください");
    if (nfkc(pw) !== nfkc(pw2)) return setErr("パスワードが一致しません");
    const list = accounts(); if (list.some(x => x.loginId === nfkc(id))) return setErr("このログインIDは登録できません");
    const a = { id: uid(), loginId: nfkc(id), pass: await sha(nfkc(pw)) }; saveAccounts([...list, a]); enter(a);
  };
  return (<Card title="新規登録">
    <label>新規ログインID<input value={id} onChange={e => { setId(e.target.value); setErr(""); }} autoComplete="username" /></label>
    <label>パスワード<input type="password" value={pw} onChange={e => { setPw(e.target.value); setErr(""); }} autoComplete="new-password" /></label>
    <label>パスワード　再入力<input type="password" value={pw2} onChange={e => { setPw2(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && submit()} autoComplete="new-password" /></label>
    {err && <div className="err">{err}</div>}
    <div className="row c"><button className="btn dark" onClick={submit}>登録</button></div>
    <div className="row c"><button className="link" onClick={() => nav({ s: "G001" })}>← ログインへ戻る</button></div></Card>);
}
