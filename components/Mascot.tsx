import { birdInner, type Mood } from "./mascotArt";
export type { Mood };
export function Mascot({ mood = "happy", size = 64 }: { mood?: Mood; size?: number }) {
  return <svg className="mas" viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="るん（ことり）" dangerouslySetInnerHTML={{ __html: birdInner(mood) }} />;
}
