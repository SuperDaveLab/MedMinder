interface JsonErrorPayload {
  message?: string
}

function looksLikeHtml(contentType: string, text: string): boolean {
  const normalizedType = contentType.toLowerCase()
  const normalizedText = text.trimStart().toLowerCase()

  return normalizedType.includes('text/html') || normalizedText.startsWith('<!doctype html') || normalizedText.startsWith('<html')
}

function buildNonJsonErrorMessage(response: Response, bodyText: string): string {
  if (looksLikeHtml(response.headers.get('content-type') ?? '', bodyText)) {
    return 'API returned HTML instead of JSON. This usually means this domain is serving the web app for /api routes. Verify reverse-proxy rules for /api on this domain or set VITE_API_BASE_URL to the API origin.'
  }

  return `API returned a non-JSON response (status ${String(response.status)}).`
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  const rawBodyText = await response.text()

  if (!rawBodyText) {
    return undefined as T
  }

  try {
    return JSON.parse(rawBodyText) as T
  } catch {
    throw new Error(buildNonJsonErrorMessage(response, rawBodyText))
  }
}

export async function getJsonErrorMessage(response: Response): Promise<string> {
  const fallbackMessage = `Request failed (${String(response.status)})`

  let payload: JsonErrorPayload | null = null
  try {
    payload = await parseJsonResponse<JsonErrorPayload>(response)
  } catch (error) {
    if (error instanceof Error) {
      return error.message
    }

    return fallbackMessage
  }

  return payload?.message?.trim() ? payload.message : fallbackMessage
}
