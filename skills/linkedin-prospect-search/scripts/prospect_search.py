#!/usr/bin/env python3
"""Validate, format, and deduplicate bounded LinkedIn prospect searches.

The module contains no network code or credentials. Supply a reviewed search
callable for live use, or run the manual-query mode to print search strings.
"""

from __future__ import annotations

import argparse
import json
import re
from collections.abc import Callable, Mapping, Sequence
from typing import Any
from urllib.parse import urlsplit


REQUIRED_FIELDS = ("industry", "location", "role_title")
OPTIONAL_TEXT_FIELDS = ("company_headcount", "search_type")
DEFAULT_SEARCH_TYPE = "Performance optimized"
DEFAULT_LIMIT = 10
MAX_LIMIT = 50


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _normalise(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", _text(value).casefold()).strip()


def _terms(value: Any) -> list[str]:
    return [
        _normalise(part)
        for part in re.split(r"[,;/|]+", _text(value))
        if _normalise(part)
    ]


def _headcount_bounds(value: Any) -> tuple[int, int | None] | None:
    compact = re.sub(r"[\s,]", "", _text(value)).replace("–", "-").replace("—", "-")
    if match := re.fullmatch(r"(\d+)-(\d+)", compact):
        lower, upper = int(match.group(1)), int(match.group(2))
        return (lower, upper) if lower <= upper else None
    if match := re.fullmatch(r"(\d+)\+", compact):
        return int(match.group(1)), None
    if compact.isdigit():
        number = int(compact)
        return number, number
    return None


def _headcount_matches(expected: Any, actual: Any) -> bool:
    expected_bounds = _headcount_bounds(expected)
    actual_bounds = _headcount_bounds(actual)
    if not expected_bounds or not actual_bounds:
        expected_text, actual_text = _normalise(expected), _normalise(actual)
        return bool(expected_text and actual_text and (expected_text in actual_text or actual_text in expected_text))
    expected_low, expected_high = expected_bounds
    actual_low, actual_high = actual_bounds
    expected_high = expected_high if expected_high is not None else float("inf")
    actual_high = actual_high if actual_high is not None else float("inf")
    return expected_low <= actual_low and actual_high <= expected_high


def _nested(value: Any, *path: str) -> Any:
    current = value
    for key in path:
        if not isinstance(current, Mapping):
            return None
        current = current.get(key)
    return current


def _first_text(*values: Any) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, Mapping):
            for key in ("raw", "full_location", "name", "value"):
                nested = _text(value.get(key))
                if nested:
                    return nested
    return ""


def parse_input(params: Mapping[str, Any]) -> dict[str, Any]:
    parsed: dict[str, Any] = {}
    for key in REQUIRED_FIELDS:
        value = _text(params.get(key))
        if not value:
            raise ValueError(f"{key} is required.")
        if len(value) > 160:
            raise ValueError(f"{key} must be 160 characters or fewer.")
        parsed[key] = value

    for key in OPTIONAL_TEXT_FIELDS:
        value = _text(params.get(key))
        if len(value) > 80:
            raise ValueError(f"{key} must be 80 characters or fewer.")
        parsed[key] = value

    raw_limit = params.get("max_results", DEFAULT_LIMIT)
    if isinstance(raw_limit, bool):
        raise ValueError("max_results must be a whole number between 1 and 50.")
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError) as error:
        raise ValueError("max_results must be a whole number between 1 and 50.") from error
    if limit < 1 or limit > MAX_LIMIT:
        raise ValueError("max_results must be a whole number between 1 and 50.")
    parsed["max_results"] = limit
    parsed["search_type"] = parsed["search_type"] or DEFAULT_SEARCH_TYPE
    return parsed


def build_search_params(parsed: Mapping[str, Any]) -> dict[str, Any]:
    search_params: dict[str, Any] = {
        "INDUSTRY": [_text(parsed.get("industry"))],
        "REGION": [_text(parsed.get("location"))],
        "CURRENT_TITLE": [_text(parsed.get("role_title"))],
        "LIMIT": int(parsed.get("max_results", DEFAULT_LIMIT)),
        "search_type": _text(parsed.get("search_type")) or DEFAULT_SEARCH_TYPE,
    }
    headcount = _text(parsed.get("company_headcount"))
    if headcount:
        search_params["COMPANY_HEADCOUNT"] = [headcount]
    return search_params


