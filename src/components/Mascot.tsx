// マスコット「るん」（オリジナル：カピバラ＋みかん）
export type Mood = "happy" | "cheer" | "worried" | "sleepy";
function inner(mood: Mood): string {
  const K = "#2a2740", O = "#f2a43a", B = "#cfa57a", B2 = "#b98a5e";
  const sk = (w = 3) => `stroke="${K}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
  const line = (d: string) => `<path d="${d}" fill="none" ${sk()}/>`;
  const el = (cx: number, cy: number, rx: number, ry: number, f: string) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${f}" ${sk()}/>`;
  const cir = (cx: number, cy: number, r: number, f: string) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${f}" ${sk()}/>`;
  const eyes = mood === "cheer" ? line("M33 53q5-7 10 0M57 53q5-7 10 0") : mood === "sleepy" ? line("M33 52q5 5 10 0M57 52q5 5 10 0")
    : `<circle cx="38" cy="52" r="3.6" fill="${K}"/><circle cx="62" cy="52" r="3.6" fill="${K}"/><circle cx="39.2" cy="50.8" r="1.1" fill="#fff"/><circle cx="63.2" cy="50.8" r="1.1" fill="#fff"/>`;
  const extra = mood === "worried" ? line("M31 43l10 4M69 43l-10 4") + `<path d="M80 34q5 7 0 11q-5-4 0-11z" fill="#8ec9e8"/>`
    : mood === "sleepy" ? `<text x="78" y="34" font-size="13" font-weight="700" fill="#7a7690">z</text>`
    : mood === "cheer" ? `<path d="M8 32l6 3M16 18l4 5M92 32l-6 3" stroke="${O}" stroke-width="3" stroke-linecap="round"/>` : "";
  return cir(29, 33, 6, B2) + cir(71, 33, 6, B2) + el(38, 90, 7, 3.5, B2) + el(62, 90, 7, 3.5, B2) + el(50, 60, 38, 29, B) +
    `<ellipse cx="29" cy="62" rx="5.5" ry="3.4" fill="#ff9fb0" opacity=".65"/><ellipse cx="71" cy="62" rx="5.5" ry="3.4" fill="#ff9fb0" opacity=".65"/>` + eyes +
    `<ellipse cx="50" cy="65" rx="16" ry="10" fill="#dcb88f"/><ellipse cx="50" cy="60" rx="8" ry="4.5" fill="#5a4030"/>` + line("M45 69q5 3 10 0") +
    `<circle cx="50" cy="26" r="7" fill="${O}" ${sk(2.4)}/><path d="M50 19q3-5 7-3" fill="none" stroke="#3f8f6b" stroke-width="2.6" stroke-linecap="round"/>` +
    `<g transform="rotate(32 86 66)"><rect x="83" y="50" width="6" height="26" rx="1.5" fill="#cf3f5b" ${sk(2.4)}/><path d="M83 76h6l-3 6z" fill="#f3e8d2" ${sk(2)}/></g>` + extra;
}
export function Mascot({ mood = "happy", size = 64 }: { mood?: Mood; size?: number }) {
  return <svg className="mas" viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="るん" dangerouslySetInnerHTML={{ __html: inner(mood) }} />;
}
