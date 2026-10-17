#!/usr/bin/env python3
"""Fetch a fresh application verification code from Gmail over IMAP SSL.

Credentials are read from GMAIL_USER/GMAIL_APP_PASSWORD or the ignored .env in
this checkout. The caller supplies the submission timestamp so stale codes from
other applications cannot be mistaken for the current challenge.
"""
import argparse
import email
import email.header
import email.utils
import imaplib
import json
import os
from pathlib import Path
import re
import sys
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent


def read_dotenv():
    path = ROOT / '.env'
    if not path.exists():
        return
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        value = value.strip().strip('"').strip("'")
        if key.strip() in ('GMAIL_USER', 'GMAIL_APP_PASSWORD'):
            os.environ.setdefault(key.strip(), value)


def decoded(value):
    parts = email.header.decode_header(value or '')
    return ''.join(part.decode(charset or 'utf-8', errors='replace') if isinstance(part, bytes) else str(part) for part, charset in parts)


def body_text(msg):
    chunks = []
    parts = msg.walk() if msg.is_multipart() else [msg]
    for part in parts:
        if part.get_content_type() not in ('text/plain', 'text/html'):
            continue
        if 'attachment' in str(part.get('Content-Disposition', '')).lower():
            continue
        payload = part.get_payload(decode=True)
        if payload:
            charset = part.get_content_charset() or 'utf-8'
            chunks.append(payload.decode(charset, errors='replace'))
    text = re.sub(r'<[^>]+>', ' ', '\n'.join(chunks))
    return re.sub(r'\s+', ' ', text).strip()


def internal_timestamp(fetch_response):
    """Return IMAP INTERNALDATE (server receipt time), never sender Date."""
    try:
        metadata = next(item[0] for item in fetch_response if isinstance(item, tuple) and item[0])
        match = re.search(rb'INTERNALDATE\s+"([^"]+)"', metadata, re.I)
        if not match:
            return None
        dt = email.utils.parsedate_to_datetime(match.group(1).decode('ascii'))
        return dt.timestamp()
    except Exception:
        return None


def extract_code(subject, body):
    text = re.sub(r'\s+', ' ', f'{subject} {body}')
    relevant = re.search(r'verification|security\s+code|one.time|passcode|application\s+code|confirm.{0,30}application', text, re.I)
    if not relevant:
        return None
    patterns = (
        # Some ATS providers (including Greenhouse) use mixed-case/alphanumeric
        # tokens and explicitly label the destination security-code field.
        r'(?:security\s+code\s+field|verification\s+code\s+field)[^:]{0,80}:\s*((?=[A-Z0-9]{4,10}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{4,10})\b',
        r'(?:verification|security|confirmation|one.time|login)\s+(?:verification\s+)?code\s*(?:is|:|-)?\s*((?=[A-Z0-9]{4,10}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{4,10})\b',
        r'(?:passcode|pin)\s*(?:is|:|-)?\s*((?=[A-Z0-9]{4,10}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{4,10})\b',
        r'(?:verification|security|confirmation|one.time|login)\s+(?:verification\s+)?code\s*(?:is|:|-)?\s*([0-9]{4,8})\b',
        r'(?:passcode|pin)\s*(?:is|:|-)?\s*([0-9]{4,8})\b',
        r'enter\s+(?:the\s+)?code\s+([0-9]{4,8})\b',
        r'\b([0-9]{6})\b',
    )
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            code = match.group(1)
            if len(code) == 4 and code.startswith('202'):
                continue
            return code
    return None


def fetch(args):
    read_dotenv()
    user = os.environ.get('GMAIL_USER', '').strip()
    password = os.environ.get('GMAIL_APP_PASSWORD', '').replace(' ', '').strip()
    if not user or not password:
        raise RuntimeError('Set GMAIL_USER and GMAIL_APP_PASSWORD in the environment or ignored .env file.')

    deadline = time.monotonic() + args.max_wait
    last_error = None
    while time.monotonic() < deadline:
        mail = None
        try:
            mail = imaplib.IMAP4_SSL('imap.gmail.com', 993, timeout=15)
            mail.login(user, password)
            mail.select('INBOX', readonly=True)
            status, data = mail.search(None, 'ALL')
            if status == 'OK' and data and data[0]:
                ids = data[0].split()[-40:]
                for msg_id in reversed(ids):
                    status, parts = mail.fetch(msg_id, '(INTERNALDATE RFC822)')
                    if status != 'OK' or not parts or not isinstance(parts[0], tuple):
                        continue
                    msg = email.message_from_bytes(parts[0][1])
                    received = internal_timestamp(parts)
                    age = time.time() - received if received is not None else None
                    if received is None or received < args.since_epoch or age < 0 or age > args.max_age_seconds:
                        continue
                    subject = decoded(msg.get('Subject', ''))
                    body = body_text(msg)
                    company = re.sub(r'[^a-z0-9]+', ' ', args.company.lower()).strip()
                    company = re.sub(r'\b(incorporated|inc|limited|ltd|llc|corp|corporation|plc)\b', ' ', company)
                    company = re.sub(r'\s+', ' ', company).strip()
                    if company and company != 'custom':
                        searchable = re.sub(r'[^a-z0-9]+', ' ', f'{subject} {body}'.lower())
                        if company not in searchable:
                            continue
                    code = extract_code(subject, body)
                    if code:
                        return {'code': code, 'subject': subject, 'from': decoded(msg.get('From', '')), 'received_epoch': received}
        except Exception as exc:
            last_error = str(exc)
        finally:
            if mail:
                try:
                    mail.logout()
                except Exception:
                    pass
        remaining = deadline - time.monotonic()
        if remaining > 0:
            time.sleep(min(args.interval, remaining))
    if last_error:
        print(f'IMAP check ended after an error: {last_error}', file=sys.stderr)
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--since-epoch', type=float, default=time.time())
    parser.add_argument('--max-wait', type=float, default=60)
    parser.add_argument('--interval', type=float, default=10)
    parser.add_argument('--max-age-seconds', type=float, default=300)
    parser.add_argument('--company', default='')
    args = parser.parse_args()
    try:
        result = fetch(args)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1
    if result:
        if args.json:
            print(json.dumps(result))
        else:
            print(f"CODE:{result['code']}")
        return 0
    print('No fresh verification code found before timeout.', file=sys.stderr)
    return 2


if __name__ == '__main__':
    raise SystemExit(main())
