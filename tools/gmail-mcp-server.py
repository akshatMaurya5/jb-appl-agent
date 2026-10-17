#!/usr/bin/env python3
"""
gmail-mcp-server.py — Ultra-lightweight Gmail MCP Server for Antigravity & LLM tools.
Speaks standard Model Context Protocol (MCP) JSON-RPC 2.0 over Stdio.

Zero external dependencies — standard library Python only.
Exposes:
  - get_job_verification_code: Fetches latest OTP/verification code from Greenhouse, Ashby, etc.
  - check_recent_emails: Reads the latest email subjects/senders for job application tracking.
"""

import sys
import json
import os
import email
from email.header import decode_header
import email.utils
from datetime import datetime, timezone
import imaplib
import re
import time
from pathlib import Path

def log(msg):
    print(f"[gmail-mcp] {msg}", file=sys.stderr, flush=True)

def clean_subject(raw_subject):
    if not raw_subject:
        return ""
    try:
        decoded_parts = decode_header(raw_subject)
        result = ""
        for part, enc in decoded_parts:
            if isinstance(part, bytes):
                result += part.decode(enc or "utf-8", errors="ignore")
            else:
                result += str(part)
        return result
    except Exception:
        return str(raw_subject)

def get_email_body(msg):
    body = ""
    try:
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                content_disp = str(part.get("Content-Disposition"))
                if content_type in ["text/plain", "text/html"] and "attachment" not in content_disp:
                    payload = part.get_payload(decode=True)
                    if payload:
                        body += payload.decode(errors="ignore") + "\n"
        else:
            payload = msg.get_payload(decode=True)
            if payload:
                body = payload.decode(errors="ignore")
    except Exception:
        pass
    return body

def parse_internal_date(fetch_response):
    """Parse IMAP server receipt time; the sender-controlled Date header is insufficient for OTP freshness."""
    try:
        metadata = next(item[0] for item in fetch_response if isinstance(item, tuple) and item[0])
        match = re.search(rb'INTERNALDATE\s+"([^"]+)"', metadata, re.IGNORECASE)
        if not match:
            return None
        return email.utils.parsedate_to_datetime(match.group(1).decode("ascii"))
    except Exception:
        return None

def extract_code_from_text(text):
    clean_text = re.sub(r'<[^>]+>', ' ', text)
    clean_text = re.sub(r'\s+', ' ', clean_text)
    
    patterns = [
        r'(?:security\s+code\s+field|verification\s+code\s+field)[^:]{0,80}:\s*((?=[A-Z0-9]{4,10}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{4,10})\b',
        r'(?:verification|security|confirmation|one-time|login)\s+(?:verification\s+)?code\s+(?:is|:)?\s*((?=[A-Z0-9]{4,10}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{4,10})\b',
        r'(?:passcode|pin|code)\s*(?:is|:)?\s*((?=[A-Z0-9]{4,10}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{4,10})\b',
        r'(?:verification|security|confirmation|one-time|login)\s+code\s+(?:is|:)?\s*([0-9]{4,8})\b',
        r'(?:passcode|pin|code)\s*(?:is|:)\s*([0-9]{4,8})\b',
        r'enter\s+([0-9]{4,8})\s+to\s+verify\b',
        r'use\s+([0-9]{4,8})\s+as\s+your\s+verification\b',
        r'code\s+([0-9]{6})\b',
        r'\b([0-9]{6})\b',
    ]
    for pat in patterns:
        m = re.search(pat, clean_text, re.IGNORECASE)
        if m:
            code = m.group(1)
            if len(code) == 4 and code.startswith("202"):
                continue
            return code
    return None

def get_credentials():
    user = os.environ.get("GMAIL_USER", "")
    pw = os.environ.get("GMAIL_APP_PASSWORD", "")
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip().strip('"').strip("'")
            if key.strip() == "GMAIL_APP_PASSWORD" and not pw:
                pw = value
            elif key.strip() == "GMAIL_USER" and not user:
                user = value
    return user, pw.replace(" ", "").strip()

