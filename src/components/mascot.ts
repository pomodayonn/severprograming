// マスコット「るん」（ことり）：まんまるの体、ほっぺ、くちばし、頭の毛、頭にさした鉛筆
export type Mood = "happy" | "cheer" | "worried" | "sleepy";
export function birdInner(mood: Mood): string {
  const K = "#2a2740", W = "#fffdf8", O = "#f2a43a", up = mood === "cheer";
  const wing = (x: number, y: number, r: number) => `<ellipse cx="${x}" cy="${y}" rx="8" ry="13" transform="rotate(${r} ${x} ${y})" fill="#f3e8d2" stroke="${K}" stroke-width="3"/>`;
  const line = (d: string) => `<path d="${d}" fill="none" stroke="${K}" stroke-width="3" stroke-linecap="round"/>`;
  const eyes = mood === "cheer" ? line("M33 53q5-7 10 0M57 53q5-7 10 0") : mood === "sleepy" ? line("M33 52q5 5 10 0M57 52q5 5 10 0")
    : `<circle cx="38" cy="52" r="3.6" fill="${K}"/><circle cx="62" cy="52" r="3.6" fill="${K}"/><circle cx="39.2" cy="50.8" r="1.1" fill="#fff"/><circle cx="63.2" cy="50.8" r="1.1" fill="#fff"/>`;
  const extra = mood === "worried" ? line("M31 43l10 4M69 43l-10 4") + `<path d="M80 34q5 7 0 11q-5-4 0-11z" fill="#8ec9e8"/>`
    : mood === "sleepy" ? `<text x="76" y="34" font-size="13" font-weight="700" fill="#7a7690">z</text>`
    : mood === "cheer" ? `<path d="M12 26l6 4M21 12l4 6M50 6v7" stroke="${O}" stroke-width="3" stroke-linecap="round"/>` : "";
  return `<path d="M82 66q14-2 15-12q-2 14-15 18z" fill="${W}" stroke="${K}" stroke-width="3" stroke-linejoin="round"/>` +
    `<ellipse cx="41" cy="90" rx="6" ry="3.5" fill="${O}"/><ellipse cx="59" cy="90" rx="6" ry="3.5" fill="${O}"/>` +
    (up ? wing(17, 50, -50) + wing(83, 50, 50) : wing(18, 64, -18) + wing(82, 64, 18)) +
    `<ellipse cx="50" cy="58" rx="36" ry="31" fill="${W}" stroke="${K}" stroke-width="3"/>` +
    `<ellipse cx="29" cy="61" rx="5.5" ry="3.4" fill="#ff9fb0" opacity=".65"/><ellipse cx="71" cy="61" rx="5.5" ry="3.4" fill="#ff9fb0" opacity=".65"/>` + eyes +
    `<path d="M45.5 58q4.5-3.5 9 0q-4.5 6.5-9 0z" fill="${O}" stroke="${K}" stroke-width="2" stroke-linejoin="round"/>` +
    line("M44 28q-2-9 5-8M52 27q2-10 9-6") +
    `<g transform="rotate(28 72 30)"><rect x="69" y="14" width="6" height="24" rx="1.5" fill="#cf3f5b" stroke="${K}" stroke-width="2.4"/><path d="M69 38h6l-3 6z" fill="#f3e8d2" stroke="${K}" stroke-width="2" stroke-linejoin="round"/></g>` + extra;
}
