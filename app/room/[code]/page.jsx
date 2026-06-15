"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

function getPlayerId() {
  let id = localStorage.getItem("s82_pid");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("s82_pid", id);
  }
  return id;
}

const fmt = (x) => (Math.round(x * 10) / 10).toFixed(1);

// Multi-position support: pos like "SG/SF" qualifies for either starter slot.
const canPlay = (pos, slotName) => pos.split("/").includes(slotName);

function StatLine({ p }) {
  return (
    <span className="st">
      {fmt(p.pts)}p {fmt(p.reb)}r {fmt(p.ast)}a {fmt(p.stl)}s {fmt(p.blk)}b
    </span>
  );
}

// When onTap is provided the roster is interactive: tap a player, then tap a
// destination slot to move him (open slot, or legal swap with another player).
function Roster({ roster, slots, title, onTap, moveFrom = null }) {
  const bySlot = {};
  for (const r of roster || []) bySlot[r.slot] = r;
  const fits = (pl, s) => s >= 5 || canPlay(pl.pos, slots[s]);
  const eligibleTarget = (i) => {
    if (moveFrom === null || moveFrom === i) return false;
    const mover = bySlot[moveFrom];
    if (!mover || !fits(mover, i)) return false;
    const occ = bySlot[i];
    return !occ || fits(occ, moveFrom);
  };
  return (
    <div className="card">
      <div className="label">{title}</div>
      {onTap && (
        <div className="movehint">
          {moveFrom === null
            ? "Tap a player to move him to/from the bench"
            : "Tap a highlighted slot to move (tap him again to cancel)"}
        </div>
      )}
      {slots.map((s, i) => {
        const r = bySlot[i];
        const cls = [
          "rosterline",
          moveFrom === i ? "movesel" : "",
          eligibleTarget(i) ? "target" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const content = (
          <>
            <div className="slot">{i < 5 ? s : `BN${i - 4}`}</div>
            <div className="who">
              {r ? (
                <>
                  {r.n}
                  <small>{r.team}</small>
                </>
              ) : (
                <span className="empty">open</span>
              )}
            </div>
          </>
        );
        return onTap ? (
          <button className={cls} key={i} onClick={() => onTap(i)}>
            {content}
          </button>
        ) : (
          <div className={cls} key={i}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

export default function Room() {
  const { code } = useParams();
  const router = useRouter();
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [joinName, setJoinName] = useState("");
  const [selected, setSelected] = useState(null); // player index in draw
  const [moveFrom, setMoveFrom] = useState(null); // roster slot being moved
  const [showStats, setShowStats] = useState(false); // hidden by default
  const [busy, setBusy] = useState(false);
  const pidRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!pidRef.current) return;
    try {
      const res = await fetch(`/api/game?code=${code}`, {
        cache: "no-store",
        headers: { "x-player-id": pidRef.current },
      });
      const data = await res.json();
      if (res.ok) {
        setState(data);
        setError("");
      } else if (res.status === 404) {
        setError("Room not found (codes expire after 24h)");
      }
    } catch {
      /* transient network error — keep polling */
    }
  }, [code]);

  useEffect(() => {
    pidRef.current = getPlayerId();
    setJoinName(localStorage.getItem("s82_name") || "");
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  // Clear selection whenever the round advances or the draw changes (re-roll),
  // so a stale index can't point at the wrong player.
  const drawKey = `${state?.round}|${state?.draw?.label}`;
  useEffect(() => {
    setSelected(null);
    setMoveFrom(null);
  }, [drawKey]);

  async function post(payload) {
    setBusy(true);
    try {
      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, playerId: pidRef.current, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      if (data.phase) setState(data);
      setError("");
      return data;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Tap-to-move on your own roster during the draft.
  function rosterTap(i) {
    const bySlot = {};
    for (const r of state.you.roster) bySlot[r.slot] = r;
    if (moveFrom === null) {
      if (bySlot[i]) setMoveFrom(i); // select a player to move
      return;
    }
    if (moveFrom === i) {
      setMoveFrom(null); // tap again to cancel
      return;
    }
    const fits = (pl, s) => s >= 5 || canPlay(pl.pos, state.slots[s]);
    const mover = bySlot[moveFrom];
    const occ = bySlot[i];
    if (!mover) {
      setMoveFrom(null);
      return;
    }
    if (!fits(mover, i) || (occ && !fits(occ, moveFrom))) {
      if (occ) setMoveFrom(i); // illegal target with a player → re-select him
      return;
    }
    post({ action: "move", from: moveFrom, to: i });
    setMoveFrom(null);
  }

  if (error && !state) {
    return (
      <div className="wrap">
        <div className="logo">82 <span>SHOWDOWN</span></div>
        <div className="error">{error}</div>
        <a className="btn ghost" style={{ textAlign: "center", textDecoration: "none" }} href="/">
          Back home
        </a>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="wrap">
        <div className="waiting">Loading…</div>
      </div>
    );
  }

  // Visitor opened a shared link but hasn't joined this room yet.
  if (state.youIdx === -1) {
    const full = state.players.length >= 2;
    return (
      <div className="wrap">
        <div className="logo">82 <span>SHOWDOWN</span></div>
        <div className="card">
          {full ? (
            <div className="error">This game is already full.</div>
          ) : (
            <>
              <div className="tagline" style={{ marginBottom: 14 }}>
                {state.players[0]} challenged you!
              </div>
              <label className="label">Your name</label>
              <input
                value={joinName}
                maxLength={20}
                onChange={(e) => setJoinName(e.target.value)}
              />
              <button
                className="btn"
                disabled={busy || !joinName.trim()}
                onClick={() => {
                  localStorage.setItem("s82_name", joinName.trim());
                  post({ action: "join", name: joinName.trim() });
                }}
              >
                Accept Challenge
              </button>
              {error && <div className="error">{error}</div>}
            </>
          )}
        </div>
      </div>
    );
  }

  // ---------- LOBBY ----------
  if (state.phase === "lobby") {
    return (
      <div className="wrap">
        <div className="logo">82 <span>SHOWDOWN</span></div>
        <div className="card">
          <div className="label" style={{ textAlign: "center" }}>Game code</div>
          <div className="bigcode">{state.code}</div>
          <div className="teamsub" style={{ textAlign: "center" }}>
            {state.mode === "random"
              ? "Random teams · 2 re-rolls each"
              : "Same teams · no re-rolls"}
          </div>
          <div className="pulse">
            {state.matchmaking
              ? "Looking for a random opponent…"
              : "Waiting for your opponent to join…"}
          </div>
          <div style={{ marginTop: 16 }}>
            <button
              className="btn ghost"
              onClick={() => {
                const url = window.location.href;
                if (navigator.share) {
                  navigator.share({ title: "82 Showdown", text: `Beat my squad! Code: ${state.code}`, url });
                } else {
                  navigator.clipboard.writeText(url);
                  alert("Link copied!");
                }
              }}
            >
              Share invite link
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- DRAFT ----------
  if (state.phase === "draft") {
    const youPicked = state.you.pickedThisRound;
    const usedSlots = new Set(state.you.roster.map((r) => r.slot));
    const myNames = new Set(state.you.roster.map((r) => r.n));
    // List the draw by position (PG → C), not dataset/stats order. Each
    // player keeps his original index `i` for the pick payload.
    const POS_ORDER = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };
    const primary = (p) => POS_ORDER[p.pos.split("/")[0]];
    const drawSorted = [...state.draw.players].sort(
      (a, b) => primary(a) - primary(b)
    );
    const sel =
      selected !== null
        ? state.draw.players.find((p) => p.i === selected)
        : null;

    return (
      <div className="wrap">
        <div className="topbar">
          <div className="round">
            Round {state.round + 1} <span style={{ color: "var(--muted)" }}>/ {state.rounds}</span>
          </div>
          <div className={`oppstatus ${state.opp?.pickedThisRound ? "ready" : ""}`}>
            {state.opp?.name}: {state.opp?.pickedThisRound ? "picked ✓" : "deciding…"}
          </div>
        </div>

        {!youPicked ? (
          <div className="card">
            <div className="teamname">{state.draw.label}</div>
            <div className="teamsub">Pick one player for your rotation</div>

            {(() => {
              const benchOpen = [5, 6, 7].some((s) => !usedSlots.has(s));
              const canPlace = (p) =>
                !myNames.has(p.n) &&
                (benchOpen ||
                  state.slots
                    .slice(0, 5)
                    .some((s, i) => !usedSlots.has(i) && canPlay(p.pos, s)));
              const noLegalPick = !state.draw.players.some(canPlace);
              return (
                <>
                  {noLegalPick && (
                    <div className="error">
                      No legal pick on this team — take a free re-roll.
                    </div>
                  )}
                  <div className="statsrow">
                    <button
                      className={`toggle ${showStats ? "on" : ""}`}
                      onClick={() => setShowStats(!showStats)}
                    >
                      {showStats ? "Hide stats" : "Show stats"}
                    </button>
                    {(state.you.rerollsLeft > 0 || noLegalPick) && (
                      <button
                        className="toggle"
                        disabled={busy}
                        onClick={() => {
                          setSelected(null);
                          post({ action: "reroll" });
                        }}
                      >
                        🎲 Re-roll team{" "}
                        {noLegalPick && state.you.rerollsLeft <= 0
                          ? "(free)"
                          : `(${state.you.rerollsLeft} left)`}
                      </button>
                    )}
                  </div>
                </>
              );
            })()}

            {drawSorted.map((p) => {
              const drafted = myNames.has(p.n);
              return (
                <button
                  key={p.i}
                  className={`player ${selected === p.i ? "sel" : ""}`}
                  disabled={drafted}
                  onClick={() => setSelected(selected === p.i ? null : p.i)}
                >
                  <span className="pos">{p.pos}</span>
                  <span className="nm">{p.n}</span>
                  {drafted ? (
                    <span className="st">on your roster</span>
                  ) : (
                    showStats && <StatLine p={p} />
                  )}
                </button>
              );
            })}

            {sel && (
              <>
                <div className="label" style={{ marginTop: 12 }}>
                  Slot for {sel.n}
                </div>
                <div className="slotgrid">
                  {state.slots.map((s, i) => {
                    const isBench = i >= 5;
                    const eligible =
                      !usedSlots.has(i) && (isBench || canPlay(sel.pos, s));
                    return (
                      <button
                        key={i}
                        className={`slotbtn ${isBench ? "bench" : ""}`}
                        disabled={!eligible || busy}
                        onClick={() =>
                          post({ action: "pick", player: selected, slot: i }).then(
                            () => setSelected(null)
                          )
                        }
                      >
                        {isBench ? `Bench ${i - 4}` : s}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {error && <div className="error">{error}</div>}
          </div>
        ) : (
          <div className="card">
            <div className="waiting">
              Pick locked in. Waiting for {state.opp?.name}…
            </div>
          </div>
        )}

        <Roster
          roster={state.you.roster}
          slots={state.slots}
          title="Your rotation"
          onTap={rosterTap}
          moveFrom={moveFrom}
        />
        <div className="card" style={{ fontSize: 13, color: "var(--muted)" }}>
          {state.opp?.name} has drafted {state.opp?.picksCount}/8 — picks stay
          hidden until tip-off.
        </div>
      </div>
    );
  }

  // ---------- SERIES / DONE ----------
  const s = state.series;
  const youIdx = state.youIdx;
  const myWins = s.wins[youIdx];
  const oppWins = s.wins[1 - youIdx];
  const over = s.over;
  const champIsYou = over && myWins > oppWins;

  return (
    <div className="wrap">
      <div className="logo" style={{ fontSize: 20, margin: "10px 0" }}>
        THE <span>SERIES</span>
      </div>

      <div className="serieshead card" style={{ marginBottom: 14 }}>
        <div className="seriesteam">
          <div className="nm">{state.you.name}</div>
          <div className="serieswins">{myWins}</div>
          {s.ratings && (
            <div className="ratingline">
              OFF {s.ratings[youIdx].off} · DEF {s.ratings[youIdx].def}
            </div>
          )}
        </div>
        <div className="vs">best of 7</div>
        <div className="seriesteam">
          <div className="nm">{state.opp?.name}</div>
          <div className="serieswins">{oppWins}</div>
          {s.ratings && (
            <div className="ratingline">
              OFF {s.ratings[1 - youIdx].off} · DEF {s.ratings[1 - youIdx].def}
            </div>
          )}
        </div>
      </div>

      {over && (
        <div className="champ">
          <div className="trophy">🏆</div>
          <div className="title">
            {champIsYou ? "YOU ARE THE CHAMP!" : `${state.opp?.name} takes it`}
          </div>
          <div className="sub">
            Series: {Math.max(myWins, oppWins)}–{Math.min(myWins, oppWins)}
          </div>
          <div style={{ marginTop: 14 }}>
            <button
              className="btn small ghost"
              onClick={() => {
                const txt = `82 Showdown: I ${champIsYou ? "beat" : "lost to"} ${state.opp?.name} ${myWins}-${oppWins} in a best-of-7. Draft your squad and challenge me!`;
                const url = window.location.href;
                if (navigator.share) navigator.share({ text: txt, url });
                else {
                  navigator.clipboard.writeText(`${txt} ${url}`);
                  alert("Copied!");
                }
              }}
            >
              Share result
            </button>{" "}
            <button
              className="btn small"
              disabled={busy}
              onClick={async () => {
                const d = await post({ action: "rematch" });
                if (d && d.code) router.push(`/room/${d.code}`);
              }}
            >
              {state.rematch
                ? state.rematch.byIdx === youIdx
                  ? "Back to rematch lobby →"
                  : "Accept rematch ✓"
                : "Rematch →"}
            </button>
          </div>
          {state.rematch && state.rematch.byIdx !== youIdx && (
            <div className="pulse" style={{ marginTop: 12 }}>
              🔔 {state.rematch.by} wants a rematch!
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <a
              className="btn small ghost"
              style={{ textDecoration: "none" }}
              href="/"
            >
              New Game
            </a>
          </div>
        </div>
      )}

      {!over && (
        <div className="waiting" style={{ marginBottom: 14 }}>
          🏀 {s.revealed === 0 ? "Tip-off coming up" : `Simulating Game ${s.revealed + 1}`}…
        </div>
      )}

      {[...s.games].reverse().map((g) => {
        const youWon = g.winner === youIdx;
        const yourScore = youIdx === 0 ? g.sa : g.sb;
        const theirScore = youIdx === 0 ? g.sb : g.sa;
        const yourTop = youIdx === 0 ? g.topA : g.topB;
        const theirTop = youIdx === 0 ? g.topB : g.topA;
        return (
          <div className="game" key={g.n}>
            <div className="gtitle">
              Game {g.n} {g.ot ? "· OT" : ""} · {youWon ? "WIN" : "LOSS"}
            </div>
            <div className="score">
              <span className={youWon ? "w" : ""}>
                {state.you.name} {yourScore}
              </span>
              <span className={!youWon ? "w" : ""}>
                {theirScore} {state.opp?.name}
              </span>
            </div>
            <div className="flavor">{g.desc}</div>
            <div className="tops">
              Top scorers: {yourTop.n} {yourTop.pts} · {theirTop.n} {theirTop.pts}
            </div>
          </div>
        );
      })}

      <div className="section-title">The rosters</div>
      <Roster roster={state.you.roster} slots={state.slots} title={`${state.you.name} (you)`} />
      <Roster roster={state.opp?.roster} slots={state.slots} title={state.opp?.name} />
      {error && <div className="error">{error}</div>}
    </div>
  );
}
