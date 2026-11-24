import { ImageResponse } from "next/og";

// The picture shown when heardex.com is shared (X, LinkedIn, Slack, iMessage): the mark, the name and what it does,
// on the brand's near-black.
export const alt = "Heardex: your product feedback, ranked";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="423 403 1085 1126" fill="#f4f4f5"><path d="M423 589a186 186 0 0 1 372 0v309a45 45 0 0 1-45 45H468a45 45 0 0 1-45-45z"/><rect x="818" y="564" width="294" height="382" rx="45"/><path d="M1137 575a371 371 0 0 1 371 371h-371z"/><path d="M423 985h372v372A372 372 0 0 1 423 985z"/><rect x="818" y="985" width="287" height="382" rx="45"/><path d="M1182 989h281a45 45 0 0 1 45 45v309a186 186 0 0 1-372 0v-309a45 45 0 0 1 46-45z"/></svg>`;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0b0b0c", color: "#f4f4f5", padding: "72px 80px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <img src={`data:image/svg+xml;base64,${Buffer.from(MARK).toString("base64")}`} width={96} height={100} alt="" />
          <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -2 }}>Heardex</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: -3, lineHeight: 1 }}>Your product feedback, ranked.</div>
          <div style={{ fontSize: 34, color: "#a1a1aa", lineHeight: 1.3, maxWidth: 980 }}>
            What people say about your product on Reddit, Hacker News, GitHub and app stores, sorted into bugs, requests and praise.
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 28, color: "#a1a1aa" }}>
          <div style={{ display: "flex" }}>heardex.com</div>
          <div style={{ display: "flex", width: 120, height: 8, borderRadius: 4, background: "#dc2f22" }} />
        </div>
      </div>
    ),
    size,
  );
}
