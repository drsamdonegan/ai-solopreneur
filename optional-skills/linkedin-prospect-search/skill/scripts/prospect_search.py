#!/usr/bin/env python3
"""Build and rank key-free public-web LinkedIn prospect searches.

The module performs no network requests and contains no credential handling.
It generates public search-engine queries and can rank candidate search results
supplied by an agent or a human.
"""

from __future__ import annotations

import argparse
import json
import re
from collections.abc import Mapping, Sequence
from typing import Any
from urllib.parse import urlsplit


DEFAULT_LIMIT = 10
MAX_LIMIT = 25
GENERIC_TERMS = {
    "and",
    "business",
    "company",
    "community",
    "industry",
    "organisation",
    "organization",
    "sector",
    "services",
}


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _normalise(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", _text(value).casefold()).strip()


def _terms(value: Any) -> list[str]:
    parts = re.split(r"[,;/|]+|\band\b", _text(value), flags=re.IGNORECASE)
    return [
        term
        for part in parts
        if (term := _normalise(part)) and term not in GENERIC_TERMS
    ]


def parse_input(params: Mapping[str, Any]) -> dict[str, Any]:
    parsed: dict[str, Any] = {}
    for key in ("industry", "location"):
        value = _text(params.get(key))
        if not value:
            raise ValueError(f"{key} is required.")
        if len(value) > 200:
            raise ValueError(f"{key} must be 200 characters or fewer.")
        parsed[key] = value

    for key in ("role_title", "company_headcount"):
        value = _text(params.get(key))
        if len(value) > 160:
            raise ValueError(f"{key} must be 160 characters or fewer.")
        parsed[key] = value

    raw_limit = params.get("max_results", DEFAULT_LIMIT)
    if isinstance(raw_limit, bool):
        raise ValueError("max_results must be a whole number between 1 and 25.")
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError) as error:
        raise ValueError(
            "max_results must be a whole number between 1 and 25."
        ) from error
    if not 1 <= limit <= MAX_LIMIT:
        raise ValueError("max_results must be a whole number between 1 and 25.")
    parsed["max_results"] = limit
    return parsed


def _quote(value: str) -> str:
    return f'"{value.replace(chr(34), "")}"'


def build_public_queries(params: Mapping[str, Any]) -> dict[str, Any]:
    parsed = parse_input(params)
    industry = _quote(parsed["industry"])
    location = _quote(parsed["location"])
    queries = [
        f"site:linkedin.com/company/ {location} {industry}",
        f"LinkedIn company {location} {industry}",
    ]
    if parsed["role_title"]:
        role = _quote(parsed["role_title"])
        queries.append(f"site:linkedin.com/in/ {role} {location} {industry}")
    return {
        "ok": True,
        "mode": "manual_query_only",
        "queries": queries,
        "cannot_verify_from_query": [
            value
            for value in (
                "company_headcount" if parsed["company_headcount"] else None,
                "current role assignment" if parsed["role_title"] else None,
            )
            if value
        ],
        "search_criteria": parsed,
        "message": "These are public search strings, not returned or qualified prospects.",
    }


def _canonical_linkedin_url(value: Any) -> tuple[str | None, str | None]:
    raw = _text(value)
    if not raw:
        return None, None
    try:
        parts = urlsplit(raw)
    except ValueError:
        return None, None
    if parts.scheme.casefold() != "https":
        return None, None
    host = parts.hostname.casefold() if parts.hostname else ""
    if host != "linkedin.com" and not host.endswith(".linkedin.com"):
        return None, None

    path = re.sub(r"/+", "/", parts.path)
    path_lower = path.casefold()
    if path_lower.startswith("/company/"):
        kind, prefix = "company", "/company/"
    elif path_lower.startswith("/in/"):
        kind, prefix = "person", "/in/"
    else:
        return None, None
    slug = path[len(prefix) :].strip("/")
    if not slug or "/" in slug or not re.fullmatch(r"[A-Za-z0-9%_.~-]+", slug):
        return None, None
    return f"https://www.linkedin.com{prefix}{slug}", kind


def _visible_matches(terms: list[str], haystack: str) -> bool:
    return bool(terms and any(term in haystack for term in terms))


def _company_name(title: str) -> str | None:
    cleaned = re.sub(r"\s*[|–-]\s*LinkedIn\s*$", "", title, flags=re.IGNORECASE)
    return cleaned.strip() or None


