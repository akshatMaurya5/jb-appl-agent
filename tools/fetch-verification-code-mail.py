#!/usr/bin/env python3
"""Find a fresh application verification code in the signed-in macOS Mail inbox.

Mail.app is the primary source. The caller supplies the exact submit timestamp;
messages older than that attempt, too old, future-dated, or not naming the target
company are never eligible. Gmail MCP is the caller's fallback after this helper
has polled for up to 120 seconds.
"""
import argparse
import json
import re
import subprocess
import sys
import time
from datetime import datetime
from html import unescape


APPLESCRIPT = r'''tell application "Mail"
  check for new mail
  set out to ""
  repeat with i from 1 to 10
    try
      set m to message i of inbox
      set s to (subject of m)
      set snd to (sender of m)
      set d to (date received of m as «class isot» as string)
      set c to (content of m)
      set out to out & s & "<|||>" & snd & "<|||>" & d & "<|||>" & c & "<===MSG===>"
    end try
  end repeat
  try
    set mb to first mailbox of account "Google" whose name is "All Mail"
    repeat with i from 1 to 10
      try
        set m to message i of mb
        set s to (subject of m)
        set snd to (sender of m)
        set d to (date received of m as «class isot» as string)
        set c to (content of m)
        set out to out & s & "<|||>" & snd & "<|||>" & d & "<|||>" & c & "<===MSG===>"
      end try
    end repeat
  end try
  return out
end tell'''


def extract_code(subject, body):
    text = re.sub(r'\s+', ' ', f'{subject} {body}')
    if not re.search(r'verification|security\s+code|one.time|passcode|application\s+code|confirm.{0,30}application', text, re.I):
        return None
    patterns = (
        r'(?:security\s+code\s+field|verification\s+code\s+field)[^:]{0,80}:\s*([A-Za-z0-9]{4,10})\b',
        r'(?:verification|security|confirmation|one.time|login)\s+(?:verification\s+)?code\s*(?:is|:|-)?\s*([A-Za-z0-9]{4,10})\b',
        r'(?:passcode|pin)\s*(?:is|:|-)?\s*([A-Za-z0-9]{4,10})\b',
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


def normalized_company(value):
    value = re.sub(r'[^a-z0-9]+', ' ', str(value or '').lower()).strip()
    value = re.sub(r'\b(incorporated|inc|limited|ltd|llc|corp|corporation|plc)\b', ' ', value)
    return re.sub(r'\s+', ' ', value).strip()


def read_mail_messages():
    result = subprocess.run(
        ['osascript', '-e', APPLESCRIPT],
        capture_output=True, text=True, timeout=15, check=False,
    )
    if result.returncode:
        detail = (result.stderr or 'Mail.app returned an error').strip().splitlines()[-1]
        raise RuntimeError(detail[:240])
    messages = []
    for item in result.stdout.strip().split("<===MSG===>"):
        if not item.strip():
            continue
        parts = item.split("<|||>")
        if len(parts) >= 4:
            subj, sender, date_str, body = parts[0], parts[1], parts[2], parts[3]
            try:
                epoch = datetime.fromisoformat(date_str).timestamp()
            except Exception:
                epoch = time.time()
            messages.append({
                'subject': subj,
                'sender': sender,
                'received_epoch': epoch,
                'body': body[:16000]
            })
    return messages


def find_code(messages, since_epoch, max_age_seconds, company):
    company_key = normalized_company(company)
    for message in messages:
        try:
            received = float(message.get('received_epoch'))
        except (TypeError, ValueError):
            continue
        age = time.time() - received
        if received < since_epoch or age < 0 or age > max_age_seconds:
            continue
        subject = str(message.get('subject') or '')
        body = unescape(re.sub(r'<[^>]+>', ' ', str(message.get('body') or '')))
        searchable = re.sub(r'[^a-z0-9]+', ' ', f'{subject} {body}'.lower())
        if company_key and company_key != 'custom' and f' {company_key} ' not in f' {searchable} ':
            continue
        code = extract_code(subject, body)
        if code:
            return {
                'code': code,
                'subject': subject,
                'from': str(message.get('sender') or ''),
                'received_epoch': received,
                'source': 'macos-mail',
            }
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--since-epoch', type=float, required=True)
    parser.add_argument('--max-wait', type=float, default=120)
    parser.add_argument('--interval', type=float, default=10)
    parser.add_argument('--max-age-seconds', type=float, default=300)
    parser.add_argument('--company', default='')
    args = parser.parse_args()

    deadline = time.monotonic() + args.max_wait
    last_error = None
    while True:
        try:
            code = find_code(read_mail_messages(), args.since_epoch, args.max_age_seconds, args.company)
            if code:
                if args.json:
                    print(json.dumps(code))
                else:
                    print(f"CODE:{code['code']}")
                return 0
            last_error = None
        except Exception as exc:
            last_error = str(exc)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(args.interval, remaining))

    if last_error:
        print(f'Desktop Mail lookup ended without a fresh code: {last_error}', file=sys.stderr)
    else:
        print('No fresh company-matched verification code found in Mail.app before timeout.', file=sys.stderr)
    return 2


if __name__ == '__main__':
    raise SystemExit(main())
