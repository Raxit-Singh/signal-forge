/** Words that come into focus from the middle of the line outward, or from the start (--i is their place in that order). */
export function Words({ text, breakAfter, from = "middle" }: { text: string; breakAfter?: number; from?: "middle" | "start" }) {
  const words = text.split(" ");
  const mid = from === "start" ? 0 : (words.length - 1) / 2;
  return words.map((w, i) => (
    <span key={i}>
      <span className="hx-w" style={{ ["--i" as string]: Math.abs(i - mid) }}>{w}</span>
      {" "}{i === breakAfter && <br className="max-md:hidden" />}
    </span>
  ));
}
