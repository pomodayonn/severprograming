import { useApp } from "./state/app";
import { Login, Register } from "./components/Auth";
import { SubjectList } from "./components/SubjectList";
import { Study } from "./components/Study";
import { MaterialView, TranscriptEdit } from "./components/Material";
import { AiSend } from "./components/AiSend";
import { TestAnswer, TestCreate, TestList, TestResult } from "./components/Tests";
import { Toast } from "./components/toast";

export default function App() {
  const { route, account } = useApp();
  const S = !account ? (route.s === "G002" ? <Register /> : <Login />) : ({
    G001: <SubjectList />, G002: <SubjectList />, G003: <SubjectList />, G004: <Study key={route.subjectId + (route.itemId ?? "")} />, G005: <MaterialView />, G006: <TranscriptEdit />,
    G007: <AiSend key={route.purpose} />, G008: <TestCreate />, G009: <TestAnswer key={`${route.testId}-${route.mode}`} />, G010: <TestResult key={`${route.testId}-${route.mode}`} />, G011: <TestList />,
  } as const)[route.s];
  return <>{S}<Toast /></>;
}
