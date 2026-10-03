"""Persona JSON parsing — ported from woid's agent-sandbox/woid-core/persona/parse.js.

LLMs wrap persona JSON in noise (code fences, preambles, trailing prose, multi-object
emissions). These helpers defensively extract the first bracket-balanced JSON object
and sanitize the standard fields. `about` is load-bearing; the rest are optional.
"""
import json
import re

_NAME_TRIM = re.compile(r'^[\s"\'“”‘’`]+|[\s"\'“”‘’`]+$')
_NAME_KV = re.compile(r'^(name|character|persona)\s*[:=]', re.I)
_FENCE = re.compile(r'```(?:json)?\s*([\s\S]*?)```', re.I)


def sanitize_name(raw):
    s = re.sub(r'\s+', ' ', _NAME_TRIM.sub('', str(raw or ''))).strip()
    if len(s) < 2 or len(s) > 40:
        return ''
    if _NAME_KV.match(s):
        return ''
    return s


def trim_tag(raw):
    if not isinstance(raw, str):
        return None
    s = re.sub(r'\.\s*$', '', raw.strip())
    if not s:
        return None
    return (s[:46].strip() + '…') if len(s) > 48 else s


def extract_first_json_object(raw):
    """Walk forward from each `{` until a bracket-balanced, string-aware `}`. First
    successful parse wins — tolerates trailing prose and `}` inside string literals."""
    n = len(raw)
    for i in range(n):
        if raw[i] != '{':
            continue
        depth = 0
        in_str = False
        esc = False
        for j in range(i, n):
            ch = raw[j]
            if in_str:
                if esc:
                    esc = False
                elif ch == '\\':
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(raw[i:j + 1])
                    except Exception:
                        break
    return None


def parse_persona_json(raw):
    """Strip ```json fences, bracket-balance-extract, sanitize. Raises ValueError if no
    parseable JSON or no `about`."""
    raw = str(raw or '')
    m = _FENCE.search(raw)
    candidate = (m.group(1) if m else raw).strip()
    parsed = extract_first_json_object(candidate)
    if not isinstance(parsed, dict):
        raise ValueError('model did not return a parseable JSON object')
    name = sanitize_name(parsed.get('name') or parsed.get('callSign') or '')
    about_raw = parsed.get('about')
    about = (about_raw.strip() if isinstance(about_raw, str) else '')[:1000]
    if not about:
        raise ValueError('model did not return an about')
    return {
        'name': name or None,
        'about': about,
        'avatar_hint': str(parsed.get('avatar_hint') or parsed.get('avatarHint') or '')[:200],
        'vibe': str(parsed.get('vibe') or '')[:40],
        'specialty': trim_tag(parsed.get('specialty') or parsed.get('role') or parsed.get('job')),
        'personality': trim_tag(parsed.get('personality') or parsed.get('personalityTag')),
    }
