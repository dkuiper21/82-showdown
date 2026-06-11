"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function getPlayerId() {
  let id = localStorage.getItem("s82_pid");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("s82_pid", id);
  }
  return id;
}

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(localStorage.getItem("s82_name") || "");
  }, []);

  function saveName() {
    localStorage.setItem("s82_name", name.trim());
  }

  async function createGame() {
    if (!name.trim()) return setError("Enter your name first");
    setBusy(true);
    setError("");
    saveName();
    try {
      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          playerId: getPlayerId(),
          name: name.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      router.push(`/room/${data.code}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function joinGame() {
    if (!name.trim()) return setError("Enter your name first");
    if (code.trim().length !== 4) return setError("Code is 4 characters");
    setBusy(true);
    setError("");
    saveName();
    try {
      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "join",
          code: code.trim().toUpperCase(),
          playerId: getPlayerId(),
          name: name.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      router.push(`/room/${code.trim().toUpperCase()}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <div className="logo">
        82 <span>SHOWDOWN</span>
      </div>
      <div className="tagline">
        Draft 8 legends from random NBA seasons.
        <br />
        Battle your friend in a best-of-7 series.
      </div>

      <div className="card">
        <label className="label">Your name</label>
        <input
          value={name}
          maxLength={20}
          placeholder="e.g. Daniel"
          onChange={(e) => setName(e.target.value)}
        />

        <button className="btn" onClick={createGame} disabled={busy}>
          Create Game
        </button>

        <div className="divider">or join a friend</div>

        <label className="label">Game code</label>
        <input
          className="code"
          value={code}
          maxLength={4}
          placeholder="ABCD"
          autoCapitalize="characters"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button className="btn ghost" onClick={joinGame} disabled={busy}>
          Join Game
        </button>

        {error && <div className="error">{error}</div>}
      </div>

      <div className="card" style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
        <b style={{ color: "var(--text)" }}>How it works:</b> each round, both of
        you see the same random team-season (like the &rsquo;96 Bulls or &rsquo;87
        Lakers). Pick one player and slot him into your 8-man rotation — five
        starters by position plus three bench spots. After 8 rounds, your squads
        face off in a simulated best-of-7 series. One re-roll each. Choose wisely.
      </div>
    </div>
  );
}
