// SPDX-License-Identifier: AGPL-3.0-only
// Validated, immutable runtime configuration. Loaded once at startup so the
// service fails fast (before binding a port) when something required is missing
// or nonsensical — never half-configured in production.

export type Environment = "production" | "staging" | "development";

export interface Config {
  env: Environment;
  port: number;
  requestTimeoutMs: number;
  splyntra: {
    apiKey: string;
    project: string;
    endpoint: string;
  };
  openai: {
    /** null → run in simulated-LLM mode (no provider account needed). */
    apiKey: string | null;
    model: string;
  };
}

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : fallback;
}

function intInRange(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}], got ${JSON.stringify(raw)}`);
  }
  return n;
}

function parseEnv(): Environment {
  const v = optional("NODE_ENV", "development");
  if (v !== "production" && v !== "staging" && v !== "development") {
    throw new Error(`NODE_ENV must be production|staging|development, got ${JSON.stringify(v)}`);
  }
  return v;
}

export function loadConfig(): Config {
  const env = parseEnv();

  const cfg: Config = {
    env,
    port: intInRange("PORT", 8080, 1, 65535),
    requestTimeoutMs: intInRange("REQUEST_TIMEOUT_MS", 15000, 1000, 120000),
    splyntra: {
      apiKey: required("SPLYNTRA_API_KEY"),
      project: required("SPLYNTRA_PROJECT"),
      endpoint: optional("SPLYNTRA_ENDPOINT", "http://localhost:4318"),
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY?.trim() || null,
      model: optional("OPENAI_MODEL", "gpt-4o-mini"),
    },
  };

  // In production, refuse the dev key and an insecure endpoint — these are the
  // single most common "works in staging, leaks in prod" misconfigurations.
  if (cfg.env === "production") {
    if (cfg.splyntra.apiKey === "splyntra_dev_key") {
      throw new Error("Refusing to start: SPLYNTRA_API_KEY is the shared dev key in production");
    }
    if (cfg.splyntra.endpoint.startsWith("http://") && !cfg.splyntra.endpoint.includes("localhost")) {
      throw new Error("Refusing to start: SPLYNTRA_ENDPOINT must be https:// in production");
    }
  }

  return cfg;
}
