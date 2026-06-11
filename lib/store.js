// Room storage: Upstash Redis in production, in-memory Map for local dev.
import { Redis } from "@upstash/redis";

const url =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const redis = url && token ? new Redis({ url, token }) : null;

// In-memory fallback (works with `next dev`; NOT shared across serverless
// instances, so production needs Redis).
const mem = globalThis.__s82mem || (globalThis.__s82mem = new Map());

const TTL_SECONDS = 60 * 60 * 24; // rooms expire after 24h

export async function getRoom(code) {
  if (redis) return await redis.get(`room:${code}`);
  return mem.get(code) || null;
}

export async function setRoom(code, room) {
  if (redis) {
    await redis.set(`room:${code}`, room, { ex: TTL_SECONDS });
  } else {
    mem.set(code, room);
  }
}

export function hasSharedStore() {
  return !!redis;
}