def tool_get_verification_code(args):
    timeout_sec = min(180, max(1, int(args.get("timeout_seconds", 60))))
    max_age_sec = min(900, max(30, int(args.get("max_age_seconds", 300))))
    since_epoch = float(args.get("since_epoch", time.time()))
    company = re.sub(r"[^a-z0-9]+", " ", str(args.get("company", "")).lower()).strip()
    company = re.sub(r"\b(incorporated|inc|limited|ltd|llc|corp|corporation|plc)\b", " ", company)
    company = re.sub(r"\s+", " ", company).strip()
    user, pw = get_credentials()
    
    if not user or not pw:
        return "Error: GMAIL_USER and GMAIL_APP_PASSWORD must be set in the environment or local .env file."
        
    start_time = time.time()
    while time.time() - start_time < timeout_sec:
        mail = None
        try:
            mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
            mail.login(user, pw)
            mail.select("INBOX")
            
            status, messages = mail.search(None, 'ALL')
            if status == "OK" and messages[0]:
                mail_ids = messages[0].split()
                for mid in reversed(mail_ids[-15:]):
                    status, data = mail.fetch(mid, "(INTERNALDATE RFC822)")
                    if status != "OK" or not data or not data[0]:
                        continue
                    msg = email.message_from_bytes(data[0][1])
                    msg_date = parse_internal_date(data)
                    if not msg_date:
                        continue
                    received = msg_date.timestamp()
                    age = time.time() - received
                    if received < since_epoch or age < 0 or age > max_age_sec:
                        continue
                        
                    subject = clean_subject(msg.get("Subject", ""))
                    body = get_email_body(msg)
                    full_text = f"{subject}\n{body}"
                    if company and company != "custom":
                        searchable = re.sub(r"[^a-z0-9]+", " ", full_text.lower())
                        if f" {company} " not in f" {searchable} ":
                            continue
                    
                    keywords = ["verification", "verify", "code", "greenhouse", "ashby", "one-time", "passcode", "pin"]
                    if any(kw in full_text.lower() for kw in keywords):
                        code = extract_code_from_text(full_text)
                        if code:
                            mail.logout()
                            return f"Verification Code: {code}\nSubject: {subject}\nSender: {msg.get('From', '')}\nAge: {round(age, 1)}s ago"
            mail.logout()
        except Exception as e:
            log(f"IMAP poll error: {e}")
            if mail:
                try:
                    mail.logout()
                except Exception:
                    pass
        time.sleep(10)
        
    return "No verification code email found within timeout. Please ensure the verification email was requested and sent to " + user

def tool_check_recent_emails(args):
    limit = min(args.get("limit", 5), 10)
    user, pw = get_credentials()
    if not pw:
        return "Error: GMAIL_APP_PASSWORD is not set in environment or career-ops/.env."
        
    mail = None
    try:
        mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
        mail.login(user, pw)
        mail.select("INBOX")
        status, messages = mail.search(None, 'ALL')
        if status != "OK" or not messages[0]:
            mail.logout()
            return "Inbox empty or unreadable."
            
        mail_ids = messages[0].split()
        results = []
        for mid in reversed(mail_ids[-limit:]):
            status, data = mail.fetch(mid, "(RFC822)")
            if status != "OK" or not data or not data[0]:
                continue
            msg = email.message_from_bytes(data[0][1])
            subject = clean_subject(msg.get("Subject", ""))
            from_ = msg.get("From", "")
            date_ = msg.get("Date", "")
            results.append(f"• From: {from_}\n  Subject: {subject}\n  Date: {date_}")
            
        mail.logout()
        return "\n\n".join(results) if results else "No recent emails found."
    except Exception as e:
        return f"Error connecting to Gmail: {e}"

TOOLS = [
    {
        "name": "get_job_verification_code",
        "description": "Polls Gmail for a fresh application verification code. Supply company and since_epoch from the current submit attempt to avoid stale or unrelated codes.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "timeout_seconds": {
                    "type": "number",
                    "description": "Maximum seconds to wait and poll for the code to arrive (default: 30)."
                },
                "max_age_seconds": {
                    "type": "number",
                    "description": "Maximum age of the email in seconds (default: 300 / 5 minutes)."
                },
                "since_epoch": {
                    "type": "number",
                    "description": "Unix timestamp immediately before submitting the application; only messages received after this time are eligible."
                },
                "company": {
                    "type": "string",
                    "description": "Company name shown in the application email subject/body; when supplied, unrelated companies are ignored."
                }
            },
            "required": []
        }
    },
    {
        "name": "check_recent_emails",
        "description": "Reads the latest emails from your Gmail inbox (useful for tracking recruiter updates, application status, and interview invites).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "number",
                    "description": "Number of recent emails to retrieve (1-10, default: 5)."
                }
            },
            "required": []
        }
    }
]

def handle_message(req):
    req_id = req.get("id")
    method = req.get("method")
    
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {}
                },
                "serverInfo": {
                    "name": "gmail-verification-mcp",
                    "version": "1.0.0"
                }
            }
        }
    elif method == "notifications/initialized":
        return None
    elif method == "ping":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {}
        }
    elif method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "tools": TOOLS
            }
        }
    elif method == "tools/call":
        params = req.get("params", {})
        tool_name = params.get("name")
        tool_args = params.get("arguments", {})
        
        if tool_name == "get_job_verification_code":
            text = tool_get_verification_code(tool_args)
        elif tool_name == "check_recent_emails":
            text = tool_check_recent_emails(tool_args)
        else:
            text = f"Unknown tool: {tool_name}"
            
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "content": [
                    {
                        "type": "text",
                        "text": text
                    }
                ]
            }
        }
    else:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {
                "code": -32601,
                "message": f"Method not found: {method}"
            }
        }

def main():
    log("Gmail Verification MCP Server started over Stdio.")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            res = handle_message(req)
            if res is not None:
                sys.stdout.write(json.dumps(res) + "\n")
                sys.stdout.flush()
        except Exception as e:
            log(f"Error handling request: {e}")

if __name__ == "__main__":
    main()
