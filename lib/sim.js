// Best-of-7 series simulation with era-adjusted ratings.
import { TEAMS } from "./data";

// Pace/era adjustment so 1960s box scores don't break the game.
function eraFactor(year) {
  if (year < 1965) return 0.75;
  if (year < 1975) return 0.85;
  if (year < 1985) return 0.93;
  return 1.0;
}

// picks: [{ t, p, slot }] -> expanded with team/player data
export function expandPicks(picks) {
  return picks.map((pk) => {
    const team = TEAMS[pk.t];
    const pl = team.players[pk.p];
    return { ...pk, team: team.label, year: team.year, pl };
  });
}

function ratings(expanded) {
  let off = 0;
  let def = 0;
  for (const pk of expanded) {
    const w = pk.slot < 5 ? 1.0 : 0.55; // bench minutes weight
    const f = eraFactor(pk.year);
    off += w * f * (pk.pl.pts + 1.4 * pk.pl.ast);
    def += w * (f * 0.8 * pk.pl.reb + 2.8 * pk.pl.stl + 2.8 * pk.pl.blk);
  }
  return { off, def };
}

function topPerformer(expanded) {
  // Weighted random "leading scorer" for flavor.
  const weights = expanded.map(
    (pk) => (pk.slot < 5 ? 1.0 : 0.5) * Math.max(pk.pl.pts, 2)
  );
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  let chosen = expanded[0];
  for (let i = 0; i < expanded.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      chosen = expanded[i];
      break;
    }
  }
  const f = eraFactor(chosen.year);
  const pts = Math.round(chosen.pl.pts * f * (0.85 + Math.random() * 0.5)) + 2;
  return { n: chosen.pl.n, pts };
}

function gameDesc(margin) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  if (margin >= 15)
    return pick(["Blowout.", "Never close.", "A statement win.", "Wire to wire."]);
  if (margin >= 8)
    return pick(["Controlled throughout.", "Pulled away late.", "A solid win."]);
  if (margin >= 4)
    return pick(["Tight into the fourth.", "Clutch finish.", "Hard-fought."]);
  return pick(["Down to the final shot!", "An instant classic.", "Heartstopper."]);
}

// Returns { games: [...], wins: [a, b] } — best of 7, 2-2-1-1-1 format.
export function simSeries(picksA, picksB) {
  const A = expandPicks(picksA);
  const B = expandPicks(picksB);
  const ra = ratings(A);
  const rb = ratings(B);
  const homePattern = [0, 0, 1, 1, 0, 1, 0]; // 0 = player A hosts
  const games = [];
  const wins = [0, 0];

  for (let g = 0; g < 7 && wins[0] < 4 && wins[1] < 4; g++) {
    const homeIsA = homePattern[g] === 0;
    let sa = Math.round(
      86 + 0.22 * ra.off - 0.095 * rb.def + (homeIsA ? 1.5 : 0) + (Math.random() * 18 - 9)
    );
    let sb = Math.round(
      86 + 0.22 * rb.off - 0.095 * ra.def + (homeIsA ? 0 : 1.5) + (Math.random() * 18 - 9)
    );
    let ot = false;
    if (sa === sb) {
      ot = true;
      if (Math.random() < 0.5) sa += 2 + Math.floor(Math.random() * 5);
      else sb += 2 + Math.floor(Math.random() * 5);
    }
    const winner = sa > sb ? 0 : 1;
    wins[winner]++;
    games.push({
      n: g + 1,
      sa,
      sb,
      ot,
      winner,
      topA: topPerformer(A),
      topB: topPerformer(B),
      desc: gameDesc(Math.abs(sa - sb)),
    });
  }
  return {
    games,
    wins,
    revealed: 0,
    // Stored so the result screen can show each squad's strength.
    ratings: [
      { off: Math.round(ra.off), def: Math.round(ra.def) },
      { off: Math.round(rb.off), def: Math.round(rb.def) },
    ],
  };
}
