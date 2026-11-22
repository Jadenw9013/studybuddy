export const serviceUnavailableMessage =
  "The study service is unavailable right now. Please try again later.";

/** Cancellation is intentional; proxy pages and transport diagnostics are not
 * useful product messages and must never become a fabricated API response. */
export function throwServiceUnavailable(error?: unknown): never {
  if (error && typeof error === "object" && "name" in error && error.name === "AbortError")
    throw error;
  throw new Error(serviceUnavailableMessage);
}

export async function fetchApiResponse(input: RequestInfo | URL, init?: RequestInit) {
  try {
    return await fetch(input, init);
  } catch (error) {
    throwServiceUnavailable(error);
  }
}

export async function readApiJson(
  response: Pick<Response, "ok" | "json">,
  fallback = "This action could not finish.",
): Promise<any> {
  let data: any;
  try {
    data = await response.json();
  } catch (error) {
    throwServiceUnavailable(error);
  }
  if (!response.ok)
    throw new Error(
      typeof data?.message === "string" && data.message.trim() ? data.message : fallback,
    );
  if (data === null || typeof data !== "object") throwServiceUnavailable();
  return data;
}

export function parseApiStreamEvent(line: string): any {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch (error) {
    throwServiceUnavailable(error);
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) throwServiceUnavailable();
  return event;
}
