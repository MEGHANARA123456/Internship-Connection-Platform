import asyncio
from datetime import datetime, timezone
import json
import logging
import os
import re
from typing import Any
import uuid

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

logger = logging.getLogger("mailpit")

# In-memory storage with optional disk persistence
MESSAGES: list[dict[str, Any]] = []
STORAGE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "storage")
STORAGE_FILE = os.path.join(STORAGE_DIR, "mailpit_messages.json")


def load_messages_from_disk():
    global MESSAGES
    try:
        if os.path.exists(STORAGE_FILE):
            with open(STORAGE_FILE, "r", encoding="utf-8") as f:
                MESSAGES = json.load(f)
    except Exception as e:
        logger.warning("Could not load mailpit messages from disk: %s", e)


def save_messages_to_disk():
    try:
        os.makedirs(STORAGE_DIR, exist_ok=True)
        with open(STORAGE_FILE, "w", encoding="utf-8") as f:
            json.dump(MESSAGES[:200], f, indent=2)
    except Exception as e:
        logger.warning("Could not persist mailpit messages to disk: %s", e)


load_messages_from_disk()

mailpit_app = FastAPI(title="Mailpit - InternSphere Mailbox", version="1.0.0")

mailpit_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class EmailRecipient(BaseModel):
    Email: str
    Name: str | None = None


class SendEmailPayload(BaseModel):
    From: EmailRecipient | dict[str, Any]
    To: list[EmailRecipient] | list[dict[str, Any]]
    Subject: str
    Text: str | None = None
    HTML: str | None = None


def extract_otp(text: str) -> str | None:
    # Looks for a 6-digit numeric OTP code
    match = re.search(r"\b([0-9]{6})\b", text)
    return match.group(1) if match else None


@mailpit_app.post("/api/v1/send")
async def send_message(payload: SendEmailPayload):
    msg_id = f"msg-{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()

    # Normalize from
    from_dict = payload.From.model_dump() if hasattr(payload.From, "model_dump") else payload.From
    from_addr = from_dict.get("Email", "noreply@internship.local")
    from_name = from_dict.get("Name", "Internship Platform")

    # Normalize to
    recipients = []
    for r in payload.To:
        r_dict = r.model_dump() if hasattr(r, "model_dump") else r
        recipients.append({
            "Address": r_dict.get("Email", "").strip().lower(),
            "Name": r_dict.get("Name", "")
        })

    text_content = payload.Text or ""
    html_content = payload.HTML or f"<pre style='font-family: inherit;'>{text_content}</pre>"
    otp_code = extract_otp(text_content) or extract_otp(payload.Subject)

    msg_obj = {
        "ID": msg_id,
        "Created": now,
        "From": {"Address": from_addr, "Name": from_name},
        "To": recipients,
        "Subject": payload.Subject,
        "Text": text_content,
        "HTML": html_content,
        "Snippet": (text_content[:120] + "...") if len(text_content) > 120 else text_content,
        "OTP": otp_code,
    }

    # Insert at beginning so newest is first
    MESSAGES.insert(0, msg_obj)
    save_messages_to_disk()
    return {"ID": msg_id, "status": "sent"}


@mailpit_app.get("/api/v1/messages")
async def get_messages(
    search: str | None = Query(None),
    to: str | None = Query(None),
    limit: int = 100,
):
    filtered = MESSAGES
    filter_email = (to or search or "").strip().lower()

    if filter_email:
        filtered = [
            m for m in MESSAGES
            if any(filter_email in r.get("Address", "").lower() for r in m.get("To", []))
            or filter_email in m.get("Subject", "").lower()
            or filter_email in m.get("Text", "").lower()
        ]

    # Return Mailpit-compatible message summaries
    summaries = []
    for m in filtered[:limit]:
        summaries.append({
            "ID": m["ID"],
            "Created": m["Created"],
            "From": m["From"],
            "To": m["To"],
            "Subject": m["Subject"],
            "Snippet": m["Snippet"],
            "OTP": m.get("OTP"),
        })

    # Collect distinct recipient addresses for easy 1-click user filtering
    recipients = {}
    for m in MESSAGES:
        for r in m.get("To", []):
            addr = r.get("Address")
            if addr:
                recipients[addr] = recipients.get(addr, 0) + 1

    return {
        "total": len(filtered),
        "messages": summaries,
        "recipients": [{"email": k, "count": v} for k, v in sorted(recipients.items(), key=lambda x: -x[1])],
    }


@mailpit_app.get("/api/v1/message/{msg_id}")
async def get_message(msg_id: str):
    for m in MESSAGES:
        if m["ID"] == msg_id:
            return m
    raise HTTPException(status_code=404, detail="Message not found")


