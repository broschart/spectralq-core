"""
Übersetzungs-Modul
------------------
Verwendet deep_translator (GoogleTranslator) und langdetect.
Keine API-Keys erforderlich – nutzt die öffentliche Google-Translate-API.
"""

import logging
from deep_translator import GoogleTranslator
from langdetect import detect, LangDetectException

log = logging.getLogger(__name__)

# Zielsprachen für die Übersetzungs-Vorschläge
TARGET_LANGS: dict[str, tuple[str, str, str]] = {
    # code: (Anzeigename, Vorschlags-Geo, Flag-Emoji)
    "en":    ("Englisch",     "US", "🇺🇸"),
    "es":    ("Spanisch",     "ES", "🇪🇸"),
    "fr":    ("Französisch",  "FR", "🇫🇷"),
    "zh-CN": ("Chinesisch",   "CN", "🇨🇳"),
    "ru":    ("Russisch",     "RU", "🇷🇺"),
}

# Sprachcode → Anzeigename für die Spracherkennung
LANG_NAMES: dict[str, str] = {
    "de": "Deutsch", "en": "Englisch", "es": "Spanisch",
    "fr": "Französisch", "it": "Italienisch", "pt": "Portugiesisch",
    "nl": "Niederländisch", "pl": "Polnisch", "ru": "Russisch",
    "zh-cn": "Chinesisch", "zh-tw": "Chinesisch (Trad.)",
    "ja": "Japanisch", "ko": "Koreanisch", "tr": "Türkisch",
    "ar": "Arabisch",
}


def detect_language(text: str) -> str:
    """Erkennt die Sprache eines Textes. Gibt ISO-Code zurück (z.B. 'de', 'en')."""
    try:
        return detect(text)
    except LangDetectException:
        return "unknown"


def translate_to_targets(text: str) -> dict:
    """
    Übersetzt text in alle TARGET_LANGS.
    Gibt ein Dict zurück:
      {
        "en": {"text": "...", "name": "Englisch", "geo": "US", "flag": "🇺🇸"},
        ...
      }
    """
    results = {}
    for lang_code, (name, geo, flag) in TARGET_LANGS.items():
        try:
            translated = GoogleTranslator(source="auto", target=lang_code).translate(text)
            results[lang_code] = {
                "text": translated or "",
                "name": name,
                "geo": geo,
                "flag": flag,
            }
        except Exception as e:
            log.warning("Übersetzung fehlgeschlagen (%s → %s): %s", text, lang_code, e)
            results[lang_code] = {"text": "", "name": name, "geo": geo, "flag": flag}
    return results


def get_german_translation(text: str) -> str:
    """Übersetzt text ins Deutsche. Gibt leeren String bei Fehler zurück."""
    try:
        result = GoogleTranslator(source="auto", target="de").translate(text)
        return result or ""
    except Exception as e:
        log.warning("Deutsche Übersetzung fehlgeschlagen für '%s': %s", text, e)
        return ""
