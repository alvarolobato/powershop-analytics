/**
 * OpenRouter catalog fetcher + in-process cache.
 *
 * Lives in a sibling module (not in `route.ts`) because Next.js App
 * Router rejects any non-handler exports from a route file. The route
 * imports `getCachedCatalog()` and `resetCatalogCache()` from here.
 */

export interface OpenRouterRawPricing {
  prompt?: string | null;
  completion?: string | null;
  request?: string | null;
  image?: string | null;
  input_cache_read?: string | null;
  input_cache_write?: string | null;
}

export interface OpenRouterRawArchitecture {
  modality?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  tokenizer?: string;
}

export interface OpenRouterRawModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: OpenRouterRawPricing;
  architecture?: OpenRouterRawArchitecture;
  supported_parameters?: string[];
}

interface OpenRouterRawCatalog {
  data: OpenRouterRawModel[];
}

export interface OpenRouterModel {
  id: string;
  name: string;
  description: string;
  context_length: number;
  /** USD per 1M prompt tokens. `null` if pricing is missing. */
  prompt_price_per_1m: number | null;
  /** USD per 1M completion tokens. `null` if pricing is missing. */
  completion_price_per_1m: number | null;
  modality: string;
  /** True iff the model advertises "tools" in supported_parameters. The
   *  agentic dashboard flows require this. */
  supports_tools: boolean;
  /** Belongs to the curated "Populares" set — pin to the top of the UI. */
  popular: boolean;
}

export interface CatalogPayload {
  models: OpenRouterModel[];
  fetchedAt: number;
  source: "openrouter" | "cache";
}

// ---------------------------------------------------------------------------
// Curated popular set
// ---------------------------------------------------------------------------

// Hand-picked canonical ids. The order here is the order they appear in
// the UI's "Populares" section. Items not present in the live catalog are
// silently dropped.
export const POPULAR_IDS: readonly string[] = [
  "anthropic/claude-opus-4",
  "anthropic/claude-sonnet-4",
  "anthropic/claude-haiku-4",
  "anthropic/claude-3.5-sonnet",
  "openai/gpt-5",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "openai/o3-mini",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
  "deepseek/deepseek-r1",
  "deepseek/deepseek-v3",
  "meta-llama/llama-4-maverick",
  "meta-llama/llama-3.3-70b-instruct",
  "mistralai/mistral-large",
  "x-ai/grok-4",
];

const POPULAR_SET: ReadonlySet<string> = new Set(POPULAR_IDS);

// ---------------------------------------------------------------------------
// Cache (in-process, 1 h TTL)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  models: OpenRouterModel[];
  fetchedAt: number;
}

let cache: CacheEntry | null = null;

/** Test-only hook to clear the cache between assertions. */
export function resetCatalogCache(): void {
  cache = null;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function priceFromPerToken(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n * 1_000_000;
}

export function normalize(raw: OpenRouterRawModel): OpenRouterModel {
  const supportsTools = (raw.supported_parameters ?? []).includes("tools");
  const description = (raw.description ?? "").trim();
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    // Trim long descriptions — full text isn't useful in a picker row.
    description: description.length > 220 ? description.slice(0, 217) + "…" : description,
    context_length: typeof raw.context_length === "number" ? raw.context_length : 0,
    prompt_price_per_1m: priceFromPerToken(raw.pricing?.prompt),
    completion_price_per_1m: priceFromPerToken(raw.pricing?.completion),
    modality: raw.architecture?.modality ?? "text->text",
    supports_tools: supportsTools,
    popular: POPULAR_SET.has(raw.id),
  };
}

async function fetchCatalog(): Promise<OpenRouterModel[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`OpenRouter /models returned ${res.status}`);
  }
  const json = (await res.json()) as OpenRouterRawCatalog;
  if (!Array.isArray(json.data)) {
    throw new Error("OpenRouter /models returned unexpected shape (no data array)");
  }
  return json.data.map(normalize);
}

/**
 * Returns the catalog, hitting the cache when fresh and falling back to
 * a stale cache if the upstream request fails. Throws only when no cache
 * exists at all *and* the fetch fails.
 */
export async function getCachedCatalog(): Promise<CatalogPayload> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { models: cache.models, fetchedAt: cache.fetchedAt, source: "cache" };
  }
  try {
    const models = await fetchCatalog();
    cache = { models, fetchedAt: now };
    return { models, fetchedAt: now, source: "openrouter" };
  } catch (err) {
    if (cache) {
      return { models: cache.models, fetchedAt: cache.fetchedAt, source: "cache" };
    }
    throw err;
  }
}