@mailpit_app.delete("/api/v1/messages")
async def clear_messages():
    global MESSAGES
    MESSAGES.clear()
    save_messages_to_disk()
    return {"status": "cleared"}


@mailpit_app.delete("/api/v1/message/{msg_id}")
async def delete_message(msg_id: str):
    global MESSAGES
    MESSAGES = [m for m in MESSAGES if m["ID"] != msg_id]
    save_messages_to_disk()
    return {"status": "deleted"}


# Webmail UI on GET /
@mailpit_app.get("/", response_class=HTMLResponse)
@mailpit_app.get("/index.html", response_class=HTMLResponse)
async def web_ui():
    html_content = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mailpit • InternSphere Mailbox</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%236366f1'><path d='M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z'/></svg>">
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --accent: #10b981;
      --danger: #ef4444;
      --otp-bg: #312e81;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    header {
      background: var(--card-bg);
      border-bottom: 1px solid var(--border);
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 1.1rem;
      letter-spacing: -0.02em;
    }
    .brand-badge {
      background: var(--primary);
      color: #fff;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 999px;
      font-weight: 600;
    }
    .live-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 8px var(--accent);
      display: inline-block;
      margin-right: 4px;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .btn {
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 8px;
      padding: 7px 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .btn:hover { background: var(--primary-hover); }
    .btn-outline {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-muted);
    }
    .btn-outline:hover {
      background: rgba(255,255,255,0.05);
      color: var(--text);
      border-color: #64748b;
    }
    .btn-danger {
      background: transparent;
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #f87171;
    }
    .btn-danger:hover {
      background: rgba(239, 68, 68, 0.1);
      border-color: var(--danger);
    }
    /* Filter Bar for "View My Mails Only" */
    .filter-bar {
      background: rgba(30, 41, 59, 0.7);
      border-bottom: 1px solid var(--border);
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .filter-left {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      max-width: 550px;
    }
    .search-input {
      background: #0f172a;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 7px 12px;
      border-radius: 8px;
      font-size: 12px;
      width: 100%;
      outline: none;
      transition: border-color 0.15s;
    }
    .search-input:focus {
      border-color: var(--primary);
    }
    .user-chips {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow-x: auto;
      max-width: 600px;
    }
    .chip {
      background: #0f172a;
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;
    }
    .chip:hover, .chip.active {
      background: var(--primary);
      color: #fff;
      border-color: var(--primary);
    }
    /* Main Layout */
    .main-container {
      display: flex;
      flex: 1;
      min-height: 0;
    }
    .sidebar {
      width: 380px;
      border-right: 1px solid var(--border);
      background: var(--card-bg);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }
    .message-item {
      padding: 14px 16px;
      border-bottom: 1px solid rgba(51, 65, 85, 0.6);
      cursor: pointer;
      transition: background 0.1s ease;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .message-item:hover {
      background: rgba(255, 255, 255, 0.03);
    }
    .message-item.active {
      background: rgba(99, 102, 241, 0.15);
      border-left: 3px solid var(--primary);
    }
    .message-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .message-to {
      font-size: 11px;
      color: var(--primary);
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .message-time {
      font-size: 10px;
      color: var(--text-muted);
      white-space: nowrap;
    }
    .message-subject {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      line-height: 1.3;
    }
    .message-snippet {
      font-size: 11px;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .otp-tag {
      display: inline-block;
      background: #047857;
      color: #ecfdf5;
      font-weight: 700;
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 4px;
      align-self: flex-start;
      margin-top: 3px;
    }
    /* Detail View */
    .detail-view {
      flex: 1;
      overflow-y: auto;
      padding: 30px;
      background: #090d16;
      display: flex;
      flex-direction: column;
    }
    .empty-state {
      margin: auto;
      text-align: center;
      color: var(--text-muted);
      max-width: 320px;
    }
    .empty-icon {
      font-size: 48px;
      margin-bottom: 12px;
      opacity: 0.5;
    }
    /* Email Detail Card */
    .email-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.3);
    }
    .email-meta {
      border-bottom: 1px solid var(--border);
      padding-bottom: 16px;
      margin-bottom: 20px;
    }
    .email-subject {
      font-size: 1.3rem;
      font-weight: 700;
      margin-bottom: 12px;
      line-height: 1.25;
    }
    .meta-row {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .meta-label { font-weight: 600; width: 45px; }
    .badge {
      background: rgba(255,255,255,0.06);
      padding: 2px 8px;
      border-radius: 6px;
      color: var(--text);
      font-weight: 500;
    }
    /* OTP Highlight Box */
    .otp-banner {
      background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%);
      border: 1px solid #4338ca;
      border-radius: 10px;
      padding: 18px 22px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .otp-info h4 {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #a5b4fc;
      margin-bottom: 4px;
    }
    .otp-code {
      font-size: 32px;
      font-weight: 800;
      letter-spacing: 0.15em;
      color: #ffffff;
      font-family: monospace;
      text-shadow: 0 0 12px rgba(165, 180, 252, 0.4);
    }
    .otp-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .btn-copy {
      background: #4f46e5;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-copy:hover { background: #4338ca; }
    .btn-link {
      background: #10b981;
      color: white;
      text-decoration: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      display: inline-block;
    }
    .btn-link:hover { background: #059669; }
    .email-body {
      line-height: 1.6;
      font-size: 13px;
      color: #cbd5e1;
      white-space: pre-wrap;
      font-family: inherit;
      background: #0f172a;
      padding: 16px;
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    /* Mobile Responsiveness */
    @media (max-width: 768px) {
      .main-container { flex-direction: column; }
      .sidebar { width: 100%; height: 260px; }
      .detail-view { padding: 16px; }
      .otp-banner { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span>✉️ Mailpit</span>
      <span class="brand-badge">InternSphere</span>
      <span style="font-size: 12px; color: var(--text-muted); font-weight: normal;">
        <span class="live-dot"></span>Online (Port 8025)
      </span>
    </div>
    <div class="header-actions">
      <a href="http://localhost:5174/login" target="_blank" class="btn btn-outline">
        Open Internship Platform ↗
      </a>
      <button class="btn btn-danger" onclick="clearAllMessages()">
        Clear All Mails
      </button>
    </div>
  </header>

  <!-- Filter Bar: "View My Mails Only" -->
  <div class="filter-bar">
    <div class="filter-left">
      <input
        id="searchInput"
        class="search-input"
        type="text"
        placeholder="🔍 View My Mails Only: enter your email (e.g. user@gmail.com)"
        oninput="handleSearch(this.value)"
      >
      <button class="btn btn-outline" style="padding: 6px 10px;" onclick="clearFilter()">
        Clear
      </button>
    </div>

    <!-- Quick recipient chips -->
    <div class="user-chips" id="recipientChips">
      <!-- Injected via JS -->
    </div>
  </div>

  <div class="main-container">
    <!-- Message List Sidebar -->
    <div class="sidebar" id="messageList">
      <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 12px;">
        Listening for incoming notifications...
      </div>
    </div>

    <!-- Message Detail View -->
    <div class="detail-view" id="messageDetail">
      <div class="empty-state">
        <div class="empty-icon">📫</div>
        <h3 style="font-size: 15px; font-weight: 600; margin-bottom: 6px;">No message selected</h3>
        <p style="font-size: 12px;">Select an email from the left sidebar to read its content and copy verification OTPs.</p>
      </div>
    </div>
  </div>

  <script>
    let currentFilter = '';
    let selectedMsgId = null;
    let allMessages = [];

    async function fetchMessages() {
      try {
        const url = currentFilter
          ? `/api/v1/messages?to=${encodeURIComponent(currentFilter)}`
          : '/api/v1/messages';
        const res = await fetch(url);
        const data = await res.json();
        allMessages = data.messages || [];

        renderRecipientChips(data.recipients || []);
        renderMessageList(allMessages);

        if (selectedMsgId) {
          const exists = allMessages.find(m => m.ID === selectedMsgId);
          if (exists) loadMessageDetail(selectedMsgId, false);
        } else if (allMessages.length > 0 && window.innerWidth > 768) {
          loadMessageDetail(allMessages[0].ID, false);
        }
      } catch (err) {
        console.error('Error fetching messages:', err);
      }
    }

    function renderRecipientChips(recipients) {
      const container = document.getElementById('recipientChips');
      if (!recipients || recipients.length === 0) {
        container.innerHTML = '<span style="font-size: 11px; color: var(--text-muted);">No recipients yet</span>';
        return;
      }
      container.innerHTML = `
        <span style="font-size: 11px; color: var(--text-muted); font-weight: 600;">Filter:</span>
        <button class="chip ${!currentFilter ? 'active' : ''}" onclick="applyFilter('')">All Mails</button>
      ` + recipients.map(r => `
        <button class="chip ${currentFilter === r.email ? 'active' : ''}" onclick="applyFilter('${r.email}')">
          👤 ${r.email} (${r.count})
        </button>
      `).join('');
    }

    function renderMessageList(messages) {
      const container = document.getElementById('messageList');
      if (messages.length === 0) {
        container.innerHTML = `
          <div style="padding: 30px 20px; text-align: center; color: var(--text-muted); font-size: 12px;">
            ${currentFilter ? `No emails found for <strong>${currentFilter}</strong>` : 'No messages received yet.<br><br>Trigger a password reset or registration to see emails arrive here.'}
          </div>
        `;
        return;
      }

      container.innerHTML = messages.map(m => {
        const toAddress = (m.To && m.To[0]) ? m.To[0].Address : 'Recipient';
        const dateStr = new Date(m.Created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const isActive = m.ID === selectedMsgId;

        return `
          <div class="message-item ${isActive ? 'active' : ''}" onclick="loadMessageDetail('${m.ID}')">
            <div class="message-header">
              <span class="message-to">To: ${toAddress}</span>
              <span class="message-time">${dateStr}</span>
            </div>
            <div class="message-subject">${escapeHtml(m.Subject)}</div>
            <div class="message-snippet">${escapeHtml(m.Snippet || '')}</div>
            ${m.OTP ? `<span class="otp-tag">OTP: ${m.OTP}</span>` : ''}
          </div>
        `;
      }).join('');
    }

    async function loadMessageDetail(msgId, updateSelected = true) {
      if (updateSelected) selectedMsgId = msgId;
      try {
        const res = await fetch(`/api/v1/message/${msgId}`);
        if (!res.ok) return;
        const msg = await res.json();

        const container = document.getElementById('messageDetail');
        const toAddresses = (msg.To || []).map(t => t.Address).join(', ');
        const dateStr = new Date(msg.Created).toLocaleString();

        let otpHtml = '';
        if (msg.OTP) {
          otpHtml = `
            <div class="otp-banner">
              <div class="otp-info">
                <h4>Verification OTP Code</h4>
                <div class="otp-code">${msg.OTP}</div>
              </div>
              <div class="otp-actions">
                <button class="btn-copy" onclick="copyToClipboard('${msg.OTP}')">📋 Copy OTP</button>
                <a href="http://localhost:5174/reset-password?email=${encodeURIComponent(toAddresses)}&otp=${msg.OTP}" target="_blank" class="btn-link">
                  Open Password Reset Page ↗
                </a>
              </div>
            </div>
          `;
        }

        container.innerHTML = `
          <div class="email-card">
            <div class="email-meta">
              <div class="email-subject">${escapeHtml(msg.Subject)}</div>
              <div class="meta-row">
                <span class="meta-label">From:</span>
                <span class="badge">${escapeHtml(msg.From.Name || '')} &lt;${escapeHtml(msg.From.Address)}&gt;</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">To:</span>
                <span class="badge">${escapeHtml(toAddresses)}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">Date:</span>
                <span>${dateStr}</span>
              </div>
            </div>

            ${otpHtml}

            <div class="email-body">${escapeHtml(msg.Text || '')}</div>
          </div>
        `;

        // Update active class in sidebar
        const items = document.querySelectorAll('.message-item');
        items.forEach(el => el.classList.remove('active'));
      } catch (err) {
        console.error('Failed to load message detail:', err);
      }
    }

    function applyFilter(email) {
      currentFilter = email;
      document.getElementById('searchInput').value = email;
      fetchMessages();
    }

    function handleSearch(val) {
      currentFilter = val.trim();
      fetchMessages();
    }

    function clearFilter() {
      currentFilter = '';
      document.getElementById('searchInput').value = '';
      fetchMessages();
    }

    async function clearAllMessages() {
      if (!confirm('Are you sure you want to clear all emails?')) return;
      await fetch('/api/v1/messages', { method: 'DELETE' });
      selectedMsgId = null;
      document.getElementById('messageDetail').innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📫</div>
          <h3 style="font-size: 15px; font-weight: 600; margin-bottom: 6px;">Inbox Cleared</h3>
          <p style="font-size: 12px;">All emails have been deleted.</p>
        </div>
      `;
      fetchMessages();
    }

    function copyToClipboard(text) {
      navigator.clipboard.writeText(text).then(() => {
        alert('OTP ' + text + ' copied to clipboard!');
      });
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/[&<>"']/g, function (m) {
        return {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#039;'
        }[m];
      });
    }

    // Auto-refresh every 3 seconds for new live emails
    fetchMessages();
    setInterval(fetchMessages, 3000);
  </script>
</body>
</html>
"""
    return HTMLResponse(content=html_content)


def start_mailpit_service(host: str = "0.0.0.0", port: int = 8025):
    import uvicorn
    uvicorn.run(mailpit_app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    start_mailpit_service()
