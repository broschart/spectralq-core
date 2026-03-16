"""Shared LLM helper — kapselt den Multi-Provider-Aufruf.

Verwendung in AI-Plugins:

    from plugins.ai._llm import call_llm, get_ai_settings, check_quota

    settings = get_ai_settings(user_id)
    ok, used, limit = check_quota(user_id)
    result = call_llm(prompt, settings, max_tokens=2048)
    # result = {"ok": True, "text": "...", "model": "anthropic/claude-..."}
    # oder:   {"ok": False, "error": "...", "status": 502}
"""

import os, logging

log = logging.getLogger(__name__)

_ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")


# ── Settings ────────────────────────────────────────────────────────────────

def get_ai_settings(user_id):
    """Gibt dict mit ai_provider, ai_model und API-Keys zurück."""
    from models import AppSetting, User
    user = User.query.get(user_id)
    is_admin = user.is_superadmin if user else False
    can_own = user.can_use_own_apis if user else False
    _uid = user_id if (not is_admin and can_own) else None

    def _resolve(key, default=""):
        from app import _resolve_api_key
        return _resolve_api_key(key, default, user_id=_uid, is_admin=is_admin)

    return {
        "ai_provider": _resolve("ai_provider", "anthropic"),
        "ai_model": _resolve("ai_model", "claude-haiku-4-5-20251001"),
        "resolve": _resolve,
        "user_id": user_id,
    }


def check_quota(user_id):
    """Prüft LLM-Kontingent. Gibt (ok, used, limit) zurück."""
    from app import _check_llm_quota
    return _check_llm_quota(user_id)


def increment_usage(user_id, source="", detail=""):
    """Inkrementiert den monatlichen LLM-Call-Zähler."""
    from app import _increment_llm_usage
    _increment_llm_usage(user_id, source=source, detail=detail)


# ── LLM-Aufruf ─────────────────────────────────────────────────────────────

def call_llm(prompt_or_messages, settings, *, max_tokens=2048,
             system=None, tools=None):
    """Ruft das konfigurierte LLM auf.

    Args:
        prompt_or_messages: Entweder ein String (einzelner Prompt) oder eine
            Liste von Messages [{role, content}, ...].
        settings: Dict von get_ai_settings().
        max_tokens: Maximale Tokens.
        system: Optionaler System-Prompt (nur für Chat-Messages).
        tools: Optionale Tool-Liste (Anthropic-Format). Bei OpenAI wird
            automatisch konvertiert.

    Returns:
        dict mit keys:
            ok (bool), text (str), model (str)
            — oder —
            ok (bool), error (str), status (int)
            — bei tool_use (nur Anthropic/OpenAI) —
            ok (bool), tool_uses (list), content (list), stop_reason (str), model (str)
    """
    import requests as _req

    resolve = settings["resolve"]
    provider = settings["ai_provider"]
    model = settings["ai_model"]
    model_label = f"{provider}/{model}"

    # Messages normalisieren
    if isinstance(prompt_or_messages, str):
        messages = [{"role": "user", "content": prompt_or_messages}]
    else:
        messages = prompt_or_messages

    try:
        if provider == "anthropic":
            return _call_anthropic(resolve, model, messages, max_tokens,
                                   system, tools, model_label)
        elif provider == "openai":
            return _call_openai(resolve, model, messages, max_tokens,
                                system, tools, model_label)
        elif provider == "gemini":
            return _call_gemini(resolve, model, messages, max_tokens,
                                system, model_label)
        elif provider == "mistral":
            return _call_mistral(resolve, model, messages, max_tokens,
                                 system, model_label)
        else:
            return {"ok": False, "error": f"Unbekannter Anbieter: {provider}",
                    "status": 400}
    except Exception as exc:
        log.error("LLM-Aufruf Fehler (%s): %s", provider, exc)
        return {"ok": False, "error": str(exc), "status": 502}


# ── Provider-Implementierungen ──────────────────────────────────────────────

def _call_anthropic(resolve, model, messages, max_tokens, system, tools,
                    model_label):
    import requests as _req
    api_key = resolve("anthropic_api_key", _ANTHROPIC_KEY)
    if not api_key:
        return {"ok": False, "status": 503,
                "error": "Anthropic API-Schlüssel nicht konfiguriert. "
                         "Bitte den Administrator kontaktieren oder eigenen "
                         "API-Key in den Einstellungen hinterlegen."}
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": messages,
    }
    if system:
        payload["system"] = system
    if tools:
        payload["tools"] = tools

    resp = _req.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json=payload,
        timeout=120,
    )
    if not resp.ok:
        return _error_response("Anthropic", resp)

    result = resp.json()
    content = result.get("content", [])
    stop_reason = result.get("stop_reason", "end_turn")
    tool_uses = [b for b in content if b.get("type") == "tool_use"]

    if tool_uses and stop_reason != "end_turn":
        return {"ok": True, "tool_uses": tool_uses, "content": content,
                "stop_reason": stop_reason, "model": model_label}

    text = "\n".join(b.get("text", "") for b in content
                     if b.get("type") == "text")
    return {"ok": True, "text": text, "model": model_label}


