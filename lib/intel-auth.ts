/**
 * Access rules for the Intelligence Feed:
 *  - GrokBot authenticates with `Authorization: Bearer <INTEL_FEED_API_KEY>`. The key can
 *    read the feed, create/edit posts, and ADD Shadow Data Types, tickers and portfolios —
 *    never rename/merge/delete them, delete posts, touch folders, or set/create CATEGORIES
 *    (reserved for admins; bot-sent `categories` are dropped in the posts routes). It is a
 *    dedicated key so the bot never holds HUB_API_TOKEN (an admin identity across the app).
 *  - Hub admins (super_admin / exec_admin / admin) curate everything.
 *  - Any signed-in hub user reads the feed and keeps their own saved folders.
 */
import crypto from "crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireHubUser, type HubUser } from "./hub-auth";
import { IntelError } from "./intel";

export type IntelActor = { kind: "bot"; name: string } | { kind: "user"; user: HubUser };

export function isIntelAdmin(role: string): boolean {
  return role === "super_admin" || role === "exec_admin" || role === "admin";
}

function isBot(req: NextRequest): boolean {
  const expected = process.env.INTEL_FEED_API_KEY;
  const header = req.headers.get("authorization") ?? "";
  if (!expected || !header.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7).trim());
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

type Gate<T> = { actor: T } | { response: NextResponse };

/** Bot key or any signed-in hub user. */
export async function requireReader(req: NextRequest): Promise<Gate<IntelActor>> {
  if (isBot(req)) return { actor: { kind: "bot", name: "GrokBot" } };
  const gate = await requireHubUser(req);
  if ("response" in gate) return gate;
  return { actor: { kind: "user", user: gate.user } };
}

/** Bot key or a hub admin — who may create/edit posts and add new taxonomy entries. */
export async function requireAuthor(req: NextRequest): Promise<Gate<IntelActor>> {
  const gate = await requireReader(req);
  if ("response" in gate) return gate;
  if (gate.actor.kind === "user" && !isIntelAdmin(gate.actor.user.role)) return forbidden();
  return gate;
}

/** Hub admins only (the bot key is NOT accepted). */
export async function requireIntelAdmin(req: NextRequest): Promise<Gate<HubUser>> {
  const gate = await requireHubUser(req);
  if ("response" in gate) return gate;
  if (!isIntelAdmin(gate.user.role)) return forbidden();
  return { actor: gate.user };
}

/** Signed-in hub user (folders are per person, so the bot key is not accepted). */
export async function requireUser(req: NextRequest): Promise<Gate<HubUser>> {
  const gate = await requireHubUser(req);
  if ("response" in gate) return gate;
  return { actor: gate.user };
}

function forbidden() {
  return { response: NextResponse.json({ error: "Admins only." }, { status: 403 }) };
}

export function actorName(actor: IntelActor): string {
  return actor.kind === "bot" ? actor.name : actor.user.name || actor.user.email;
}

/** Run a store operation and turn IntelErrors into JSON responses. */
export function handle(fn: () => unknown, status = 200): NextResponse {
  try {
    return NextResponse.json(fn() ?? { ok: true }, { status });
  } catch (e) {
    if (e instanceof IntelError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[intel]", e);
    return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
  }
}

export async function jsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}