def rank_public_results(
    params: Mapping[str, Any], candidates: Sequence[Mapping[str, Any]]
) -> dict[str, Any]:
    parsed = parse_input(params)
    industry_terms = _terms(parsed["industry"])
    location_terms = _terms(parsed["location"])
    role_terms = _terms(parsed["role_title"])
    headcount = _normalise(parsed["company_headcount"])

    ranked: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    seen: set[str] = set()

    for raw in candidates:
        if not isinstance(raw, Mapping):
            continue
        url, kind = _canonical_linkedin_url(raw.get("url"))
        title = _text(raw.get("title"))
        snippet = _text(raw.get("snippet"))
        source_query = _text(raw.get("source_query"))
        if not url:
            excluded.append(
                {
                    "url": _text(raw.get("url")) or None,
                    "title": title or None,
                    "reason": "not a safe public LinkedIn company or person URL",
                }
            )
            continue
        if url in seen:
            continue
        seen.add(url)

        visible = _normalise(" ".join((title, snippet)))
        evidence: list[str] = []
        unverified: list[str] = []
        score = 20

        if _visible_matches(industry_terms, visible):
            evidence.append("industry visible in public result")
            score += 30
        else:
            unverified.append("industry")
        if _visible_matches(location_terms, visible):
            evidence.append("location visible in public result")
            score += 25
        else:
            unverified.append("location")
        if parsed["role_title"]:
            if kind == "person" and _visible_matches(role_terms, visible):
                evidence.append("role title visible in public result")
                score += 20
            else:
                unverified.append("current role assignment")
        if parsed["company_headcount"]:
            if headcount and headcount in visible:
                evidence.append("company headcount visible in public result")
                score += 5
            else:
                unverified.append("company headcount")

        item = {
            "name": _company_name(title),
            "url": url,
            "kind": kind,
            "title": title or None,
            "snippet": snippet or None,
            "source_query": source_query or None,
            "score": min(score, 100),
            "match_evidence": evidence,
            "unverified_criteria": unverified,
        }
        if not evidence:
            item["reason"] = "no requested criterion is visible in the public result"
            excluded.append(item)
        else:
            ranked.append(item)

    ranked.sort(key=lambda item: (-item["score"], item["url"]))
    companies = [item for item in ranked if item["kind"] == "company"]
    people = [item for item in ranked if item["kind"] == "person"]
    limit = parsed["max_results"]
    return {
        "ok": True,
        "mode": "public_search_results",
        "companies": companies[:limit],
        "company_urls": [item["url"] for item in companies[:limit]],
        "people_evidence": people[:limit],
        "person_urls": [item["url"] for item in people[:limit]],
        "excluded": excluded[:limit],
        "total_count": min(len(companies), limit),
        "search_criteria": parsed,
        "coverage": "Publicly indexed results only; bounded and potentially stale",
    }


def _self_test() -> None:
    params = {
        "industry": "AI communities, technology, not for profit",
        "location": "Melbourne, Victoria, Australia",
        "role_title": "Founder, Community Lead",
        "company_headcount": "11-50",
        "max_results": 10,
    }
    parsed = parse_input(params)
    assert parsed["max_results"] == 10

    queries = build_public_queries(params)
    assert len(queries["queries"]) == 3
    assert queries["queries"][0].startswith("site:linkedin.com/company/")

    safe_url, kind = _canonical_linkedin_url(
        "https://au.linkedin.com/company/example-ai-community/?trk=public"
    )
    assert safe_url == "https://www.linkedin.com/company/example-ai-community"
    assert kind == "company"

    unsafe_url, _ = _canonical_linkedin_url("javascript:alert(1)")
    assert unsafe_url is None

    candidates = [
        {
            "url": "https://au.linkedin.com/company/example-ai-community/",
            "title": "Example AI Community | LinkedIn",
            "snippet": "Melbourne, Victoria technology and not-for-profit AI community",
            "source_query": queries["queries"][0],
        },
        {
            "url": "https://www.linkedin.com/in/alex-example",
            "title": "Alex Example - Community Lead | LinkedIn",
            "snippet": "Founder of a Melbourne AI technology community",
            "source_query": queries["queries"][2],
        },
        {
            "url": "https://www.linkedin.com/company/example-ai-community?dup=1",
            "title": "Duplicate",
            "snippet": "Melbourne technology",
        },
        {
            "url": "https://example.com/company/not-linkedin",
            "title": "Unsafe",
            "snippet": "Melbourne technology",
        },
    ]
    ranked = rank_public_results(params, candidates)
    assert ranked["company_urls"] == [
        "https://www.linkedin.com/company/example-ai-community"
    ]
    assert ranked["person_urls"] == ["https://www.linkedin.com/in/alex-example"]
    assert "company headcount" in ranked["companies"][0]["unverified_criteria"]
    assert len(ranked["excluded"]) == 1

    try:
        parse_input({"industry": "Technology", "max_results": 100})
    except ValueError as error:
        assert "location" in str(error) or "between 1 and 25" in str(error)
    else:
        raise AssertionError("Missing location or unbounded result limit should fail")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--manual-query", action="store_true")
    parser.add_argument("--industry")
    parser.add_argument("--location")
    parser.add_argument("--role-title", default="")
    parser.add_argument("--company-headcount", default="")
    parser.add_argument("--max-results", type=int, default=DEFAULT_LIMIT)
    args = parser.parse_args()

    if args.self_test:
        _self_test()
        print(json.dumps({"ok": True, "tests": 6}))
        return
    if args.manual_query:
        result = build_public_queries(
            {
                "industry": args.industry,
                "location": args.location,
                "role_title": args.role_title,
                "company_headcount": args.company_headcount,
                "max_results": args.max_results,
            }
        )
        print(json.dumps(result, indent=2))
        return
    parser.error("Choose --self-test or --manual-query.")


if __name__ == "__main__":
    main()
