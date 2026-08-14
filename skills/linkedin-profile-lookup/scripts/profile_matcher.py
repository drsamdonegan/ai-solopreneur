#!/usr/bin/env python3
"""Build search parameters and rank LinkedIn-style profile candidates safely.

This module contains no network code and no credentials. Pass a callable that
wraps the separately configured people-search helper. Run with ``--self-test``
to exercise the matching logic without contacting a service.
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections.abc import Callable, Mapping, Sequence
from typing import Any


PUBLIC_FIELDS = (
    "name",
    "linkedin_url",
    "headline",
    "current_company",
    "current_title",
    "location",
    "industry",
    "public_identifier",
    "summary",
)

FREE_EMAIL_DOMAINS = {
    "gmail.com",
    "googlemail.com",
    "hotmail.com",
    "icloud.com",
    "live.com",
    "me.com",
    "outlook.com",
    "proton.me",
    "protonmail.com",
    "yahoo.com",
}

NAME_PREFIXES = {"dr", "doctor", "mr", "mrs", "ms", "miss", "prof", "professor"}
NAME_SUFFIXES = {"cem", "do", "dds", "dmd", "esq", "fgia", "jd", "md", "phd"}
INDUSTRY_STOP = {
    "and",
    "business",
    "company",
    "industry",
    "professional",
    "sector",
    "service",
    "services",
}

AUSTRALIAN_CAPITAL_REGIONS = {
    "adelaide": "South Australia",
    "brisbane": "Queensland",
    "canberra": "Australian Capital Territory",
    "darwin": "Northern Territory",
    "hobart": "Tasmania",
    "melbourne": "Victoria",
    "perth": "Western Australia",
    "sydney": "New South Wales",
}

HONORIFIC_ALIASES = {
    "doctor": "dr",
    "dr": "dr",
    "prof": "prof",
    "professor": "prof",
}


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _normalise(value: Any) -> str:
    text = unicodedata.normalize("NFKD", _text(value))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", text.casefold()).strip()


def _normalise_name(value: Any) -> str:
    tokens = _normalise(value).split()
    while tokens and tokens[0] in NAME_PREFIXES:
        tokens.pop(0)
    while tokens and tokens[-1] in NAME_SUFFIXES:
        tokens.pop()
    return " ".join(tokens)


def _requested_honorific(value: Any) -> str:
    tokens = _normalise(value).split()
    return HONORIFIC_ALIASES.get(tokens[0], "") if tokens else ""


def _inferred_region(parsed: Mapping[str, str]) -> str:
    if "australia" not in _normalise(parsed.get("country_region")):
        return ""
    return AUSTRALIAN_CAPITAL_REGIONS.get(
        _normalise(parsed.get("city_location")), ""
    )


def _industry_terms(value: Any) -> list[str]:
    terms = [
        _normalise(part)
        for part in re.split(r"[,;/|]+|\band\b", _text(value), flags=re.IGNORECASE)
    ]
    return [
        term
        for term in terms
        if len(term) >= 3 and term not in INDUSTRY_STOP
    ][:4]


def _mask_email(email: str) -> str:
    if "@" not in email:
        return ""
    local, domain = email.rsplit("@", 1)
    visible = local[:1]
    return f"{visible}{'*' * max(3, len(local) - 1)}@{domain}"


def _email_domain(email: str) -> str:
    if email.count("@") != 1:
        return ""
    local, domain = email.rsplit("@", 1)
    domain = domain.casefold().strip(". ")
    if not local or "." not in domain or not re.fullmatch(r"[a-z0-9.-]+", domain):
        return ""
    return domain


def parse_input(params: Mapping[str, Any]) -> dict[str, str]:
    parsed = {
        key: _text(params.get(key, ""))
        for key in (
            "email_address",
            "full_name",
            "country_region",
            "state_province",
            "city_location",
            "industry",
        )
    }
    if not parsed["email_address"] and not parsed["full_name"]:
        raise ValueError("Provide a full name or an email address.")
    if parsed["email_address"] and not _email_domain(parsed["email_address"]):
        raise ValueError("The email address is not valid.")
    return parsed


def build_search_params(parsed: Mapping[str, str]) -> dict[str, Any]:
    full_name = _text(parsed.get("full_name"))
    if not full_name:
        raise ValueError(
            "Email-only lookup is unavailable through the people-search helper; "
            "connect an approved reverse-email lookup tool."
        )

    name_parts = full_name.split()
    while name_parts and _normalise(name_parts[0]) in NAME_PREFIXES:
        name_parts.pop(0)
    if len(name_parts) < 2:
        raise ValueError("Provide the person's first and last name.")
    search_params: dict[str, Any] = {
        "search_type": "Performance optimized",
        "LIMIT": 10,
        "FIRST_NAME": name_parts[0],
    }
    if len(name_parts) > 1:
        search_params["LAST_NAME"] = " ".join(name_parts[1:])

    regions = [
        _text(parsed.get("city_location")),
        _text(parsed.get("state_province")),
        _inferred_region(parsed),
        _text(parsed.get("country_region")),
    ]
    regions = list(dict.fromkeys(value for value in regions if value))
    if regions:
        search_params["REGION"] = regions

    # Keep industry as ranking evidence. Provider-side industry taxonomies are
    # often narrower than a user's wording and can exclude the correct person
    # before the matcher gets a chance to compare candidates.
    return search_params


def _field(profile: Mapping[str, Any], key: str) -> str:
    value = profile.get(key)
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        return ", ".join(_text(item) for item in value if _text(item))
    if isinstance(value, Mapping):
        for nested_key in ("raw", "full_location", "name", "value"):
            nested = _text(value.get(nested_key))
            if nested:
                return nested
    return ""


def _public_profile(profile: Mapping[str, Any]) -> dict[str, Any]:
    safe = {key: _field(profile, key) or None for key in PUBLIC_FIELDS}
    professional_name = _field(profile, "professional_network_name")
    if professional_name:
        safe["name"] = professional_name
    return {key: value for key, value in safe.items() if value is not None}


def _candidate_text(profile: Mapping[str, Any], *keys: str) -> str:
    return " ".join(_normalise(_field(profile, key)) for key in keys).strip()


def score_profile(profile: Mapping[str, Any], parsed: Mapping[str, str]) -> dict[str, Any]:
    score = 0
    evidence: list[str] = []
    contradictions: list[str] = []

    expected_name = _normalise_name(parsed.get("full_name"))
    raw_actual_name = (
        _field(profile, "professional_network_name") or _field(profile, "name")
    )
    actual_name = _normalise_name(raw_actual_name)
    if expected_name and actual_name:
        if expected_name == actual_name:
            score += 54
            evidence.append("exact core name")
        elif set(expected_name.split()) == set(actual_name.split()):
            score += 50
            evidence.append("same name tokens")
        elif set(expected_name.split()).issubset(set(actual_name.split())):
            score += 40
            evidence.append("partial name")
        else:
            contradictions.append("name differs")

    requested_honorific = _requested_honorific(parsed.get("full_name"))
    actual_name_tokens = set(_normalise(raw_actual_name).split())
    if requested_honorific and (
        requested_honorific in actual_name_tokens
        or (requested_honorific == "dr" and "doctor" in actual_name_tokens)
        or (requested_honorific == "prof" and "professor" in actual_name_tokens)
    ):
        score += 36
        evidence.append("requested professional title")

    location = _candidate_text(profile, "location")
    inferred_region = _normalise(_inferred_region(parsed))
    city_matches_metro_region = bool(inferred_region and inferred_region in location)
    for field, points, mismatch_penalty, label in (
        ("city_location", 10, 12, "city"),
        ("state_province", 8, 8, "state or province"),
        ("country_region", 6, 10, "country or region"),
    ):
        expected = _normalise(parsed.get(field))
        if expected and location:
            if expected in location:
                score += points
                evidence.append(label)
            elif field != "city_location" or not city_matches_metro_region:
                score -= mismatch_penalty
                contradictions.append(f"{label} differs")
    if not _text(parsed.get("state_province")) and city_matches_metro_region:
        score += 8
        evidence.append("metropolitan region")

    industry_terms = _industry_terms(parsed.get("industry"))
    industry_text = _candidate_text(
        profile,
        "industry",
        "headline",
        "current_company",
        "current_title",
        "summary",
    )
    if industry_terms and industry_text:
        matched_industries = [term for term in industry_terms if term in industry_text]
        if matched_industries:
            score += 10
            evidence.append("industry or professional context")
        else:
            score -= 6
            contradictions.append("industry differs")

    domain = _email_domain(_text(parsed.get("email_address")))
    if domain and domain not in FREE_EMAIL_DOMAINS:
        domain_stem = _normalise(domain.split(".", 1)[0])
        employer_text = _candidate_text(profile, "current_company", "headline")
        if len(domain_stem) >= 3 and domain_stem in employer_text:
            score += 12
            evidence.append("business email domain resembles employer")

    return {
        "score": max(0, min(score, 100)),
        "evidence": evidence,
        "contradictions": contradictions,
        "profile": _public_profile(profile),
    }


def rank_profiles(
    profiles: Sequence[Mapping[str, Any]], parsed: Mapping[str, str]
) -> list[dict[str, Any]]:
    ranked = [score_profile(profile, parsed) for profile in profiles]
    return sorted(ranked, key=lambda item: (-item["score"], item["profile"].get("name", "")))


def choose_match(ranked: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    if not ranked:
        return {
            "match_status": "not_found",
            "confidence": "none",
            "score": 0,
            "evidence": [],
            "profile": None,
            "candidates": [],
            "profile_enriched": False,
            "message": "No profile candidates were returned.",
        }

    top = ranked[0]
    runner_up_score = int(ranked[1]["score"]) if len(ranked) > 1 else 0
    margin = int(top["score"]) - runner_up_score
    corroborators = [item for item in top["evidence"] if "name" not in item]

    high = int(top["score"]) >= 75 and len(corroborators) >= 1 and margin >= 10
    medium = int(top["score"]) >= 65 and len(corroborators) >= 1 and margin >= 5
    if high:
        status, confidence = "matched", "high"
    elif medium:
        status, confidence = "matched", "medium"
    else:
        status, confidence = "ambiguous", "low"

    return {
        "match_status": status,
        "confidence": confidence,
        "score": int(top["score"]),
        "evidence": list(top["evidence"]),
        "contradictions": list(top["contradictions"]),
        "profile": top["profile"] if status == "matched" else None,
        "candidates": list(ranked[:3]),
        "profile_enriched": bool(top["profile"].get("summary")) if status == "matched" else False,
        "message": (
            "A likely profile was selected from corroborating evidence."
            if status == "matched"
            else "The candidates are too similar or lack corroborating evidence."
        ),
    }


def lookup_with_helper(
    params: Mapping[str, Any],
    search: Callable[[dict[str, Any]], Mapping[str, Any]],
) -> dict[str, Any]:
    parsed = parse_input(params)
    masked_email = _mask_email(parsed["email_address"])
    try:
        search_params = build_search_params(parsed)
    except ValueError as error:
        return {
            "match_status": "unavailable",
            "confidence": "none",
            "score": 0,
            "evidence": [],
            "profile": None,
            "candidates": [],
            "profile_enriched": False,
            "email": masked_email or None,
            "message": str(error),
        }

    try:
        response = search(search_params)
    except Exception:
        return {
            "match_status": "unavailable",
            "confidence": "none",
            "score": 0,
            "evidence": [],
            "profile": None,
            "candidates": [],
            "profile_enriched": False,
            "email": masked_email or None,
            "message": "The approved profile lookup provider is unavailable.",
        }
    if not isinstance(response, Mapping):
        raw_profiles: Sequence[Any] = []
    else:
        candidate_payload = response.get("data", response.get("profiles", []))
        raw_profiles = (
            candidate_payload
            if isinstance(candidate_payload, Sequence)
            and not isinstance(candidate_payload, (str, bytes))
            else []
        )
    profiles = [item for item in raw_profiles if isinstance(item, Mapping)]
    result = choose_match(rank_profiles(profiles, parsed))
    result["email"] = masked_email or None
    result["search_filters"] = {
        key: value
        for key, value in parsed.items()
        if key != "email_address" and value
    }
    return result


def _core_name(full_name: Any) -> str:
    parts = _text(full_name).split()
    while parts and _normalise(parts[0]) in NAME_PREFIXES:
        parts.pop(0)
    while parts and _normalise(parts[-1]).strip(".") in NAME_SUFFIXES:
        parts.pop()
    return " ".join(parts)


def _quote(value: str) -> str:
    return '"' + value.replace('"', "") + '"'


def build_public_queries(parsed: Mapping[str, str]) -> list[dict[str, str]]:
    """Key-free public-search queries for one person, narrow to broad.

    Used when no provider tool is connected. Only the person's core name and one
    location component ever constrain a query. Industry wording and honorifics
    stay ranking evidence: quoting them would ask a search engine for an exact
    string no page contains, and the empty result would look like an absence.
    """
    core_name = _core_name(parsed.get("full_name"))
    if not core_name:
        return []
    name = _quote(core_name)
    places = [
        _text(parsed.get(key))
        for key in ("city_location", "state_province", "country_region")
    ]
    place = next((value for value in places if value), "")
    domain = _email_domain(_text(parsed.get("email_address")))
    domain_stem = domain.split(".", 1)[0] if domain not in FREE_EMAIL_DOMAINS else ""

    plan: list[dict[str, str]] = []
    if place:
        plan.append(
            {
                "scope": "name and place",
                "query": f"site:linkedin.com/in/ {name} {_quote(place)}",
            }
        )
    if len(domain_stem) >= 3:
        plan.append(
            {
                "scope": "name and employer",
                "query": f"site:linkedin.com/in/ {name} {_quote(domain_stem)}",
            }
        )
    plan.append({"scope": "name only", "query": f"site:linkedin.com/in/ {name}"})
    plan.append(
        {
            "scope": "off-site fallback",
            "query": f"{name} LinkedIn {_quote(place) if place else ''}".strip(),
        }
    )
    return plan


def _result_as_profile(candidate: Mapping[str, Any]) -> dict[str, Any]:
    """Shape a public search result like a provider profile for scoring."""
    title = _text(candidate.get("title"))
    snippet = _text(candidate.get("snippet"))
    name = re.split(r"\s*[|–-]\s*LinkedIn", title, maxsplit=1)[0].strip()
    name = re.split(r"\s+[-–|]\s+", name, maxsplit=1)[0].strip()
    return {
        "name": name,
        "linkedin_url": _text(candidate.get("url")),
        "headline": title,
        "summary": snippet,
        "location": snippet,
    }


def _present_public_profile(profile: Any) -> None:
    """Strip scoring scaffolding from a profile built out of a search snippet."""
    if not isinstance(profile, dict):
        return
    headline = profile.get("headline")
    if isinstance(headline, str):
        cleaned = re.split(r"\s*[|–-]\s*LinkedIn\s*$", headline, maxsplit=1)[0].strip()
        profile["headline"] = cleaned or None
    # `location` carried the whole snippet so the scorer could see place names.
    # A snippet is not a location field, so it is not presented as one.
    profile.pop("location", None)


def lookup_public(
    params: Mapping[str, Any], candidates: Sequence[Mapping[str, Any]] = ()
) -> dict[str, Any]:
    """Free, no-key lookup from public search results.

    Returns the same stable shape as the paid path, with `mode` set so an answer
    can never present public-search evidence as provider data.
    """
    parsed = parse_input(params)
    queries = build_public_queries(parsed)
    masked_email = _mask_email(parsed["email_address"])
    if not queries:
        return {
            "ok": False,
            "mode": "public_search",
            "match_status": "unavailable",
            "confidence": "none",
            "score": 0,
            "evidence": [],
            "profile": None,
            "candidates": [],
            "profile_enriched": False,
            "credits_used": 0,
            "email": masked_email or None,
            "queries": [],
            "message": "Provide the person's first and last name to build a public search.",
        }

    usable = [item for item in candidates if isinstance(item, Mapping)]
    ranked = rank_profiles([_result_as_profile(item) for item in usable], parsed)
    for item in ranked:
        _present_public_profile(item.get("profile"))
    result = choose_match(ranked)
    _present_public_profile(result.get("profile"))
    for item in result.get("candidates", []):
        _present_public_profile(item.get("profile"))
    # Public snippets are weaker evidence than a provider record, so the free
    # path never claims high confidence however well a snippet happens to score.
    if result.get("confidence") == "high":
        result["confidence"] = "medium"
    result["ok"] = True
    result["mode"] = "public_search"
    result["credits_used"] = 0
    result["email"] = masked_email or None
    result["queries"] = [step["query"] for step in queries]
    result["query_plan"] = queries
    if not usable:
        result["message"] = (
            "No provider tool is connected, so no paid lookup ran and no credits "
            "were used. Run these public searches and pass the results back in. "
            "An empty result is not evidence that the person has no profile."
        )
    else:
        result["message"] = (
            "Identified from publicly indexed search results, not a provider "
            "record. No credits were used. Treat it as a lead to verify, and "
            "never describe it as a LinkedIn scrape or a confirmed profile."
        )
    return result


def _self_test() -> None:
    params = {
        "email_address": "alex@riverhealth.example",
        "full_name": "Alex Morgan",
        "country_region": "Australia",
        "state_province": "South Australia",
        "city_location": "Adelaide",
        "industry": "Health care",
    }
    response = {
        "data": [
            {
                "name": "Alex Morgan",
                "linkedin_url": "https://www.linkedin.com/in/alex-morgan-health",
                "headline": "Operations Director in health care",
                "current_company": "River Health",
                "current_title": "Operations Director",
                "location": "Adelaide, South Australia, Australia",
            },
            {
                "name": "Alex Morgan",
                "linkedin_url": "https://www.linkedin.com/in/alex-morgan-design",
                "headline": "Designer",
                "current_company": "Studio North",
                "location": "Melbourne, Victoria, Australia",
            },
        ]
    }
    result = lookup_with_helper(params, lambda _: response)
    assert result["match_status"] == "matched"
    assert result["confidence"] == "high"
    assert result["profile"]["current_company"] == "River Health"
    assert result["email"] == "a***@riverhealth.example"
    assert "email_address" not in result["search_filters"]
    assert "phone_numbers" not in json.dumps(result)

    ambiguous = lookup_with_helper(
        {"full_name": "Alex Morgan"},
        lambda _: {"data": response["data"]},
    )
    assert ambiguous["match_status"] == "ambiguous"
    assert ambiguous["profile"] is None

    email_only = lookup_with_helper(
        {"email_address": "alex@riverhealth.example"},
        lambda _: (_ for _ in ()).throw(AssertionError("search should not run")),
    )
    assert email_only["match_status"] == "unavailable"

    provider_failure = lookup_with_helper(
        {"full_name": "Alex Morgan"},
        lambda _: (_ for _ in ()).throw(RuntimeError("secret provider detail")),
    )
    assert provider_failure["match_status"] == "unavailable"
    assert "secret provider detail" not in json.dumps(provider_failure)

    honorific_match = lookup_with_helper(
        {
            "full_name": "Robin Hale",
            "country_region": "Australia",
            "industry": "healthcare, information technology",
        },
        lambda _: {
            "data": [
                {
                    "name": "Dr Robin Hale",
                    "linkedin_url": "https://www.linkedin.com/in/correct",
                    "headline": "Medical doctor and AI engineer",
                    "location": "Melbourne, Australia",
                    "industry": "Healthcare, Information Technology",
                },
                {
                    "name": "Robin Hale",
                    "linkedin_url": "https://www.linkedin.com/in/decoy",
                    "headline": "Photographer",
                    "location": "Oxford, United Kingdom",
                    "industry": "Photography",
                },
            ]
        },
    )
    assert honorific_match["match_status"] == "matched"
    assert honorific_match["confidence"] == "medium"
    assert honorific_match["profile"]["linkedin_url"].endswith("/correct")

    consulting_params = parse_input(
        {
            "full_name": "Dr Mark Sinclair",
            "country_region": "Australia",
            "city_location": "Melbourne",
            "industry": "Consulting and business",
        }
    )
    consulting_search = build_search_params(consulting_params)
    assert "INDUSTRY" not in consulting_search
    assert consulting_search["FIRST_NAME"] == "Mark"
    assert consulting_search["LAST_NAME"] == "Sinclair"
    assert "Victoria" in consulting_search["REGION"]
    consulting_ranked = rank_profiles(
        [
            {
                "name": "Mark Sinclair FGIA CEM",
                "professional_network_name": "Dr. Mark Sinclair FGIA CEM",
                "linkedin_url": "https://www.linkedin.com/in/consulting-match",
                "headline": "Strategy, AI and technology transformation",
                "location": "Armadale, Victoria, Australia",
                "industry": "Education Management",
            },
            {
                "name": "Mark Sinclair",
                "linkedin_url": "https://www.linkedin.com/in/unrelated-match",
                "headline": "Advisor in business consulting and services",
                "location": "Melbourne, Victoria, Australia",
                "industry": "Business Consulting and Services",
            },
        ],
        consulting_params,
    )
    assert consulting_ranked[0]["profile"]["linkedin_url"].endswith(
        "/consulting-match"
    )
    assert consulting_ranked[0]["score"] - consulting_ranked[1]["score"] >= 10


def _self_test_public() -> None:
    params = {
        "full_name": "Dr Robin Hale",
        "email_address": "robin@northgate.example",
        "country_region": "Australia",
        "industry": "IT",
    }

    plan = build_public_queries(parse_input(params))
    scopes = [step["scope"] for step in plan]
    assert scopes == [
        "name and place",
        "name and employer",
        "name only",
        "off-site fallback",
    ]
    for step in plan:
        # The honorific and the industry wording must never constrain a query.
        assert '"Dr Robin Hale"' not in step["query"]
        assert '"IT"' not in step["query"]
    assert plan[0]["query"] == 'site:linkedin.com/in/ "Robin Hale" "Australia"'
    assert plan[1]["query"] == 'site:linkedin.com/in/ "Robin Hale" "northgate"'

    # A free email must not be mistaken for an employer domain.
    free = build_public_queries(
        parse_input({"full_name": "Robin Hale", "email_address": "robin@gmail.com"})
    )
    assert all("employer" not in step["scope"] for step in free)

    # With no candidates the free path spends nothing and claims nothing.
    empty = lookup_public(params)
    assert empty["mode"] == "public_search"
    assert empty["credits_used"] == 0
    assert empty["match_status"] == "not_found"
    assert "not evidence that the person has no profile" in empty["message"]

    ranked = lookup_public(
        params,
        [
            {
                "url": "https://www.linkedin.com/in/robinhale",
                "title": "Dr Robin Hale - Northgate | LinkedIn",
                "snippet": "Melbourne, Australia. Founder at Northgate, an AI community.",
            },
            {
                "url": "https://www.linkedin.com/in/robin-hale-uk",
                "title": "Robin Hale | LinkedIn",
                "snippet": "Manchester, United Kingdom. Retail manager.",
            },
        ],
    )
    assert ranked["match_status"] == "matched"
    assert ranked["profile"]["linkedin_url"] == "https://www.linkedin.com/in/robinhale"
    assert "requested professional title" in ranked["evidence"]
    assert "business email domain resembles employer" in ranked["evidence"]
    # Snippet evidence never earns high confidence, and the snippet is never
    # presented as a structured location field.
    assert ranked["confidence"] == "medium"
    assert "location" not in ranked["profile"]
    assert ranked["profile"]["headline"] == "Dr Robin Hale - Northgate"
    assert ranked["credits_used"] == 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if not args.self_test:
        parser.error("This module needs a configured helper; use --self-test for local validation.")
    _self_test()
    _self_test_public()
    print(json.dumps({"ok": True, "tests": 10}))


if __name__ == "__main__":
    main()
