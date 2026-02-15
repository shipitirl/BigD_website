// frontend/script.js

import { appState } from "./state.js";
import { sendMessage, sendMessageStream, uploadPhotos, finalize } from "./ai_service.js";

// Use streaming by default (feels faster)
const USE_STREAMING = true;

// DOM elements
const heroInput = document.getElementById("concernInput");
const chatInput = document.getElementById("chatInput");
const messagesEl = document.getElementById("chatMessages");
const photoSection = document.getElementById("photoSection");
const resultSection = document.getElementById("resultSection");
const chatInputArea = document.getElementById("chatInputArea");

// Photo upload state
let uploadedPhotos = [];

// ----------------------
// RENDERING
// ----------------------
function renderMessage(role, content, animate = true) {
  const div = document.createElement("div");
  div.className = `chat-message ${role === "user" ? "user" : "ai"}`;
  if (!animate) div.style.animation = "none";

  // Handle markdown-style formatting
  const formattedContent = escapeHtml(content)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n\* /g, "<br>• ")
    .replace(/\n/g, "<br>");

  div.innerHTML = `<div class="message-bubble">${formattedContent}</div>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function createStreamingMessage() {
  const div = document.createElement("div");
  div.className = "chat-message ai";
  div.innerHTML = `<div class="message-bubble"></div>`;
  messagesEl.appendChild(div);
  return div.querySelector(".message-bubble");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showTyping() {
  const typingDiv = document.createElement("div");
  typingDiv.className = "chat-message ai typing-indicator";
  typingDiv.id = "typingIndicator";
  typingDiv.innerHTML = `
    <div class="message-bubble">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>
  `;
  messagesEl.appendChild(typingDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function hideTyping() {
  const typing = document.getElementById("typingIndicator");
  if (typing) typing.remove();
}

// ----------------------
// CHAT UI
// ----------------------
function openChat() {
  const heroContent = document.querySelector(".hero-content");
  const heroResponse = document.getElementById("heroResponse");

  heroContent.style.opacity = "0";
  heroContent.style.transform = "translateY(-20px)";

  setTimeout(() => {
    heroResponse.classList.add("visible");
    chatInput?.focus();
  }, 300);
}

function closeChat() {
  const heroContent = document.querySelector(".hero-content");
  const heroResponse = document.getElementById("heroResponse");

  heroResponse.classList.remove("visible");

  setTimeout(() => {
    heroContent.style.opacity = "1";
    heroContent.style.transform = "translateY(0)";
    // Reset state
    appState.sessionId = null;
    appState.messages = [];
    messagesEl.innerHTML = "";
    photoSection?.classList.add("hidden");
    resultSection?.classList.add("hidden");
    chatInputArea?.classList.remove("hidden");
    uploadedPhotos = [];
  }, 300);
}

function transitionToPhotos() {
  chatInputArea?.classList.add("hidden");
  photoSection?.classList.remove("hidden");
}

function transitionToResult(result) {
  photoSection?.classList.add("hidden");

  const resultContent = document.getElementById("result-content");
  if (resultContent) {
    resultContent.innerHTML = `
      <div class="result-success-icon">✓</div>
      <h3 class="result-headline">${result.headline}</h3>
      <p class="result-message">${result.message}</p>
      <p class="result-subtext">${result.subtext}</p>
      <div class="result-contact">
        <p><a href="tel:2622150497" class="contact-link phone">📞 (262) 215-0497</a></p>
        <p><a href="mailto:shipithon@gmail.com" class="contact-link email">✉️ shipithon@gmail.com</a></p>
      </div>
    `;
  }

  resultSection?.classList.remove("hidden");
  resultSection?.classList.add("visible");
}

// ----------------------
// MESSAGE HANDLING
// ----------------------
async function handleSubmit(userText) {
  if (!userText.trim()) return;

  // Add user message
  appState.messages.push({ role: "user", content: userText });
  renderMessage("user", userText);

  if (USE_STREAMING) {
    // Streaming approach - feels faster
    const bubble = createStreamingMessage();
    let fullMessage = "";

    try {
      await sendMessageStream({
        sessionId: appState.sessionId,
        message: userText,
        onChunk: (chunk) => {
          fullMessage += chunk;
          // Format as we stream
          const formatted = escapeHtml(fullMessage)
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/\n\* /g, "<br>• ")
            .replace(/\n/g, "<br>");
          bubble.innerHTML = formatted;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        },
        onDone: (data) => {
          appState.sessionId = data.sessionId;
          appState.messages.push({ role: "assistant", content: fullMessage });

          // Handle ready for photos
          if (data.readyForPhotos) {
            setTimeout(() => transitionToPhotos(), 500);
          }
        },
        onError: (err) => {
          console.error("Stream error:", err);
          bubble.innerHTML = "Sorry - something went wrong. Please try again.";
        },
      });
    } catch (err) {
      console.error("Chat error:", err);
    }
  } else {
    // Non-streaming approach
    showTyping();

    try {
      const data = await sendMessage({
        sessionId: appState.sessionId,
        message: userText,
      });

      hideTyping();
      appState.sessionId = data.sessionId;
      appState.messages.push({ role: "assistant", content: data.assistantMessage });
      renderMessage("assistant", data.assistantMessage);

      if (data.readyForPhotos) {
        setTimeout(() => transitionToPhotos(), 500);
      }
    } catch (err) {
      hideTyping();
      renderMessage("assistant", "Sorry - something went wrong. Please try again.");
      console.error("Chat error:", err);
    }
  }
}

// ----------------------
// HERO FORM SUBMIT
// ----------------------
async function handleHeroSubmit() {
  const value = heroInput?.value.trim();
  if (!value) return;

  const btn = document.querySelector(".hero-form button");
  const originalText = btn?.textContent;
  if (btn) {
    btn.innerHTML = '<span class="loading-dots">Starting<span>.</span><span>.</span><span>.</span></span>';
    btn.disabled = true;
  }

  try {
    // Reset state
    appState.sessionId = null;
    appState.messages = [];
    messagesEl.innerHTML = "";
    uploadedPhotos = [];

    openChat();
    await handleSubmit(value);
  } finally {
    if (btn) {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }
}

// ----------------------
// CHAT INPUT SUBMIT
// ----------------------
async function sendUserMessage() {
  const value = chatInput?.value.trim();
  if (!value) return;

  chatInput.value = "";
  await handleSubmit(value);
}

// ----------------------
// PHOTO UPLOAD
// ----------------------
function initPhotoUpload() {
  const dropZone = document.getElementById("drop-zone");
  const photoInput = document.getElementById("photo-input");
  const previewGrid = document.getElementById("photo-previews");

  if (!dropZone || !photoInput) return;

  dropZone.addEventListener("click", (e) => {
    if (e.target.tagName !== "INPUT") {
      photoInput.click();
    }
  });

  photoInput.addEventListener("change", (e) => {
    handleFiles(e.target.files);
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    handleFiles(e.dataTransfer.files);
  });
}

function handleFiles(files) {
  const previewGrid = document.getElementById("photo-previews");
  const validFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
  const maxFiles = 10;
  const maxSize = 5 * 1024 * 1024;

  validFiles.forEach((file) => {
    if (uploadedPhotos.length >= maxFiles) return;
    if (file.size > maxSize) return;

    const photoId = `photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    uploadedPhotos.push({ id: photoId, file });

    const reader = new FileReader();
    reader.onload = (e) => {
      const wrapper = document.createElement("div");
      wrapper.className = "photo-preview";
      wrapper.id = photoId;
      wrapper.innerHTML = `
        <img src="${e.target.result}" alt="Photo preview">
        <button type="button" class="remove-photo" onclick="removePhoto('${photoId}')" aria-label="Remove photo">×</button>
      `;
      previewGrid.appendChild(wrapper);
      requestAnimationFrame(() => wrapper.classList.add("visible"));
      updatePhotoCounter();
    };
    reader.readAsDataURL(file);
  });
}