def _canonical_linkedin_url(value: Any, kind: str) -> str | None:
    raw = _text(value)
    if not raw:
        return None
    if not re.match(r"^https?://", raw, flags=re.IGNORECASE):
        raw = f"https://{raw}"
    try:
        parts = urlsplit(raw)
    except ValueError:
        return None
    host = parts.hostname.casefold() if parts.hostname else ""
    if host != "linkedin.com" and not host.endswith(".linkedin.com"):
        return None
    expected_prefix = "/in/" if kind == "person" else "/company/"
    path = re.sub(r"/+", "/", parts.path)
    if not path.casefold().startswith(expected_prefix):
        return None
    slug = path[len(expected_prefix) :].strip("/")
    if not slug or "/" in slug or not re.fullmatch(r"[A-Za-z0-9%_.~-]+", slug):
        return None
    return f"https://www.linkedin.com{expected_prefix}{slug}"


def _current_role(profile: Mapping[str, Any]) -> Mapping[str, Any]:
    current = _nested(profile, "experience", "employment_details", "current")
    if isinstance(current, Sequence) and not isinstance(current, (str, bytes)):
        return current[0] if current and isinstance(current[0], Mapping) else {}
    return current if isinstance(current, Mapping) else {}


def _format_profile(profile: Mapping[str, Any], parsed: Mapping[str, Any]) -> dict[str, Any]:
    role = _current_role(profile)
    basic = profile.get("basic_profile") if isinstance(profile.get("basic_profile"), Mapping) else {}
    social = profile.get("social_handles") if isinstance(profile.get("social_handles"), Mapping) else {}
    network_identifier = (
        social.get("professional_network_identifier")
        if isinstance(social.get("professional_network_identifier"), Mapping)
        else {}
    )

    name = _first_text(profile.get("name"), basic.get("name"))
    title = _first_text(
        profile.get("current_title"), basic.get("current_title"), role.get("title")
    )
    company = _first_text(
        profile.get("company"), profile.get("current_company"), role.get("name"), role.get("company_name")
    )
    location = _first_text(
        profile.get("location"), basic.get("location"), _nested(profile, "professional_network", "location")
    )
    headline = _first_text(profile.get("headline"), basic.get("headline"))
    industry = _first_text(
        profile.get("industry"),
        role.get("company_professional_network_industry"),
        role.get("company_industry"),
    )
    headcount = _first_text(
        profile.get("company_headcount"),
        role.get("company_headcount_range"),
        str(role.get("company_headcount_latest")) if role.get("company_headcount_latest") is not None else "",
    )
    profile_url = _canonical_linkedin_url(
        _first_text(
            profile.get("profile_url"),
            profile.get("linkedin_url"),
            network_identifier.get("profile_url"),
        ),
        "person",
    )
    company_url = _canonical_linkedin_url(
        _first_text(
            profile.get("company_profile_url"),
            profile.get("company_linkedin_url"),
            profile.get("current_company_linkedin_url"),
            role.get("company_professional_network_profile_url"),
            role.get("company_linkedin_profile_url"),
        ),
        "company",
    )

    evidence: list[str] = []
    unverified: list[str] = []
    conflicts: list[str] = []
    visible = {
        "role_title": " ".join(filter(None, (title, headline))),
        "location": location,
        "industry": " ".join(filter(None, (industry, headline))),
        "company_headcount": headcount,
    }
    for key, label in (
        ("role_title", "role title"),
        ("location", "location"),
        ("industry", "industry"),
        ("company_headcount", "company headcount"),
    ):
        expected = _normalise(parsed.get(key))
        if not expected:
            continue
        actual = _normalise(visible[key])
        if not actual:
            unverified.append(label)
        elif key == "industry" and any(
            term in actual for term in _terms(parsed.get("industry"))
        ):
            evidence.append(label)
        elif key == "company_headcount" and _headcount_matches(
            parsed.get("company_headcount"), visible[key]
        ):
            evidence.append(label)
        elif expected in actual or actual in expected:
            evidence.append(label)
        else:
            conflicts.append(label)

    status = "excluded" if conflicts else ("qualified" if len(evidence) >= 2 else "unverified")
    return {
        "name": name or None,
        "current_title": title or None,
        "company": company or None,
        "location": location or None,
        "profile_url": profile_url,
        "company_profile_url": company_url,
        "headline": headline or None,
        "industry": industry or None,
        "company_headcount": headcount or None,
        "criteria_status": status,
        "match_evidence": evidence,
        "unverified_criteria": unverified,
        "conflicting_criteria": conflicts,
    }


