import { ImageResponse } from "next/og";
import { getRoom } from "../../../lib/store";

// Per-room preview card. When a finished game's link is shared, the card shows
// the final series score and the champion; otherwise it shows a challenge.
// Runs on the Node.js runtime so it can reach the Redis store (incl. ioredis).
export const runtime = "nodejs";
export const alt = "82 Showdown series result";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "linear-gradient(135deg, #0d1321 0%, #1b2540 100%)";

function Shell({ children }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: BG,
        color: "#f5f7fb",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", fontSize: 64, fontWeight: 800, letterSpacing: -2, marginBottom: 40 }}>
        <span>82</span>
        <span style={{ color: "#ff7a00", marginLeft: 14 }}>SHOWDOWN</span>
      </div>
      {children}
    </div>
  );
}

function Team({ name, wins, won }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 360 }}>
      <div style={{ display: "flex", fontSize: 38, color: won ? "#f5f7fb" : "#aeb8d0", maxWidth: 360, textAlign: "center" }}>
        {name}
      </div>
      <div style={{ display: "flex", fontSize: 150, fontWeight: 800, color: won ? "#ff7a00" : "#6b779a" }}>
        {wins}
      </div>
    </div>
  );
}

export default async function RoomOgImage({ params }) {
  let room = null;
  try {
    room = await getRoom((params.code || "").toUpperCase());
  } catch {
    /* fall through to the generic challenge card */
  }

  const finished = room && room.series && Array.isArray(room.series.wins);

  if (!finished) {
    const challenger = room?.players?.[0]?.name;
    return new ImageResponse(
      (
        <Shell>
          <div style={{ display: "flex", fontSize: 46, color: "#aeb8d0", textAlign: "center", maxWidth: 950 }}>
            {challenger ? `${challenger} challenged you!` : "Draft your squad. Battle a friend in a best-of-7."}
          </div>
        </Shell>
      ),
      { ...size }
    );
  }

  const [w0, w1] = room.series.wins;
  const n0 = room.players?.[0]?.name || "Player 1";
  const n1 = room.players?.[1]?.name || "Player 2";
  const champ = w0 === w1 ? null : w0 > w1 ? n0 : n1;

  return new ImageResponse(
    (
      <Shell>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Team name={n0} wins={w0} won={w0 > w1} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "0 20px" }}>
            <div style={{ display: "flex", fontSize: 30, color: "#6b779a" }}>best of 7</div>
          </div>
          <Team name={n1} wins={w1} won={w1 > w0} />
        </div>
        {champ && (
          <div style={{ display: "flex", marginTop: 36, fontSize: 44, fontWeight: 700 }}>
            🏆 {champ} wins {Math.max(w0, w1)}–{Math.min(w0, w1)}
          </div>
        )}
      </Shell>
    ),
    { ...size }
  );
}
