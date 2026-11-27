// AiWait（画面の部品）：AIの返事を待っている間に出す表示
//
// 【このファイルで何が起きているか】
// busy が true の間、マスコットと「AIが考えています… 12秒」を出す。
// 8秒を過ぎたら「サーバーを起こしています」と出す。Render の無料プランは、しばらく使わないとサーバーが寝てしまい、
// 最初の1回だけ30秒ほどかかるため（2回目からは速い）。待っている理由が分かると、使う人が不安にならない
import { useEffect, useState } from "react";
import { Mascot } from "./Mascot";

export function AiWait({ busy, what = "AI処理中" }: { busy: boolean; what?: string }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!busy) { setSec(0); return; }
    const start = Date.now(), t = setInterval(() => setSec(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(t);
  }, [busy]);
  if (!busy) return null;
  return (<div className="aiwait" role="status" aria-live="polite"><Mascot size={44} mood={sec >= 8 ? "sleepy" : "happy"} />
    <div><b>{what}…</b> <span className="mute">{sec}秒</span>
      {sec >= 8 && <div className="mute">応答に時間がかかっています。サーバーが起動中の場合があります。</div>}
      {sec >= 45 && (
        <div className="mute">
          長い内容は数分かかることがあります。
          応答が時間内に届かなかった場合は、
          残りの利用回数を確認してください。
          </div>
        )}
      </div>
      </div>);
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
  return useOnline() ? null : <div className="offline" role="status">オフラインです。ノートは端末に保存できます。同期とAI機能には接続が必要です。</div>;
}