def format_response(response: Mapping[str, Any], parsed: Mapping[str, Any]) -> dict[str, Any]:
    payload = response.get("data", response.get("profiles", []))
    raw_profiles = (
        payload
        if isinstance(payload, Sequence) and not isinstance(payload, (str, bytes))
        else []
    )
    profiles: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    seen_people: set[str] = set()

    for raw in raw_profiles:
        if not isinstance(raw, Mapping):
            continue
        item = _format_profile(raw, parsed)
        if not item["profile_url"]:
            item["conflicting_criteria"].append("missing valid public LinkedIn profile URL")
            item["criteria_status"] = "excluded"
        key = item["profile_url"] or "|".join(
            _normalise(item.get(field)) for field in ("name", "company", "current_title")
        )
        if not key or key in seen_people:
            continue
        seen_people.add(key)
        if item["criteria_status"] == "excluded":
            excluded.append(item)
        else:
            profiles.append(item)
        if len(profiles) >= int(parsed["max_results"]):
            break

    companies: list[dict[str, Any]] = []
    seen_companies: set[str] = set()
    for profile in profiles:
        url = profile.get("company_profile_url")
        if not url or url in seen_companies:
            continue
        seen_companies.add(url)
        companies.append({"company": profile.get("company"), "company_profile_url": url})

    credits = response.get("credits_cost")
    if not isinstance(credits, (int, float)) or isinstance(credits, bool):
        credits = None
    return {
        "ok": True,
        "profiles": profiles,
        "profile_urls": [profile["profile_url"] for profile in profiles],
        "companies": companies,
        "company_urls": [company["company_profile_url"] for company in companies],
        "excluded_profiles": excluded,
        "total_count": len(profiles),
        "credits_cost": credits,
        "search_criteria": {
            key: parsed.get(key) or None
            for key in (*REQUIRED_FIELDS, "company_headcount", "max_results", "search_type")
        },
        "coverage": "Bounded provider result; not exhaustive",
    }


def search_with_helper(
    params: Mapping[str, Any],
    search: Callable[[dict[str, Any]], Mapping[str, Any]],
) -> dict[str, Any]:
    parsed = parse_input(params)
    try:
        response = search(build_search_params(parsed))
    except Exception:
        return {
            "ok": False,
            "profiles": [],
            "profile_urls": [],
            "companies": [],
            "company_urls": [],
            "excluded_profiles": [],
            "total_count": 0,
            "credits_cost": None,
            "search_criteria": {
                key: parsed.get(key) or None
                for key in (*REQUIRED_FIELDS, "company_headcount", "max_results", "search_type")
            },
            "coverage": "No live provider result",
            "error": {
                "code": "PROVIDER_UNAVAILABLE",
                "message": "The approved prospect-search provider is unavailable.",
            },
        }
    if not isinstance(response, Mapping):
        response = {}
    return format_response(response, parsed)


def build_manual_queries(params: Mapping[str, Any]) -> dict[str, Any]:
    parsed = parse_input(params)
    quote = lambda value: f'"{_text(value).replace(chr(34), "")}"'
    people = " ".join(
        (
            "site:linkedin.com/in/",
            quote(parsed["role_title"]),
            quote(parsed["location"]),
            quote(parsed["industry"]),
        )
    )
    companies = " ".join(
        (
            "site:linkedin.com/company/",
            quote(parsed["location"]),
            quote(parsed["industry"]),
        )
    )
    return {
        "ok": True,
        "mode": "manual_query_only",
        "queries": [people, companies],
        "cannot_verify_from_query": [
            value
            for value in (
                "company_headcount" if parsed.get("company_headcount") else None,
                "current role assignment",
            )
            if value
        ],
        "message": "These are search strings, not returned or qualified prospects.",
    }


