import { useEffect, useState } from "react";
let emit: (m: string) => void = () => {};
export const toast = (m: string) => emit(m);
export function Toast() {
  const [m, setM] = useState(""); const [show, setShow] = useState(false);
  useEffect(() => { let t = 0; emit = x => { setM(x); setShow(true); clearTimeout(t); t = window.setTimeout(() => setShow(false), 1600); }; return () => clearTimeout(t); }, []);
  return <div id="toast" role="status" className={show ? "show" : ""}>{m}</div>;
}
