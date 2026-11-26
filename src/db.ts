import type { Env } from './types';

export type DB = D1Database;

export function q(env: Env): D1Database {
  return env.DB;
}

export async function all<T = Record<string, unknown>>(env: Env, sql: string, ...params: unknown[]): Promise<T[]> {
  const res = await env.DB.prepare(sql)
    .bind(...(params as never[]))
    .all();
  return (res.results ?? []) as T[];
}

export async function one<T = Record<string, unknown>>(env: Env, sql: string, ...params: unknown[]): Promise<T | null> {
  const res = await env.DB.prepare(sql)
    .bind(...(params as never[]))
    .first();
  return (res as T) ?? null;
}

export async function run(env: Env, sql: string, ...params: unknown[]): Promise<D1Result> {
  return env.DB.prepare(sql).bind(...(params as never[])).run();
}

export async function scalar<T = number>(env: Env, sql: string, ...params: unknown[]): Promise<T | null> {
  const row = await one<Record<string, T>>(env, sql, ...params);
  if (!row) return null;
  return Object.values(row)[0] as T;
}

export async function batch(env: Env, stmts: D1PreparedStatement[]): Promise<D1Result[]> {
  if (!stmts.length) return [];
  return env.DB.batch(stmts);
}

export function stmt(env: Env, sql: string, ...params: unknown[]): D1PreparedStatement {
  return env.DB.prepare(sql).bind(...(params as never[]));
}

export async function transaction<T>(env: Env, fn: () => Promise<T>): Promise<T> {
  // D1 没有交互式事务，这里只是语义占位：需要原子性的操作请使用 batch。
  return fn();
}
