/** A body limit is measured in received UTF-8 bytes, before decoding JSON. */
export class RequestBodyLimitError extends Error {
  constructor() {
    super("Request body exceeds its byte limit.");
    this.name = "RequestBodyLimitError";
  }
}

export async function readLimitedRequestText(request: Request, maxBytes: number) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength)
    || !Number.isSafeInteger(Number(declaredLength)) || Number(declaredLength) > maxBytes)) {
    throw new RequestBodyLimitError();
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) throw new RequestBodyLimitError();
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } catch (error) {
    // Stop an oversized or invalid stream without retaining the remaining body.
    try { await reader.cancel(); } catch { /* Preserve the original error. */ }
    throw error;
  } finally {
    reader.releaseLock();
  }
}
