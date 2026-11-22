// AiWait（画面の部品）：AIの返事を待っている間に出す表示
//
// 【このファイルで何が起きているか】
// busy が true の間、マスコットと「AIが考えています… 12秒」を出す。
// 8秒を過ぎたら「サーバーを起こしています」と出す。Render の無料プランは、しばらく使わないとサーバーが寝てしまい、
// 最初の1回だけ30秒ほどかかるため（2回目からは速い）。待っている理由が分かると、使う人が不安にならない
import { useEffect, useState } from "react";
import { Mascot } from "./Mascot";

export function AiWait({ busy, what = "AIが考えています" }: { busy: boolean; what?: string }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!busy) { setSec(0); return; }
    const start = Date.now(), t = setInterval(() => setSec(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(t);
  }, [busy]);
  if (!busy) return null;
  return (<div className="aiwait" role="status" aria-live="polite"><Mascot size={44} mood={sec >= 8 ? "sleepy" : "happy"} />
    <div><b>{what}…</b> <span className="mute">{sec}秒</span>
      {sec >= 8 && <div className="mute">サーバーを起こしています。最初の1回は30秒ほどかかることがあります</div>}
      {sec >= 45 && <div className="mute">もう少し待ってください（長い内容は数分かかることがあります。4分たっても返事がなければ、利用回数を減らさずに止めます）</div>}</div></div>);
}

/** インターネットにつながっているか。つながったり切れたりしたら、画面を描き直す */
export function useOnline(): boolean {
  const [on, setOn] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return on;
}

/** オフラインのときだけ、画面の上に帯を出す */
export function OfflineBar() {
  return useOnline() ? null : <div className="offline" role="status">オフラインです。ノートの保存は端末にでき、つながったら自動でアカウントに送ります（AIは使えません）</div>;
}
