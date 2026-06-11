import { NextResponse } from "next/server";
import { getRoom, setRoom, storeMode } from "../../../lib/store";
import { TEAMS, SLOTS, ROUNDS, canPlay } from "../../../lib/data";
import { simSeries, expandPicks } from "../../../lib/sim";

export const dynamic = "force-dynamic";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function makeCode() {
  let c = "";
  for (let i = 0; i < 4; i++)
    c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

function randomTeams(n, exclude = []) {
  const pool = TEAMS.map((_, i) => i).filter((i) => !exclude.includes(i));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

function currentDraw(room, idx) {
  const o = room.override[idx];
  return o !== null && o !== undefined ? o : room.draws[room.round];
}

// True if the player has at least one legal (player, slot) combo on the
// current draw. Can be false when duplicate-player blocking collides with
// the remaining open slots — in that case a free re-roll is allowed.
function hasLegalPick(room, idx) {
  const teamData = TEAMS[currentDraw(room, idx)];
  const used = new Set(room.picks[idx].map((pk) => pk.slot));
  const names = new Set(
    room.picks[idx].map((pk) => TEAMS[pk.t].players[pk.p].n)
  );
  const benchOpen = [5, 6, 7].some((s) => !used.has(s));
  return teamData.players.some((p) => {
    if (names.has(p.n)) return false;
    if (benchOpen) return true;
    return SLOTS.slice(0, 5).some((s, i) => !used.has(i) && canPlay(p.pos, s));
  });
}

function publicTeam(ti) {
  const t = TEAMS[ti];
  return {
    label: t.label,
    players: t.players.map((p, i) => ({ i, ...p })),
  };
}

function expandedRoster(picks) {
  return expandPicks(picks).map((pk) => ({
    slot: pk.slot,
    slotName: SLOTS[pk.slot],
    team: pk.team,
    ...pk.pl,
  }));
}

function stateFor(room, playerId) {
  const idx = room.players.findIndex((p) => p.id === playerId);
  const opp = idx >= 0 ? room.players[1 - idx] : null;
  const base = {
    code: room.code,
    phase: room.phase,
    round: room.round,
    rounds: ROUNDS,
    slots: SLOTS,
    youIdx: idx,
    players: room.players.map((p) => p.name),
  };
  if (idx < 0) return base; // not joined yet

  const myPicks = room.picks[idx];
  const oppPicks = room.picks[1 - idx];
  base.you = {
    name: room.players[idx].name,
    rerollUsed: room.rerollUsed[idx],
    roster: expandedRoster(myPicks),
    pickedThisRound: myPicks.length > room.round,
  };
  base.opp = opp
    ? {
        name: opp.name,
        pickedThisRound: oppPicks.length > room.round,
        picksCount: oppPicks.length,
        // Hide opponent roster until the draft is over.
        roster: room.phase === "draft" || room.phase === "lobby" ? null : expandedRoster(oppPicks),
      }
    : null;

  if (room.phase === "draft") {
    base.draw = publicTeam(currentDraw(room, idx));
  }
  if (room.series) {
    const s = room.series;
    base.series = {
      wins: countRevealedWins(s),
      games: s.games.slice(0, s.revealed),
      revealed: s.revealed,
      total: s.games.length,
      over: s.revealed >= s.games.length,
    };
  }
  return base;
}

function countRevealedWins(s) {
  const wins = [0, 0];
  for (let i = 0; i < s.revealed; i++) wins[s.games[i].winner]++;
  return wins;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = (searchParams.get("code") || "").toUpperCase();
  const playerId = searchParams.get("playerId") || "";
  const room = await getRoom(code);
  if (!room)
    return NextResponse.json(
      { error: "Room not found", store: storeMode() },
      { status: 404 }
    );
  return NextResponse.json(stateFor(room, playerId));
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const action = body.action;
  const playerId = body.playerId || "";
  const name = (body.name || "").trim().slice(0, 20);

  if (action === "create") {
    if (!playerId || !name)
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    let code = makeCode();
    // avoid collisions
    for (let i = 0; i < 5 && (await getRoom(code)); i++) code = makeCode();
    const room = {
      code,
      created: Date.now(),
      players: [{ id: playerId, name }],
      phase: "lobby",
      round: 0,
      draws: randomTeams(ROUNDS),
      override: [null, null],
      rerollUsed: [false, false],
      picks: [[], []],
      series: null,
    };
    await setRoom(code, room);
    return NextResponse.json({ code });
  }

  const code = (body.code || "").toUpperCase();
  const room = await getRoom(code);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  const idx = room.players.findIndex((p) => p.id === playerId);

  if (action === "join") {
    if (idx >= 0) return NextResponse.json(stateFor(room, playerId)); // already in
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
    if (room.players.length >= 2)
      return NextResponse.json({ error: "Room is full" }, { status: 403 });
    room.players.push({ id: playerId, name });
    room.phase = "draft";
    await setRoom(code, room);
    return NextResponse.json(stateFor(room, playerId));
  }

  if (idx < 0) return NextResponse.json({ error: "Not in this room" }, { status: 403 });

  if (action === "pick") {
    if (room.phase !== "draft")
      return NextResponse.json({ error: "Not drafting" }, { status: 400 });
    if (room.picks[idx].length > room.round)
      return NextResponse.json(stateFor(room, playerId)); // already picked (idempotent)
    const ti = currentDraw(room, idx);
    const teamData = TEAMS[ti];
    const p = Number(body.player);
    const slot = Number(body.slot);
    if (!(p >= 0 && p < teamData.players.length))
      return NextResponse.json({ error: "Invalid player" }, { status: 400 });
    if (!(slot >= 0 && slot < SLOTS.length))
      return NextResponse.json({ error: "Invalid slot" }, { status: 400 });
    if (room.picks[idx].some((pk) => pk.slot === slot))
      return NextResponse.json({ error: "Slot already filled" }, { status: 400 });
    if (slot < 5 && !canPlay(teamData.players[p].pos, SLOTS[slot]))
      return NextResponse.json(
        { error: `${teamData.players[p].n} can't start at ${SLOTS[slot]}` },
        { status: 400 }
      );
    // Same player can appear on multiple team-seasons (e.g. Wilt, Shaq) —
    // but can only be on your roster once.
    const pname = teamData.players[p].n;
    if (room.picks[idx].some((pk) => TEAMS[pk.t].players[pk.p].n === pname))
      return NextResponse.json(
        { error: `${pname} is already on your roster` },
        { status: 400 }
      );
    room.picks[idx].push({ t: ti, p, slot });

    // Advance the round when both players have picked.
    const a = room.picks[0].length;
    const b = room.picks[1].length;
    if (a > room.round && b > room.round) {
      if (room.round >= ROUNDS - 1) {
        room.phase = "series";
        room.series = simSeries(room.picks[0], room.picks[1]);
      } else {
        room.round++;
        room.override = [null, null];
      }
    }
    await setRoom(code, room);
    return NextResponse.json(stateFor(room, playerId));
  }

  // Rearrange your own roster during the draft: move a player to an open
  // slot, or swap two players (bench <-> starter), respecting positions.
  if (action === "move") {
    if (room.phase !== "draft")
      return NextResponse.json({ error: "Not drafting" }, { status: 400 });
    const from = Number(body.from);
    const to = Number(body.to);
    if (
      !(from >= 0 && from < SLOTS.length) ||
      !(to >= 0 && to < SLOTS.length) ||
      from === to
    )
      return NextResponse.json({ error: "Invalid move" }, { status: 400 });
    const mover = room.picks[idx].find((pk) => pk.slot === from);
    if (!mover)
      return NextResponse.json({ error: "No player in that slot" }, { status: 400 });
    const occupant = room.picks[idx].find((pk) => pk.slot === to) || null;
    const fits = (pk, slot) =>
      slot >= 5 || canPlay(TEAMS[pk.t].players[pk.p].pos, SLOTS[slot]);
    if (!fits(mover, to))
      return NextResponse.json(
        { error: `${TEAMS[mover.t].players[mover.p].n} can't start at ${SLOTS[to]}` },
        { status: 400 }
      );
    if (occupant && !fits(occupant, from))
      return NextResponse.json(
        { error: "Swap not allowed — positions don't match" },
        { status: 400 }
      );
    mover.slot = to;
    if (occupant) occupant.slot = from;
    await setRoom(code, room);
    return NextResponse.json(stateFor(room, playerId));
  }

  if (action === "reroll") {
    if (room.phase !== "draft")
      return NextResponse.json({ error: "Not drafting" }, { status: 400 });
    if (room.picks[idx].length > room.round)
      return NextResponse.json({ error: "Already picked this round" }, { status: 400 });
    const stuck = !hasLegalPick(room, idx);
    if (room.rerollUsed[idx] && !stuck)
      return NextResponse.json({ error: "Re-roll already used" }, { status: 400 });
    const exclude = [...room.draws, room.override[idx]].filter(
      (x) => x !== null && x !== undefined
    );
    room.override[idx] = randomTeams(1, exclude)[0];
    if (!stuck) room.rerollUsed[idx] = true; // free re-roll when no legal pick
    await setRoom(code, room);
    return NextResponse.json(stateFor(room, playerId));
  }

  if (action === "reveal") {
    if (room.phase !== "series" || !room.series)
      return NextResponse.json({ error: "No series yet" }, { status: 400 });
    if (idx !== 0)
      return NextResponse.json(
        { error: "Only the host can play the next game" },
        { status: 403 }
      );
    if (room.series.revealed < room.series.games.length) {
      room.series.revealed++;
      if (room.series.revealed >= room.series.games.length) room.phase = "done";
      await setRoom(code, room);
    }
    return NextResponse.json(stateFor(room, playerId));
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
