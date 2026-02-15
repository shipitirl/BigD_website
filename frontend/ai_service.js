// frontend/ai_service.js

const API_URL = window.ENV?.BACKEND_URL || window.ENV?.API_BASE || "https://bigd-backend.vercel.app";

/**
 * Send a message to the chat API (non-streaming)
 */
export async function sendMessage({ sessionId, message }) {
  const res = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Send a message with streaming response
 * @param {Object} options
 * @param {string} options.sessionId - Current session ID
 * @param {string} options.message - User message
 * @param {function} options.onChunk - Called for each streamed chunk
 * @param {function} options.onDone - Called when streaming completes
 * @param {function} options.onError - Called on error
 */
export async function sendMessageStream({ sessionId, message, onChunk, onDone, onError }) {
  try {
    const res = await fetch(`${API_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message, stream: true }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error: ${res.status} ${text}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let resultSessionId = sessionId;
    let metadata = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || ""; // Keep incomplete message in buffer

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === "session") {
              resultSessionId = data.sessionId;
            } else if (data.type === "chunk") {
              onChunk?.(data.content);
            } else if (data.type === "done") {
              metadata = data;
            } else if (data.type === "error") {
              throw new Error(data.message);
            }
          } catch (e) {
            console.warn("Failed to parse SSE data:", line, e);
          }
        }
      }
    }

    onDone?.({
      sessionId: resultSessionId,
      readyForPhotos: metadata?.readyForPhotos,
      estimate: metadata?.estimate,
      collected: metadata?.collected,
    });

    return { sessionId: resultSessionId, metadata };
  } catch (err) {
    onError?.(err);
    throw err;
  }
}

/**
 * Upload photos to the backend
 */
export async function uploadPhotos({ sessionId, files }) {
  const formData = new FormData();
  formData.append("sessionId", sessionId);

  for (const file of files) {
    formData.append("photos", file);
  }

  const res = await fetch(`${API_URL}/api/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload error: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Finalize the intake and send notifications
 */
export async function finalize({ sessionId, contact }) {
  const res = await fetch(`${API_URL}/api/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, contact }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Finalize error: ${res.status} ${text}`);
  }

  return res.json();
}

// Export API URL for debugging
export const getApiUrl = () => API_URL;
