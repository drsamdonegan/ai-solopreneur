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
MAX_QUERY_TERMS = 4
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


def _phrases(value: Any, limit: int = MAX_QUERY_TERMS) -> list[str]:
    """Split a loose criterion into short searchable phrases, keeping casing.

    A whole criterion is never quoted as one phrase. A search engine treats
    `"AI communities, technology, not for profit"` as an exact string that no
    real page contains, so the query returns nothing and the empty result is
    indistinguishable from a genuine absence of prospects.
    """
    parts = re.split(r"[,;/|]+|\band\b", _text(value), flags=re.IGNORECASE)
    phrases: list[str] = []
    seen: set[str] = set()
    for part in parts:
        phrase = " ".join(part.split())
        key = _normalise(phrase)
        if not key or key in GENERIC_TERMS or key in seen:
            continue
        seen.add(key)
        phrases.append(phrase)
    return phrases[:limit]


def _location_parts(value: Any) -> list[str]:
    """Return location components, most specific first (city, state, country)."""
    return [
        " ".join(part.split())
        for part in re.split(r"[,;/|]+", _text(value))
        if part.strip()
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


def _any_of(phrases: Sequence[str]) -> str:
    if len(phrases) == 1:
        return _quote(phrases[0])
    return "(" + " OR ".join(_quote(phrase) for phrase in phrases) + ")"


def build_public_queries(params: Mapping[str, Any]) -> dict[str, Any]:
    """Build a narrow-to-broad query ladder from decomposed criteria.

    Only the most specific location component and at most two industry phrases
    constrain the narrowest query. Everything else stays ranking evidence, so an
    over-constrained query cannot silently turn a real prospect list into zero
    results.
    """
    parsed = parse_input(params)
    industry_phrases = _phrases(parsed["industry"])
    location_parts = _location_parts(parsed["location"]) or [parsed["location"]]
    primary_location = location_parts[0]
    wider_location = location_parts[1:]
    role_phrases = _phrases(parsed["role_title"], limit=3)

    place = _quote(primary_location)
    focused = " ".join(_quote(phrase) for phrase in industry_phrases[:2])
    plan: list[dict[str, str]] = [
        {
            "scope": "focused",
            "query": f"site:linkedin.com/company/ {place} {focused}".strip(),
        }
    ]
    if len(industry_phrases) > 1:
        plan.append(
            {
                "scope": "widened industry",
                "query": (
                    f"site:linkedin.com/company/ {place} {_any_of(industry_phrases)}"
                ),
            }
        )
    plan.append(
        {"scope": "location only", "query": f"site:linkedin.com/company/ {place}"}
    )
    plan.append(
        {
            "scope": "off-site fallback",
            "query": f"LinkedIn company {place} {focused}".strip(),
        }
    )
    if role_phrases:
        plan.append(
            {
                "scope": "people",
                "query": (
                    f"site:linkedin.com/in/ {_any_of(role_phrases)} {place} {focused}"
                ).strip(),
            }
        )

    return {
        "ok": True,
        "mode": "manual_query_only",
        "queries": [step["query"] for step in plan],
        "query_plan": plan,
        "ranking_only_criteria": [
            value
            for value in (
                *wider_location,
                *industry_phrases[2:],
                parsed["company_headcount"],
            )
            if value
        ],
        "cannot_verify_from_query": [
            value
            for value in (
                "company_headcount" if parsed["company_headcount"] else None,
                "current role assignment" if parsed["role_title"] else None,
            )
            if value
        ],
        "search_criteria": parsed,
        "widening_rule": (
            "Run the ladder from focused to broad and stop at the first scope that "
            "returns usable results. Name that scope in the answer. Broadening is "
            "allowed; presenting a broadened search as the requested one is not."
        ),
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
    scopes = sorted({item["source_query"] for item in ranked if item["source_query"]})
    result = {
        "ok": True,
        "mode": "public_search_results",
        "companies": companies[:limit],
        "company_urls": [item["url"] for item in companies[:limit]],
        "people_evidence": people[:limit],
        "person_urls": [item["url"] for item in people[:limit]],
        "excluded": excluded[:limit],
        "total_count": min(len(companies), limit),
        "search_criteria": parsed,
        "queries_that_produced_results": scopes,
        "coverage": "Publicly indexed results only; bounded and potentially stale",
    }
    if not companies and not people:
        result["message"] = (
            "No public result matched at the scope searched. An empty result is "
            "not evidence that no such company or person exists: it can equally "
            "mean the query was too narrow. Report the scope that was searched, "
            "then widen one step down the ladder before concluding anything."
        )
    return result


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
    plan = queries["query_plan"]
    assert [step["scope"] for step in plan] == [
        "focused",
        "widened industry",
        "location only",
        "off-site fallback",
        "people",
    ]
    assert queries["queries"][0].startswith("site:linkedin.com/company/")

    # The whole criterion must never be quoted as one exact phrase, and the
    # narrowest query must constrain on the city rather than the full location.
    for query in queries["queries"]:
        assert '"Melbourne, Victoria, Australia"' not in query
        assert '"AI communities, technology, not for profit"' not in query
    assert '"Melbourne"' in plan[0]["query"]
    assert "Victoria" in queries["ranking_only_criteria"]
    assert "11-50" in queries["ranking_only_criteria"]

    # The ladder must actually widen: each step constrains no more than the last.
    assert plan[0]["query"].count('"') > plan[2]["query"].count('"')
    assert " OR " in plan[1]["query"]

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
    assert "message" not in ranked

    # An empty result must say the scope was empty, not that nobody exists.
    empty = rank_public_results(params, [])
    assert empty["company_urls"] == [] and empty["total_count"] == 0
    assert "not evidence that no such company or person exists" in empty["message"]

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
        print(json.dumps({"ok": True, "tests": 9}))
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