def _self_test() -> None:
    params = {
        "industry": "Health care",
        "location": "Australia",
        "role_title": "Head of Operations",
        "company_headcount": "51-200",
        "max_results": 10,
    }
    parsed = parse_input(params)
    built = build_search_params(parsed)
    assert built["CURRENT_TITLE"] == ["Head of Operations"]
    assert built["COMPANY_HEADCOUNT"] == ["51-200"]

    response = {
        "credits_cost": 0.06,
        "data": [
            {
                "name": "Alex Morgan",
                "current_title": "Head of Operations",
                "company": "Care Systems",
                "location": "Melbourne, Australia",
                "linkedin_url": "https://au.linkedin.com/in/alex-morgan/?trk=test",
                "company_linkedin_url": "https://linkedin.com/company/care-systems/",
                "headline": "Health care operations leader",
                "industry": "Health care",
                "company_headcount": "51-200",
            },
            {
                "basic_profile": {
                    "name": "Jordan Lee",
                    "headline": "Head of Operations in health care technology",
                    "location": {"raw": "Sydney, Australia"},
                },
                "social_handles": {
                    "professional_network_identifier": {
                        "profile_url": "https://linkedin.com/in/jordan-lee"
                    }
                },
                "experience": {
                    "employment_details": {
                        "current": [
                            {
                                "name": "Clinic Cloud",
                                "title": "Head of Operations",
                                "company_professional_network_profile_url": "https://linkedin.com/company/clinic-cloud",
                                "company_professional_network_industry": "Information Technology",
                                "company_headcount_latest": 125,
                            }
                        ]
                    }
                },
            },
            {
                "name": "Alex Morgan duplicate",
                "profile_url": "https://www.linkedin.com/in/alex-morgan",
                "current_title": "Head of Operations",
                "location": "Australia",
                "industry": "Health care",
            },
            {
                "name": "Wrong Region",
                "profile_url": "https://www.linkedin.com/in/wrong-region",
                "current_title": "Head of Operations",
                "location": "Canada",
                "industry": "Health care",
            },
            {
                "name": "Unsafe URL",
                "profile_url": "https://example.com/person",
                "current_title": "Head of Operations",
                "location": "Australia",
                "industry": "Health care",
            },
        ],
    }
    result = search_with_helper(params, lambda _: response)
    assert result["total_count"] == 2
    assert result["profile_urls"] == [
        "https://www.linkedin.com/in/alex-morgan",
        "https://www.linkedin.com/in/jordan-lee",
    ]
    assert result["company_urls"] == [
        "https://www.linkedin.com/company/care-systems",
        "https://www.linkedin.com/company/clinic-cloud",
    ]
    assert len(result["excluded_profiles"]) == 2
    assert result["credits_cost"] == 0.06

    failed = search_with_helper(
        params,
        lambda _: (_ for _ in ()).throw(RuntimeError("secret provider response")),
    )
    assert failed["error"]["code"] == "PROVIDER_UNAVAILABLE"
    assert "secret provider response" not in json.dumps(failed)

    manual = build_manual_queries(params)
    assert manual["mode"] == "manual_query_only"
    assert len(manual["queries"]) == 2
    assert "company_headcount" in manual["cannot_verify_from_query"]

    try:
        parse_input({"industry": "Health care", "location": "Australia"})
    except ValueError as error:
        assert "role_title" in str(error)
    else:
        raise AssertionError("Missing role_title should fail")

    try:
        parse_input({**params, "max_results": 500})
    except ValueError as error:
        assert "between 1 and 50" in str(error)
    else:
        raise AssertionError("Unbounded result limit should fail")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--manual-query", action="store_true")
    parser.add_argument("--industry")
    parser.add_argument("--location")
    parser.add_argument("--role-title")
    parser.add_argument("--company-headcount", default="")
    parser.add_argument("--max-results", type=int, default=DEFAULT_LIMIT)
    args = parser.parse_args()

    if args.self_test:
        _self_test()
        print(json.dumps({"ok": True, "tests": 5}))
        return
    if args.manual_query:
        result = build_manual_queries(
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
