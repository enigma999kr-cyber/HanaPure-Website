import "server-only";

import {
  isPublicId,
  normalizeOperationalProduct,
  OperationalSourceError,
  type ErpOperationalSource,
  type OperationalReadOptions,
} from "./product-operational";

/**
 * Unit 2A INTERNAL contract, not an assertion about a deployed gateway/ERP API.
 * GET /v1/products/{publicId}/operational (one UUID; no caller-provided paths).
 * 200 JSON: { version: "1", product: { public_id, retail_price_huf,
 *   sellable_stock, operational_ready } }
 * 404 JSON: { version: "1", public_id, error: { code: "product_not_found" } }
 * 503 JSON may signal "temporarily_busy" or "erp_read_unavailable" with the
 * same error envelope. Other upstream errors do not imply business absence.
 * HQ must reconcile this internal seam with the approved gateway before hookup.
 * No production instance, env/credential, endpoint call, or UI consumer exists.
 */
export const OPERATIONAL_CONTRACT_VERSION = "1";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TIMEOUT_MS = 30_000;

export type GatewayAuthProvider = (
  signal: AbortSignal,
) => HeadersInit | Promise<HeadersInit>;

export type HttpsOperationalConfig = Readonly<{
  /** Fixed origin only: HTTPS, no embedded credential/path/query/fragment. */
  gatewayOrigin: string;
  /** Whole operation deadline, including auth, headers, and body. */
  timeoutMs: number;
  authHeaders: GatewayAuthProvider;
  expectedContractVersion?: string;
}>;

export type HttpsOperationalDependencies = Readonly<{ fetch?: typeof fetch }>;

function fail(code: ConstructorParameters<typeof OperationalSourceError>[0]): never {
  throw new OperationalSourceError(code);
}

function configuredOrigin(config: HttpsOperationalConfig | undefined): string {
  if (
    !config || typeof config.gatewayOrigin !== "string" ||
    !Number.isInteger(config.timeoutMs) || config.timeoutMs <= 0 ||
    config.timeoutMs > MAX_TIMEOUT_MS || typeof config.authHeaders !== "function" ||
    (config.expectedContractVersion !== undefined &&
      config.expectedContractVersion !== OPERATIONAL_CONTRACT_VERSION)
  ) fail("configuration_error");
  let url: URL;
  try { url = new URL(config.gatewayOrigin); } catch { fail("configuration_error"); }
  if (
    url.protocol !== "https:" || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash
  ) fail("configuration_error");
  return url.origin;
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const mediaType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") fail("malformed_response");
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    fail("malformed_response");
  }
  if (!response.body) fail("malformed_response");
  const reader = response.body.getReader();
  const cancelBody = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancelBody, { once: true });
  if (signal.aborted) cancelBody();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) fail("malformed_response");
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof OperationalSourceError) throw error;
    fail("network_error");
  } finally {
    signal.removeEventListener("abort", cancelBody);
    // Do not let an uncooperative stream's cancellation extend the deadline.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (signal.aborted) fail("cancelled");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { fail("malformed_response"); }
}

function envelope(data: unknown, publicId: string): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) fail("contract_mismatch");
  const value = data as Record<string, unknown>;
  if (value.version !== OPERATIONAL_CONTRACT_VERSION) fail("contract_mismatch");
  if (value.public_id !== undefined && value.public_id !== publicId) fail("contract_mismatch");
  return value;
}

async function requestProduct(
  publicId: string,
  origin: string,
  config: HttpsOperationalConfig,
  send: typeof fetch,
  signal: AbortSignal,
): Promise<unknown> {
  let headers: Headers;
  try {
    headers = new Headers(await config.authHeaders(signal));
    if (![...headers].length) fail("authentication_error");
  } catch { fail("authentication_error"); }
  if (signal.aborted) fail("cancelled");
  // Auth may supply generic service headers but cannot change routing/framing.
  for (const name of ["host", "connection", "content-length", "transfer-encoding"]) {
    if (headers.has(name)) fail("configuration_error");
  }
  headers.set("accept", "application/json");
  headers.set("cache-control", "no-store");
  let response: Response;
  try {
    response = await send(`${origin}/v1/products/${publicId}/operational`, {
      method: "GET", headers, signal, cache: "no-store", redirect: "error",
      credentials: "omit",
    });
  } catch { fail("network_error"); }
  try {
    if (signal.aborted) fail("cancelled");
    if (response.status === 401 || response.status === 403) fail("authentication_error");
    if (response.status === 429) fail("rate_limited");
    if (response.status >= 300 && response.status < 400) fail("upstream_unavailable");
    if (response.status !== 200 && response.status !== 404 && response.status !== 503) {
      fail("upstream_unavailable");
    }
    const data = envelope(await readJson(response, signal), publicId);
    if (response.status !== 200) {
      // HTTP status alone never establishes business absence or ERP read errors.
      const error = data.error;
      if (data.public_id !== publicId || typeof error !== "object" ||
        error === null || Array.isArray(error) || "product" in data) fail("contract_mismatch");
      const code = (error as Record<string, unknown>).code;
      if (response.status === 404 && code === "product_not_found") fail("product_not_found");
      if (response.status === 503 && (code === "temporarily_busy" || code === "erp_read_unavailable")) fail(code);
      fail("upstream_unavailable");
    }
    if ("error" in data) fail("contract_mismatch");
    const result = normalizeOperationalProduct(data.product);
    if (!result.ok || result.product.publicId !== publicId) fail("contract_mismatch");
    // Return only the four validated ERP fields to the existing domain adapter.
    return {
      public_id: result.product.publicId,
      retail_price_huf: result.product.basePriceHuf,
      sellable_stock: result.product.sellableStock,
      operational_ready: result.product.operationalReady,
    };
  } finally {
    void response.body?.cancel().catch(() => {});
  }
}

export function createHttpsOperationalSource(
  config?: HttpsOperationalConfig,
  dependencies: HttpsOperationalDependencies = {},
): ErpOperationalSource {
  // Snapshot trusted config; no mutable per-call origin or caller URL forwarding.
  const settings = config ? { ...config } : undefined;
  return {
    async readProduct(publicId: string, options?: OperationalReadOptions): Promise<unknown> {
      const origin = configuredOrigin(settings);
      if (!isPublicId(publicId)) fail("contract_mismatch");
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort: () => void = () => {};
      const stopped = new Promise<never>((_, reject) => {
        const stop = (code: "timeout" | "cancelled") => {
          reject(new OperationalSourceError(code));
          controller.abort();
        };
        abort = () => stop("cancelled");
        options?.signal?.addEventListener("abort", abort, { once: true });
        if (options?.signal?.aborted) abort();
        timer = setTimeout(() => stop("timeout"), settings!.timeoutMs);
      });
      try {
        if (controller.signal.aborted) return await stopped;
        return await Promise.race([
          stopped,
          requestProduct(publicId, origin, settings!, dependencies.fetch ?? fetch, controller.signal),
        ]);
      } catch (error) {
        if (error instanceof OperationalSourceError) throw error;
        fail("source_internal_error");
      } finally {
        clearTimeout(timer);
        options?.signal?.removeEventListener("abort", abort);
        controller.abort();
      }
    },
  };
}
