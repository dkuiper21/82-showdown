import { NextResponse } from "next/server";
import { getRoom, setRoom, getKV, setKV, storeMode } from "../../../lib/store";
import { TEAMS, SLOTS, ROUNDS, canPlay } from "../../../lib/data";
import { simSeries, expandPicks, playerValue } from "../../../lib/sim";

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

// draws is per-player: draws[idx][round]. In "same" mode both arrays are
// identical; in "random" mode each player gets independent draws.
function currentDraw(room, idx) {
  const o = room.override[idx];
  return o !== null && o !== undefined ? o : room.draws[idx][room.round];
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

// Chance the CPU locks in the current best option at each step. On a miss it
// drops that option and re-evaluates the next-best, so it stays strong but
// beatable and never settles for a wildly random player.
const CPU_BEST_PICK_RATE = 0.9;

// Auto-draft for the computer opponent. Usually picks the highest-value legal
// (player, slot) combo from its drawn team this round — see playerValue() and
// CPU_BEST_PICK_RATE. The CPU never spends the optional strategic re-rolls;
// the only re-roll it takes is the same free, forced one a human gets on a
// hard-stuck draw (no legal pick at all), purely so the draft can't deadlock.
function cpuMakePick(room) {
  const idx = room.players.findIndex((p) => p.cpu);
  if (idx < 0 || room.phase !== "draft") return;
  if (room.picks[idx].length > room.round) return; // already picked this round

  let guard = 0;
  while (!hasLegalPick(room, idx) && guard++ < 50) {
    const exclude = [...room.draws[0], ...room.draws[1], room.override[idx]].filter(
      (x) => x !== null && x !== undefined
    );
    room.override[idx] = randomTeams(1, exclude)[0];
  }

  const ti = currentDraw(room, idx);
  const team = TEAMS[ti];
  const used = new Set(room.picks[idx].map((pk) => pk.slot));
  const names = new Set(
    room.picks[idx].map((pk) => TEAMS[pk.t].players[pk.p].n)
  );

  // Every legal (player, slot) combo this round, best value first.
  const options = [];
  team.players.forEach((pl, p) => {
    if (names.has(pl.n)) return; // already on the CPU's roster
    for (let slot = 0; slot < SLOTS.length; slot++) {
      if (used.has(slot)) continue;
      if (slot < 5 && !canPlay(pl.pos, SLOTS[slot])) continue;
      options.push({ p, slot, v: playerValue(pl, team.year, slot) });
    }
  });
  if (!options.length) return; // shouldn't happen after the stuck guard
  options.sort((a, b) => b.v - a.v);

  // Walk the ranked options best-first: 90% chance to lock in the current
  // best, otherwise drop it and re-evaluate the next-best. The last remaining
  // option is always taken, so a pick is guaranteed.
  let choice = options[options.length - 1];
  for (let i = 0; i < options.length - 1; i++) {
    if (Math.random() < CPU_BEST_PICK_RATE) {
      choice = options[i];
      break;
    }
  }
  room.picks[idx].push({ t: ti, p: choice.p, slot: choice.slot });
}

function publicTeam(ti) {
  const t = TEAMS[ti];
  return {
    label: t.label,
    players: t.players.map((p, i) => ({ i, ...p })),
  };
}

// Fresh room shell — used by both create and rematch.
function freshRoom(code, mode, firstPlayer) {
  let draws;
  if (mode === "random") {
    draws = [randomTeams(ROUNDS), randomTeams(ROUNDS)];
  } else {
    const shared = randomTeams(ROUNDS);
    draws = [shared, [...shared]];
  }
  return {
    code,
    created: Date.now(),
    players: [firstPlayer],
    phase: "lobby",
    round: 0,
    mode,
    draws,
    override: [null, null],
    rerollsLeft: mode === "random" ? [2, 2] : [0, 0],
    picks: [[], []],
    series: null,
  };
}

// Turn a fresh single-player room into a vs-computer game: drop in the CPU as
// player 2 and jump straight to the draft (no lobby/opponent wait).
function cpuify(room) {
  room.players.push({ id: "__cpu__", name: "Computer", cpu: true });
  room.vsCpu = true;
  room.phase = "draft";
  return room;
}

async function freeCode() {
  let code = makeCode();
  for (let i = 0; i < 5 && (await getRoom(code)); i++) code = makeCode();
  return code;
}

// Games auto-reveal on a server clock: first game ~2.5s after the draft
// ends, then one every 3s. Both clients see the same count via polling.
function revealedCount(room) {
  if (!room.series) return 0;
  const elapsed = Date.now() - (room.seriesStart || 0);
  return Math.max(
    0,
    Math.min(room.series.games.length, Math.floor((elapsed - 2500) / 3000) + 1)
  );
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
  base.mode = room.mode || "same";
  base.matchmaking = !!room.matchmaking;
  base.you = {
    name: room.players[idx].name,
    rerollsLeft: room.rerollsLeft ? room.rerollsLeft[idx] : 0,
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
  base.rematch = room.next
    ? {
        code: room.next.code,
        by: room.players[room.next.by]?.name,
        byIdx: room.next.by,
      }
    : null;
  if (room.series) {
    const s = room.series;
    const revealed = revealedCount(room);
    base.series = {
      wins: countRevealedWins(s, revealed),
      games: s.games.slice(0, revealed),
      revealed,
      total: s.games.length,
      over: revealed >= s.games.length,
      ratings: s.ratings || null, // [player0, player1] off/def ratings
    };
  }
  return base;
}

function countRevealedWins(s, revealed) {
  const wins = [0, 0];
  for (let i = 0; i < revealed; i++) wins[s.games[i].winner]++;
  return wins;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = (searchParams.get("code") || "").toUpperCase();
  // playerId is an auth token — read it from a header so it never lands in
  // URLs (server access logs, proxy logs, browser history).
  const playerId = req.headers.get("x-player-id") || "";
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
    // "same": both players draft from identical draws, no re-rolls.
    // "random": independent draws for each player, 2 re-rolls each.
    const mode = body.mode === "random" ? "random" : "same";
    const code = await freeCode();
    const room = freshRoom(code, mode, { id: playerId, name });
    await setRoom(code, room);
    return NextResponse.json({ code });
  }

  // Solo game vs the computer. Both seats are filled immediately and the
  // draft starts right away. The CPU drafts in the same request as each of
  // your picks (see cpuMakePick), so rounds advance as soon as you pick.
  if (action === "cpu") {
    if (!playerId || !name)
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    const mode = body.mode === "random" ? "random" : "same";
    const code = await freeCode();
    const room = cpuify(freshRoom(code, mode, { id: playerId, name }));
    await setRoom(code, room);
    return NextResponse.json({ code });
  }

  // Matchmaking: if someone is already waiting, join their room; otherwise
  // create an open room and sit in the queue (entry stays fresh for 2 min).
  if (action === "queue") {
    if (!playerId || !name)
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    const mode = body.mode === "random" ? "random" : "same";
    const q = await getKV("queue");
    if (q && Date.now() - q.ts < 120000 && q.playerId !== playerId) {
      const qroom = await getRoom(q.code);
      if (qroom && qroom.phase === "lobby" && qroom.players.length === 1) {
        qroom.players.push({ id: playerId, name });
        qroom.phase = "draft";
        await setRoom(q.code, qroom);
        await setKV("queue", null);
        return NextResponse.json({ code: q.code, matched: true });
      }
      // Queued room is gone or already full — fall through and take its place.
    }
    const ncode = await freeCode();
    const nroom = freshRoom(ncode, mode, { id: playerId, name });
    nroom.matchmaking = true;
    await setRoom(ncode, nroom);
    await setKV("queue", { code: ncode, playerId, ts: Date.now() }, 150);
    return NextResponse.json({ code: ncode, matched: false });
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

    // Computer drafts immediately after you, so the round can advance.
    if (room.vsCpu) cpuMakePick(room);

    // Advance the round when both players have picked.
    const a = room.picks[0].length;
    const b = room.picks[1].length;
    if (a > room.round && b > room.round) {
      if (room.round >= ROUNDS - 1) {
        room.phase = "series";
        room.series = simSeries(room.picks[0], room.picks[1]);
        room.seriesStart = Date.now();
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
    if (room.rerollsLeft[idx] <= 0 && !stuck)
      return NextResponse.json({ error: "No re-rolls left" }, { status: 400 });
    const exclude = [...room.draws[0], ...room.draws[1], room.override[idx]].filter(
      (x) => x !== null && x !== undefined
    );
    room.override[idx] = randomTeams(1, exclude)[0];
    if (!stuck) room.rerollsLeft[idx]--; // stuck = free re-roll, costs nothing
    await setRoom(code, room);
    return NextResponse.json(stateFor(room, playerId));
  }

  // Rematch: first player to tap creates the next room (same mode) and a
  // pointer is stored on the finished room so the opponent gets alerted via
  // polling and can hop over without entering a code.
  if (action === "rematch") {
    const over =
      room.series && revealedCount(room) >= room.series.games.length;
    if (!over)
      return NextResponse.json({ error: "Series isn't finished" }, { status: 400 });

    // Vs-computer: no opponent to coordinate with — just start a fresh game.
    if (room.vsCpu) {
      const ncode = await freeCode();
      const nroom = cpuify(
        freshRoom(ncode, room.mode || "same", {
          id: playerId,
          name: room.players[idx].name,
        })
      );
      await setRoom(ncode, nroom);
      return NextResponse.json({ code: ncode });
    }

    if (room.next) {
      // Rematch room already exists — join it if we're not in it yet.
      const nroom = await getRoom(room.next.code);
      if (nroom) {
        const inRoom = nroom.players.some((p) => p.id === playerId);
        if (!inRoom && nroom.players.length < 2) {
          nroom.players.push({ id: playerId, name: room.players[idx].name });
          nroom.phase = "draft";
          await setRoom(nroom.code, nroom);
        }
        return NextResponse.json({ code: room.next.code });
      }
      // next room expired — fall through and create a fresh one
    }

    const ncode = await freeCode();
    const nroom = freshRoom(ncode, room.mode || "same", {
      id: playerId,
      name: room.players[idx].name,
    });
    await setRoom(ncode, nroom);
    room.next = { code: ncode, by: idx };
    await setRoom(code, room);
    return NextResponse.json({ code: ncode });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
