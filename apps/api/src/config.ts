import "dotenv/config";
import { parseRateTable, parseUnitLimits, pricingReady } from "./meter.ts";
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const mode = env.APP_MODE ?? "live",
    origin = env.WEB_ORIGIN ?? "http://localhost:3000";
  const port = Number(env.API_PORT ?? 3001);
  let apiPublicOrigin: string | undefined;
  if (env.API_PUBLIC_ORIGIN?.trim()) {
    const value = env.API_PUBLIC_ORIGIN;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw Error("API_PUBLIC_ORIGIN must be a bare HTTP(S) origin.");
    }
    if (
      !/^https?:\/\/[^/?#\\\s]+\/?$/i.test(value) ||
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username || parsed.password || parsed.pathname !== "/" ||
      parsed.search || parsed.hash
    ) throw Error("API_PUBLIC_ORIGIN must be a bare HTTP(S) origin without credentials, path, query or fragment.");
    if (env.NODE_ENV === "production" && parsed.protocol !== "https:")
      throw Error("API_PUBLIC_ORIGIN must use HTTPS in production.");
    apiPublicOrigin = parsed.origin;
  }
  if (!["live", "fixture"].includes(mode))
    throw Error("APP_MODE must be live or fixture");
  const devAuthBypass = env.DEV_AUTH_BYPASS === "true";
  const loopback = (value: string) => ["localhost", "127.0.0.1", "[::1]"].includes(value);
  if (devAuthBypass && (
    !["development", "test"].includes(env.NODE_ENV ?? "") ||
    new URL(origin).protocol !== "http:" || !loopback(new URL(origin).hostname) ||
    !loopback(env.API_HOST ?? "127.0.0.1") ||
    (mode === "live" && (!loopback(new URL(env.SUPABASE_URL ?? "https://invalid").hostname) || !loopback(new URL(env.DATABASE_URL ?? "https://invalid").hostname)))
  )) throw Error("The sign-in bypass is only available for local development with loopback services.");
  if (devAuthBypass && mode === "live" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env.DEV_AUTH_USER_ID ?? ""))
    throw Error("Set DEV_AUTH_USER_ID to the invited local test profile before skipping sign-in.");
  if (
    mode === "fixture" &&
    (env.NODE_ENV === "production" ||
      !["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  )
    throw Error("Fixture mode is allowed only on local development origins.");
  if (mode === "live")
    for (const k of [
      "DATABASE_URL",
      "SUPABASE_URL",
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "WS_TICKET_SECRET",
      "INTERNAL_WORKER_SECRET",
    ])
      if (!env[k] || env[k]!.startsWith("replace-"))
        throw Error(`Missing required live configuration: ${k}`);
  if (
    env.NODE_ENV === "production" &&
    (env.INTERNAL_WORKER_SECRET === "local-worker-development-secret"||(env.INTERNAL_WORKER_SECRET?.length??0)<32)
  )
    throw Error("Production requires a private worker secret.");
  if (
    env.NODE_ENV === "production" &&
    (!origin.startsWith("https://") || (env.WS_TICKET_SECRET?.length ?? 0) < 32)
  )
    throw Error("Production requires HTTPS and a strong ticket secret.");
  const illustrationModel = env.ILLUSTRATION_MODEL ?? "flux-2-klein-9b";
  const illustrationPrice = Number(env.ILLUSTRATION_REQUEST_COST_USD ?? "0");
  const illustrationDailyLimit = Number(env.ILLUSTRATION_DAILY_LIMIT ?? "10");
  const illustrationEnabled = env.ENABLE_ILLUSTRATIONS === "true";
  if (illustrationEnabled && (
    (env.ILLUSTRATION_PROVIDER ?? "bfl") !== "bfl" ||
    !["flux-2-klein-4b", "flux-2-klein-9b"].includes(illustrationModel) ||
    !["https://api.bfl.ai", "https://api.eu.bfl.ai", "https://api.us.bfl.ai"].includes(env.BFL_BASE_URL ?? "https://api.bfl.ai") ||
    !Number.isFinite(illustrationPrice) || illustrationPrice <= 0 || illustrationPrice > 0.1 ||
    !env.ILLUSTRATION_PRICE_VERSION?.trim() || env.ILLUSTRATION_PRICE_VERSION.length > 128 ||
    !Number.isInteger(illustrationDailyLimit) || illustrationDailyLimit < 1 || illustrationDailyLimit > 25
  )) throw Error("Illustrations require an approved BFL model, URL, versioned per-image price and daily limit.");
  const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const textModel = env.GEMINI_TEXT_MODEL ?? "gemini-3.8-flash";
  const liveModel = env.GEMINI_LIVE_MODEL ?? "gemini-3.8-live";
  const providerPolicy = {
    enabled: env.PAID_CALLS_ENABLED === "true",
    rates: parseRateTable(env.MODEL_UNIT_PRICES_JSON),
    limits: parseUnitLimits(env.MODEL_UNIT_LIMITS_JSON),
    ceilingUsd: Number(env.SPEND_CEILING_USD ?? 7.6),
  };
  const readiness = (model: string, kind: "text" | "live") => {
    if (mode !== "live") return { configured: false, reason: "fixture_mode" };
    if (!geminiKey) return { configured: false, reason: "credential_missing" };
    if (kind === "live" && env.ENABLE_LIVE !== "true") return { configured: false, reason: "voice_disabled" };
    const result = pricingReady(providerPolicy, model, kind);
    return { configured: result.allowed, reason: result.allowed ? "configured_account_access_unverified" : result.reason };
  };
  return {
    mode,
    devAuthBypass,
    devAuthUserId: env.DEV_AUTH_USER_ID,
    origin,
    apiOrigin: apiPublicOrigin ?? origin.replace(":3000", ":" + port),
    port,
    databaseUrl: env.DATABASE_URL,
    supabaseUrl: env.SUPABASE_URL,
    supabaseKey: env.SUPABASE_PUBLISHABLE_KEY,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    ticketSecret:
      env.WS_TICKET_SECRET ?? "local-fixture-secret-do-not-use-in-production",
    workerSecret:
      env.INTERNAL_WORKER_SECRET ?? "local-worker-development-secret",
    geminiKey,
    textModel,
    liveModel,
    providerReadiness: { text: readiness(textModel, "text"), voice: readiness(liveModel, "live") },
    live: env.ENABLE_LIVE === "true",
    paid: env.PAID_CALLS_ENABLED === "true",
    companion: env.ENABLE_COMPANION !== "false",
    maxSeconds: Math.min(1200, Number(env.SESSION_MAX_SECONDS ?? 1200)),
    dataDir: env.DATA_DIR ?? ".data",
    illustrations: {
      enabled: illustrationEnabled,
      key: env.BFL_API_KEY,
      model: illustrationModel,
      baseUrl: env.BFL_BASE_URL ?? "https://api.bfl.ai",
      priceUsd: illustrationPrice,
      priceVersion: env.ILLUSTRATION_PRICE_VERSION ?? "",
      dailyLimit: illustrationDailyLimit,
    },
  };
}
export type Config = ReturnType<typeof loadConfig>;
