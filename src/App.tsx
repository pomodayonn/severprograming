import { lazy, Suspense, useEffect } from "react";
import { useApp } from "./state/app";
import { Login, Register } from "./components/Auth";
import { SubjectList } from "./components/SubjectList";
import { Toast } from "./components/toast";

// ログイン後の画面は、開いたときに読み込む（最初に読むファイルを小さくする）
const Study = lazy(() => import("./components/Study").then(m => ({ default: m.Study })));
const material = () => import("./components/Material");
const MaterialView = lazy(() => material().then(m => ({ default: m.MaterialView })));
const TranscriptEdit = lazy(() => material().then(m => ({ default: m.TranscriptEdit })));
const AiSend = lazy(() => import("./components/AiSend").then(m => ({ default: m.AiSend })));
const tests = () => import("./components/Tests");
const TestCreate = lazy(() => tests().then(m => ({ default: m.TestCreate })));
const TestAnswer = lazy(() => tests().then(m => ({ default: m.TestAnswer })));
const TestResult = lazy(() => tests().then(m => ({ default: m.TestResult })));
const TestList = lazy(() => tests().then(m => ({ default: m.TestList })));

const Loading = () => <div className="app"><div className="authwrap"><p className="mute">読み込み中…</p></div></div>;

function Screen() {
  const { route, account } = useApp();
  if (!account) return route.s === "G002" ? <Register /> : <Login />;
  switch (route.s) {
    case "G004": return <Study key={route.subjectId + (route.itemId ?? "")} />;
    case "G005": return <MaterialView />;
    case "G006": return <TranscriptEdit />;
    case "G007": return <AiSend key={route.purpose} />;
    case "G008": return <TestCreate />;
    case "G009": return <TestAnswer key={`${route.testId}-${route.mode}`} />;
    case "G010": return <TestResult key={`${route.testId}-${route.mode}`} />;
    case "G011": return <TestList />;
    default: return <SubjectList />; // G001〜G003
  }
}

export default function App() {
  const { ready, account } = useApp();
  useEffect(() => { if (account) void import("./components/Study"); }, [account]); // ログインしたら、次に開く学習画面を先に読んでおく
  if (!ready) return <Loading />; // ログイン状態の確認中
  return <><Suspense fallback={<Loading />}><Screen /></Suspense><Toast /></>;
}
