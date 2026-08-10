#!/usr/bin/env python3
"""Validate and format bounded LinkedIn prospect research.

This module deliberately contains no network or credential code. It builds the
reviewable Crustdata request used by the n8n workflow, formats provider-neutral
results, and produces public-search queries for the no-credential fallback.
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
SEARCH_CREDITS_PER_RESULT = 0.03
SEARCH_MODES = ("people", "companies")


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _normalise(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", _text(value).casefold()).strip()


def _terms(value: Any) -> list[str]:
    return [
        part.strip()
        for part in re.split(r"[,;/|]+", _text(value))
        if part.strip()
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
            for key in ("raw", "full_location", "name", "value", "url"):
                nested = _text(value.get(key))
                if nested:
                    return nested
        if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
            joined = ", ".join(_text(item) for item in value if _text(item))
            if joined:
                return joined
    return ""


def parse_input(params: Mapping[str, Any]) -> dict[str, Any]:
    mode = _text(params.get("search_mode") or params.get("mode") or "people").casefold()
    if mode not in SEARCH_MODES:
        raise ValueError("search_mode must be people or companies.")

    parsed: dict[str, Any] = {"search_mode": mode}
    for key in ("industry", "location"):
        value = _text(params.get(key))
        if not value:
            raise ValueError(f"{key} is required.")
        if len(value) > 200:
            raise ValueError(f"{key} must be 200 characters or fewer.")
        parsed[key] = value
    if not _terms(parsed["industry"]):
        raise ValueError("industry must contain at least one searchable term.")

    role_title = _text(params.get("role_title"))
    if mode == "people" and not role_title:
        raise ValueError("role_title is required for people mode.")
    if len(role_title) > 160:
        raise ValueError("role_title must be 160 characters or fewer.")
    parsed["role_title"] = role_title

    for key, maximum in (("keywords", 500), ("company_headcount", 40)):
        value = _text(params.get(key))
        if len(value) > maximum:
            raise ValueError(f"{key} must be {maximum} characters or fewer.")
        parsed[key] = value

    if parsed["company_headcount"] and not _headcount_bounds(parsed["company_headcount"]):
        raise ValueError("company_headcount must be a number, range such as 51-200, or value such as 1001+.")

    raw_limit = params.get("max_results", DEFAULT_LIMIT)
    if isinstance(raw_limit, bool):
        raise ValueError("max_results must be a whole number between 1 and 25.")
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError) as error:
        raise ValueError("max_results must be a whole number between 1 and 25.") from error
    if limit < 1 or limit > MAX_LIMIT:
        raise ValueError("max_results must be a whole number between 1 and 25.")
    parsed["max_results"] = limit
    return parsed


def _condition_or_single(conditions: list[dict[str, Any]]) -> dict[str, Any]:
    if len(conditions) == 1:
        return conditions[0]
    return {"op": "or", "conditions": conditions}


def _headcount_conditions(field: str, value: str) -> list[dict[str, Any]]:
    bounds = _headcount_bounds(value)
    if not bounds:
        return []
    lower, upper = bounds
    conditions = [{"field": field, "type": "=>", "value": lower}]
    if upper is not None:
        conditions.append({"field": field, "type": "=<", "value": upper})
    return conditions


def build_crustdata_request(parsed: Mapping[str, Any]) -> dict[str, Any]:
    """Build a current, low-cost indexed Search API request."""

    mode = _text(parsed.get("search_mode"))
    industry_terms = _terms(parsed.get("industry"))
    conditions: list[dict[str, Any]] = []

    if mode == "people":
        industry_conditions = [
            {
                "field": "experience.employment_details.current.company_professional_network_industry",
                "type": "(.)",
                "value": term,
            }
            for term in industry_terms
        ]
        conditions.extend(
            [
                _condition_or_single(industry_conditions),
                {
                    "field": "basic_profile.location.full_location",
                    "type": "(.)",
                    "value": _text(parsed.get("location")),
                },
                {
                    "field": "experience.employment_details.current.title",
                    "type": "(.)",
                    "value": _text(parsed.get("role_title")),
                },
            ]
        )
        conditions.extend(
            _headcount_conditions(
                "experience.employment_details.current.company_headcount_latest",
                _text(parsed.get("company_headcount")),
            )
        )
        body: dict[str, Any] = {
            "filters": {"op": "and", "conditions": conditions},
            "mode": "exact",
            "fields": [
                "fit",
                "metadata.updated_at",
                "basic_profile",
                "experience.employment_details.current",
                "social_handles.professional_network_identifier.profile_url",
            ],
            "limit": int(parsed.get("max_results", DEFAULT_LIMIT)),
        }
        keywords = _text(parsed.get("keywords"))
        if keywords:
            body["search"] = {
                "query": f"{_text(parsed.get('role_title'))}. {keywords}",
                "mode": "hybrid",
            }
        else:
            body["sorts"] = [{"field": "metadata.updated_at", "order": "desc"}]
        endpoint = "https://api.crustdata.com/person/search"
    else:
        industry_conditions = [
            {"field": field, "type": "(.)", "value": term}
            for term in industry_terms
            for field in (
                "taxonomy.professional_network_industry",
                "taxonomy.categories",
                "taxonomy.professional_network_specialities",
            )
        ]
        conditions.extend(
            [
                _condition_or_single(industry_conditions),
                {
                    "field": "locations.headquarters",
                    "type": "(.)",
                    "value": _text(parsed.get("location")),
                },
            ]
        )
        keywords = _text(parsed.get("keywords"))
        if keywords:
            conditions.append(
                _condition_or_single(
                    [
                        {"field": field, "type": "(.)", "value": keywords}
                        for field in (
                            "basic_info.name",
                            "taxonomy.categories",
                            "taxonomy.professional_network_specialities",
                        )
                    ]
                )
            )
        conditions.extend(_headcount_conditions("headcount.total", _text(parsed.get("company_headcount"))))
        body = {
            "filters": {"op": "and", "conditions": conditions},
            "fields": [
                "metadata.updated_at",
                "basic_info.name",
                "basic_info.website",
                "basic_info.professional_network_url",
                "basic_info.company_type",
                "headcount.total",
                "locations.country",
                "locations.state",
                "locations.city",
                "locations.headquarters",
                "taxonomy.professional_network_industry",
                "taxonomy.categories",
                "taxonomy.professional_network_specialities",
            ],
            "sorts": [{"column": "headcount.total", "order": "desc"}],
            "limit": int(parsed.get("max_results", DEFAULT_LIMIT)),
        }
        endpoint = "https://api.crustdata.com/company/search"

    max_credits = round(int(parsed.get("max_results", DEFAULT_LIMIT)) * SEARCH_CREDITS_PER_RESULT, 2)
    scope = "\x1f".join(
        _text(parsed.get(key))
        for key in (
            "search_mode",
            "industry",
            "location",
            "role_title",
            "keywords",
            "company_headcount",
        )
    ) + f"\x1f{int(parsed.get('max_results', DEFAULT_LIMIT))}"
    digest = 2166136261
    utf16 = scope.encode("utf-16le")
    for index in range(0, len(utf16), 2):
        code_unit = utf16[index] | (utf16[index + 1] << 8)
        digest = ((digest ^ code_unit) * 16777619) & 0xFFFFFFFF
    approval_code = f"{digest:08X}"
    return {
        "endpoint": endpoint,
        "api_version": "2025-11-01",
        "body": body,
        "estimated_max_credits": max_credits,
        "approval_phrase": f"APPROVE CRUSTDATA {max_credits:.2f} CREDITS {approval_code}",
    }


def approval_matches(current_user_instruction: Any, parsed: Mapping[str, Any]) -> bool:
    expected = build_crustdata_request(parsed)["approval_phrase"]
    return _text(current_user_instruction) == expected


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


def _criteria_status(
    parsed: Mapping[str, Any], visible: Mapping[str, Any], fields: Sequence[tuple[str, str]]
) -> tuple[str, list[str], list[str], list[str]]:
    evidence: list[str] = []
    unverified: list[str] = []
    conflicts: list[str] = []
    for key, label in fields:
        expected_raw = parsed.get(key)
        if not _text(expected_raw):
            continue
        actual = _normalise(visible.get(key))
        if not actual:
            unverified.append(label)
            continue
        if key == "company_headcount":
            matches = _headcount_matches(expected_raw, visible.get(key))
        elif key == "industry":
            matches = any(_normalise(term) in actual for term in _terms(expected_raw))
        else:
            expected = _normalise(expected_raw)
            matches = expected in actual or actual in expected
        (evidence if matches else conflicts).append(label)
    status = "excluded" if conflicts else ("qualified" if evidence else "unverified")
    return status, evidence, unverified, conflicts


def _format_profile(profile: Mapping[str, Any], parsed: Mapping[str, Any]) -> dict[str, Any]:
    role = _current_role(profile)
    basic = profile.get("basic_profile") if isinstance(profile.get("basic_profile"), Mapping) else {}
    network = _nested(profile, "social_handles", "professional_network_identifier") or {}
    name = _first_text(profile.get("name"), basic.get("name"))
    title = _first_text(profile.get("current_title"), basic.get("current_title"), role.get("title"))
    company = _first_text(profile.get("company"), profile.get("current_company"), role.get("name"), role.get("company_name"))
    location = _first_text(profile.get("location"), basic.get("location"), _nested(profile, "professional_network", "location"))
    headline = _first_text(profile.get("headline"), basic.get("headline"))
    industry = _first_text(profile.get("industry"), role.get("company_professional_network_industry"), role.get("company_industries"))
    headcount = _first_text(profile.get("company_headcount"), role.get("company_headcount_range"), str(role.get("company_headcount_latest")) if role.get("company_headcount_latest") is not None else "")
    profile_url = _canonical_linkedin_url(_first_text(profile.get("profile_url"), profile.get("linkedin_url"), network.get("profile_url")), "person")
    company_url = _canonical_linkedin_url(_first_text(profile.get("company_profile_url"), profile.get("company_linkedin_url"), role.get("company_professional_network_profile_url"), role.get("company_linkedin_profile_url")), "company")
    status, evidence, unverified, conflicts = _criteria_status(
        parsed,
        {
            "role_title": " ".join(filter(None, (title, headline))),
            "location": location,
            "industry": " ".join(filter(None, (industry, headline))),
            "company_headcount": headcount,
        },
        (("role_title", "role title"), ("location", "location"), ("industry", "industry"), ("company_headcount", "company headcount")),
    )
    if not profile_url:
        conflicts.append("missing valid public LinkedIn profile URL")
        status = "excluded"
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
        "fit": _first_text(profile.get("fit")) or None,
        "last_updated": _first_text(_nested(profile, "metadata", "updated_at")) or None,
        "criteria_status": status,
        "match_evidence": evidence,
        "unverified_criteria": unverified,
        "conflicting_criteria": conflicts,
    }


def _format_company(company: Mapping[str, Any], parsed: Mapping[str, Any]) -> dict[str, Any]:
    basic = company.get("basic_info") if isinstance(company.get("basic_info"), Mapping) else {}
    locations = company.get("locations") if isinstance(company.get("locations"), Mapping) else {}
    taxonomy = company.get("taxonomy") if isinstance(company.get("taxonomy"), Mapping) else {}
    headcount = company.get("headcount") if isinstance(company.get("headcount"), Mapping) else {}
    name = _first_text(company.get("name"), basic.get("name"))
    location = _first_text(locations.get("headquarters"), ", ".join(filter(None, (_text(locations.get("city")), _text(locations.get("state")), _text(locations.get("country"))))))
    industry = _first_text(taxonomy.get("professional_network_industry"), taxonomy.get("categories"), taxonomy.get("professional_network_specialities"))
    keyword_text = " ".join(filter(None, (name, _first_text(taxonomy.get("categories")), _first_text(taxonomy.get("professional_network_specialities")))))
    company_url = _canonical_linkedin_url(_first_text(company.get("company_profile_url"), company.get("linkedin_url"), basic.get("professional_network_url"), _nested(company, "social_profiles", "professional_network")), "company")
    status, evidence, unverified, conflicts = _criteria_status(
        parsed,
        {"location": location, "industry": industry, "keywords": keyword_text, "company_headcount": str(headcount.get("total")) if headcount.get("total") is not None else ""},
        (("location", "location"), ("industry", "industry"), ("keywords", "keywords"), ("company_headcount", "company headcount")),
    )
    if not company_url:
        conflicts.append("missing valid public LinkedIn company URL")
        status = "excluded"
    return {
        "name": name or None,
        "company_profile_url": company_url,
        "website": _first_text(basic.get("website")) or None,
        "company_type": _first_text(basic.get("company_type")) or None,
        "industry": industry or None,
        "headquarters": location or None,
        "company_headcount": headcount.get("total") if isinstance(headcount.get("total"), (int, float)) else None,
        "categories": taxonomy.get("categories") if isinstance(taxonomy.get("categories"), list) else [],
        "specialities": taxonomy.get("professional_network_specialities") if isinstance(taxonomy.get("professional_network_specialities"), list) else [],
        "last_updated": _first_text(_nested(company, "metadata", "updated_at")) or None,
        "criteria_status": status,
        "match_evidence": evidence,
        "unverified_criteria": unverified,
        "conflicting_criteria": conflicts,
    }


def format_response(response: Mapping[str, Any], parsed: Mapping[str, Any]) -> dict[str, Any]:
    mode = _text(parsed.get("search_mode"))
    key = "profiles" if mode == "people" else "companies"
    raw_items = response.get(key, response.get("data", []))
    if not isinstance(raw_items, Sequence) or isinstance(raw_items, (str, bytes)):
        raw_items = []
    formatter = _format_profile if mode == "people" else _format_company
    qualified: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    seen: set[str] = set()
    url_key = "profile_url" if mode == "people" else "company_profile_url"
    for raw in raw_items:
        if not isinstance(raw, Mapping):
            continue
        item = formatter(raw, parsed)
        identity = item.get(url_key)
        if not identity or identity in seen:
            if item.get("criteria_status") == "excluded" and identity not in seen:
                excluded.append(item)
            continue
        seen.add(identity)
        (excluded if item["criteria_status"] == "excluded" else qualified).append(item)
        if len(qualified) >= int(parsed.get("max_results", DEFAULT_LIMIT)):
            break

    employer_companies: list[dict[str, Any]] = []
    if mode == "people":
        company_seen: set[str] = set()
        for profile in qualified:
            url = profile.get("company_profile_url")
            if url and url not in company_seen:
                company_seen.add(url)
                employer_companies.append({"company": profile.get("company"), "company_profile_url": url})

    credits = response.get("credits_cost", response.get("credits_used"))
    if not isinstance(credits, (int, float)) or isinstance(credits, bool):
        credits = round(len(raw_items) * SEARCH_CREDITS_PER_RESULT, 2)
    criteria = {key: parsed.get(key) or None for key in ("search_mode", "industry", "location", "role_title", "keywords", "company_headcount", "max_results")}
    return {
        "ok": True,
        "search_mode": mode,
        "profiles": qualified if mode == "people" else [],
        "profile_urls": [item["profile_url"] for item in qualified] if mode == "people" else [],
        "companies": employer_companies if mode == "people" else qualified,
        "company_urls": [item["company_profile_url"] for item in (employer_companies if mode == "people" else qualified)],
        "excluded_results": excluded,
        "total_count": len(qualified),
        "provider_total_count": response.get("total_count"),
        "credits_cost": credits,
        "search_criteria": criteria,
        "coverage": "Bounded indexed-provider result; not exhaustive",
    }


def build_manual_queries(params: Mapping[str, Any]) -> dict[str, Any]:
    parsed = parse_input(params)
    quote = lambda value: f'"{_text(value).replace(chr(34), "")}"'
    if parsed["search_mode"] == "people":
        query = " ".join(("site:linkedin.com/in/", quote(parsed["role_title"]), quote(parsed["location"]), quote(parsed["industry"]), quote(parsed["keywords"]) if parsed["keywords"] else "")).strip()
        cannot_verify = ["current role assignment"]
    else:
        query = " ".join(("site:linkedin.com/company/", quote(parsed["location"]), quote(parsed["industry"]), quote(parsed["keywords"]) if parsed["keywords"] else "")).strip()
        cannot_verify = []
    if parsed.get("company_headcount"):
        cannot_verify.append("company_headcount")
    return {
        "ok": True,
        "mode": "manual_query_only",
        "search_mode": parsed["search_mode"],
        "queries": [query],
        "cannot_verify_from_query": cannot_verify,
        "message": "This is a search string, not returned or qualified research.",
    }


def _self_test() -> None:
    people = parse_input({"search_mode": "people", "industry": "Health care, Information Technology", "location": "Australia", "role_title": "Head of Operations", "company_headcount": "51-200", "keywords": "digital health", "max_results": 10})
    request = build_crustdata_request(people)
    assert request["endpoint"].endswith("/person/search")
    assert request["estimated_max_credits"] == 0.3
    assert re.fullmatch(r"APPROVE CRUSTDATA 0\.30 CREDITS [A-F0-9]{8}", request["approval_phrase"])
    assert request["body"]["mode"] == "exact" and request["body"]["search"]["mode"] == "hybrid"
    assert approval_matches(request["approval_phrase"], people)
    assert not approval_matches("yes", people)

    person_result = format_response({"profiles": [{"basic_profile": {"name": "Alex Morgan", "headline": "Health care operations leader", "location": {"full_location": "Melbourne, Australia"}}, "social_handles": {"professional_network_identifier": {"profile_url": "https://au.linkedin.com/in/alex-morgan/?trk=test"}}, "experience": {"employment_details": {"current": [{"name": "Care Systems", "title": "Head of Operations", "company_professional_network_profile_url": "https://linkedin.com/company/care-systems/", "company_professional_network_industry": "Health care", "company_headcount_latest": 125}]}}}], "total_count": 1}, people)
    assert person_result["profile_urls"] == ["https://www.linkedin.com/in/alex-morgan"]
    assert person_result["company_urls"] == ["https://www.linkedin.com/company/care-systems"]

    companies = parse_input({"search_mode": "companies", "industry": "Technology, Nonprofit", "location": "Melbourne, Victoria, Australia", "keywords": "AI communities", "max_results": 5})
    company_request = build_crustdata_request(companies)
    assert company_request["endpoint"].endswith("/company/search")
    assert company_request["estimated_max_credits"] == 0.15
    company_result = format_response({"companies": [{"basic_info": {"name": "Melbourne AI Communities", "website": "https://example.org", "professional_network_url": "https://linkedin.com/company/melbourne-ai-community"}, "locations": {"headquarters": "Melbourne, Victoria, Australia"}, "taxonomy": {"professional_network_industry": "Nonprofit", "categories": ["AI Communities"]}, "headcount": {"total": 12}}]}, companies)
    assert company_result["company_urls"] == ["https://www.linkedin.com/company/melbourne-ai-community"]

    manual = build_manual_queries(companies)
    assert manual["search_mode"] == "companies" and len(manual["queries"]) == 1

    for invalid in (
        {"search_mode": "people", "industry": "Health care", "location": "Australia"},
        {"search_mode": "companies", "industry": "Tech", "location": "Australia", "max_results": 500},
        {"search_mode": "companies", "industry": "Tech", "location": "Australia", "company_headcount": "many"},
    ):
        try:
            parse_input(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Invalid input should fail: {invalid}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--manual-query", action="store_true")
    parser.add_argument("--mode", choices=SEARCH_MODES, default="people")
    parser.add_argument("--industry")
    parser.add_argument("--location")
    parser.add_argument("--role-title", default="")
    parser.add_argument("--keywords", default="")
    parser.add_argument("--company-headcount", default="")
    parser.add_argument("--max-results", type=int, default=DEFAULT_LIMIT)
    args = parser.parse_args()

    if args.self_test:
        _self_test()
        print(json.dumps({"ok": True, "tests": 8}))
        return
    if args.manual_query:
        result = build_manual_queries({"search_mode": args.mode, "industry": args.industry, "location": args.location, "role_title": args.role_title, "keywords": args.keywords, "company_headcount": args.company_headcount, "max_results": args.max_results})
        print(json.dumps(result, indent=2))
        return
    parser.error("Choose --self-test or --manual-query.")


if __name__ == "__main__":
    main()
