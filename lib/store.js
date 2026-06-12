// Room storage, in priority order:
// 1. Upstash REST  (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN)
// 2. Redis via TCP (REDIS_URL or KV_URL — what newer Vercel/Upstash
//    integrations set, e.g. rediss://default:pass@host:6379)
// 3. In-memory Map (local dev only — NOT shared across serverless instances)
import { Redis } from "@upstash/redis";
import IORedis from "ioredis";

const TTL_SECONDS = 60 * 60 * 24; // rooms expire after 24h

const restUrl =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const restToken =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const tcpUrl = process.env.REDIS_URL || process.env.KV_URL;

const rest = restUrl && restToken ? new Redis({ url: restUrl, token: restToken }) : null;

// Reuse one TCP connection per serverless instance.
const tcp =
  !rest && tcpUrl
    ? globalThis.__s82io ||
      (globalThis.__s82io = new IORedis(tcpUrl, {
        maxRetriesPerRequest: 2,
        connectTimeout: 5000,
      }))
    : null;

const mem = globalThis.__s82mem || (globalThis.__s82mem = new Map());

export async function getRoom(code) {
  const key = `room:${code}`;
  if (rest) return await rest.get(key);
  if (tcp) {
    const raw = await tcp.get(key);
    return raw ? JSON.parse(raw) : null;
  }
  return mem.get(code) || null;
}

export async function setRoom(code, room) {
  const key = `room:${code}`;
  if (rest) {
    await rest.set(key, room, { ex: TTL_SECONDS });
  } else if (tcp) {
    await tcp.set(key, JSON.stringify(room), "EX", TTL_SECONDS);
  } else {
    mem.set(code, room);
  }
}

// Small generic KV (used for the matchmaking queue). Pass null to delete.
export async function getKV(key) {
  const k = `kv:${key}`;
  if (rest) return await rest.get(k);
  if (tcp) {
    const raw = await tcp.get(k);
    return raw ? JSON.parse(raw) : null;
  }
  return mem.get(k) || null;
}

export async function setKV(key, val, ttlSeconds = 300) {
  const k = `kv:${key}`;
  if (val === null) {
    if (rest) await rest.del(k);
    else if (tcp) await tcp.del(k);
    else mem.delete(k);
    return;
  }
  if (rest) await rest.set(k, val, { ex: ttlSeconds });
  else if (tcp) await tcp.set(k, JSON.stringify(val), "EX", ttlSeconds);
  else mem.set(k, val);
}

export function storeMode() {
  if (rest) return "redis-rest";
  if (tcp) return "redis-tcp";
  return "memory";
}