def _call_openai(resolve, model, messages, max_tokens, system, tools,
                 model_label):
    import requests as _req
    api_key = resolve("openai_api_key", "")
    if not api_key:
        return {"ok": False, "status": 503,
                "error": "OpenAI API-Schlüssel nicht konfiguriert. "
                         "Bitte den Administrator kontaktieren oder eigenen "
                         "API-Key in den Einstellungen hinterlegen."}
    oai_messages = []
    if system:
        oai_messages.append({"role": "system", "content": system})
    oai_messages.extend(messages)

    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": oai_messages,
    }
    if tools:
        payload["tools"] = _tools_to_oai(tools)

    resp = _req.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=120,
    )
    if not resp.ok:
        return _error_response("OpenAI", resp)

    choice = resp.json()["choices"][0]
    msg_obj = choice["message"]
    finish = choice.get("finish_reason", "stop")
    tool_calls = msg_obj.get("tool_calls") or []

    if tool_calls and finish != "stop":
        return {"ok": True, "tool_calls": tool_calls, "msg_obj": msg_obj,
                "stop_reason": finish, "model": model_label}

    return {"ok": True, "text": msg_obj.get("content") or "",
            "model": model_label}


def _call_gemini(resolve, model, messages, max_tokens, system, model_label):
    import requests as _req
    api_key = resolve("gemini_api_key", "")
    if not api_key:
        return {"ok": False, "status": 503,
                "error": "Google Gemini API-Schlüssel nicht konfiguriert. "
                         "Bitte den Administrator kontaktieren oder eigenen "
                         "API-Key in den Einstellungen hinterlegen."}
    gemini_contents = []
    if system:
        gemini_contents.append(
            {"role": "user", "parts": [{"text": system}]})
        gemini_contents.append(
            {"role": "model",
             "parts": [{"text": "Verstanden. Ich stehe bereit."}]})
    for m in messages:
        gemini_contents.append({
            "role": "user" if m["role"] == "user" else "model",
            "parts": [{"text": m["content"]}],
        })
    resp = _req.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={api_key}",
        headers={"Content-Type": "application/json"},
        json={
            "contents": gemini_contents,
            "generationConfig": {"maxOutputTokens": max_tokens},
        },
        timeout=120,
    )
    if not resp.ok:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text
        return {"ok": False, "status": 502,
                "error": f"Gemini API {resp.status_code}: {detail}"}

    text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
    return {"ok": True, "text": text, "model": model_label}


def _call_mistral(resolve, model, messages, max_tokens, system, model_label):
    import requests as _req
    api_key = resolve("mistral_api_key", "")
    if not api_key:
        return {"ok": False, "status": 503,
                "error": "Mistral AI API-Schlüssel nicht konfiguriert. "
                         "Bitte den Administrator kontaktieren oder eigenen "
                         "API-Key in den Einstellungen hinterlegen."}
    mistral_messages = []
    if system:
        mistral_messages.append({"role": "system", "content": system})
    mistral_messages.extend(messages)

    resp = _req.post(
        "https://api.mistral.ai/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": max_tokens,
            "messages": mistral_messages,
        },
        timeout=120,
    )
    if not resp.ok:
        return _error_response("Mistral", resp)

    text = resp.json()["choices"][0]["message"]["content"]
    return {"ok": True, "text": text, "model": model_label}


# ── Hilfsfunktionen ─────────────────────────────────────────────────────────

def _error_response(provider, resp):
    """Einheitliche Fehlerbehandlung für HTTP-Antworten."""
    try:
        detail = resp.json()
    except Exception:
        detail = resp.text
    if isinstance(detail, dict):
        msg = detail.get("error", {}).get("message", str(detail))
    else:
        msg = str(detail)
    return {"ok": False, "status": 502,
            "error": f"{provider} API {resp.status_code}: {msg}"}


def _tools_to_oai(tools):
    """Konvertiert Anthropic-Format Tools zu OpenAI-Format."""
    return [
        {"type": "function", "function": {
            "name": t["name"],
            "description": t["description"],
            "parameters": t["input_schema"],
        }}
        for t in tools
    ]