function removePhoto(photoId) {
  const index = uploadedPhotos.findIndex((p) => p.id === photoId);
  if (index > -1) uploadedPhotos.splice(index, 1);

  const wrapper = document.getElementById(photoId);
  if (wrapper) {
    wrapper.classList.add("removing");
    setTimeout(() => wrapper.remove(), 200);
  }
  updatePhotoCounter();
}

function updatePhotoCounter() {
  let counter = document.getElementById("photoCounter");
  const dropZone = document.getElementById("drop-zone");

  if (!counter && dropZone) {
    counter = document.createElement("div");
    counter.id = "photoCounter";
    counter.className = "photo-counter";
    dropZone.appendChild(counter);
  }

  if (counter) {
    const count = uploadedPhotos.length;
    counter.textContent = count > 0 ? `${count}/10 photos` : "";
    counter.classList.toggle("visible", count > 0);
    counter.classList.toggle("full", count >= 10);
  }
}

// ----------------------
// SUBMIT WITH PHOTOS
// ----------------------
async function submitWithPhotos() {
  const submitBtn = document.querySelector(".photo-section .btn-primary");
  const originalText = submitBtn?.textContent || "Submit Request";

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="loading-dots">Uploading<span>.</span><span>.</span><span>.</span></span>';
  }

  try {
    // Upload photos if any
    if (uploadedPhotos.length > 0) {
      const files = uploadedPhotos.map((p) => p.file);
      const uploadResult = await uploadPhotos({
        sessionId: appState.sessionId,
        files,
      });
      console.log("Photos uploaded:", uploadResult);
    }

    // Update button
    if (submitBtn) {
      submitBtn.innerHTML = '<span class="loading-dots">Finishing<span>.</span><span>.</span><span>.</span></span>';
    }

    // Finalize
    const result = await finalize({
      sessionId: appState.sessionId,
      contact: {}, // Contact info was collected in chat
    });

    console.log("Finalized:", result);

    // Show result
    transitionToResult({
      headline: "✅ Request Received!",
      message: "We'll review your request and contact you shortly.",
      subtext: "Check your phone or email for a confirmation message.",
    });

    // Reset state
    appState.sessionId = null;
    appState.messages = [];
    uploadedPhotos = [];
  } catch (err) {
    console.error("Submit error:", err);

    const photoSection = document.getElementById("photoSection");
    let errorEl = photoSection?.querySelector(".submit-error");

    if (!errorEl && photoSection) {
      errorEl = document.createElement("div");
      errorEl.className = "submit-error";
      photoSection.insertBefore(errorEl, submitBtn);
    }

    if (errorEl) {
      errorEl.innerHTML = `
        <span class="error-icon">⚠️</span>
        ${escapeHtml(err.message || "Something went wrong")}
        <br><small>Or call us at (262) 215-0497</small>
      `;
      errorEl.classList.add("visible");
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
}

// ----------------------
// INITIALIZATION
// ----------------------
document.addEventListener("DOMContentLoaded", () => {
  // Hero form
  const form = document.querySelector(".hero-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      handleHeroSubmit();
    });
  }

  // Chat input
  if (chatInput) {
    chatInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") sendUserMessage();
    });
  }

  // Send button
  const sendBtn = document.querySelector(".send-btn");
  if (sendBtn) {
    sendBtn.addEventListener("click", sendUserMessage);
  }

  // Photo upload
  initPhotoUpload();
});

// Expose functions globally for onclick handlers in HTML
window.handleHeroSubmit = handleHeroSubmit;
window.sendUserMessage = sendUserMessage;
window.closeChat = closeChat;
window.removePhoto = removePhoto;
window.submitWithPhotos = submitWithPhotos;
