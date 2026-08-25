(function () {
  "use strict";

  const ROW_SELECTORS = [
    "[data-statement-line-id]",
    "[data-testid='bank-reconciliation-row']",
    "[data-testid*='reconcile'][data-id]",
    "tr[data-bank-transaction-id]",
    "#statementLines > .line[data-statementlineid]"
  ];

  const LEGACY_ROW_SELECTOR = "#statementLines > .line[data-statementlineid]";

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function first(root, selectors) {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function visible(element) {
    if (!element) return false;
    for (let current = element; current && current !== document; current = current.parentElement) {
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return element.getClientRects().length > 0;
  }

  function textFrom(root, selectors) {
    const element = first(root, selectors);
    if (!element || !visible(element)) return "";
    return normalize(element.value !== undefined ? element.value : element.textContent);
  }

  function dataOrText(root, dataNames, selectors) {
    for (const name of dataNames) {
      const value = root.getAttribute(name);
      if (normalize(value)) return normalize(value);
    }
    return textFrom(root, selectors);
  }

  function selectedValue(root, semanticName) {
    const escaped = CSS.escape(semanticName);
    return dataOrText(
      root,
      [`data-current-${semanticName}`, `data-${semanticName}`],
      [
        `[data-capture-field='${escaped}']`,
        `[data-testid*='${escaped}'] input`,
        `[data-testid*='${escaped}'] [role='combobox']`,
        `input[name*='${escaped}' i]`,
        `textarea[name*='${escaped}' i]`,
        `[aria-label*='${escaped}' i]`
      ]
    );
  }

  function transactionId(row) {
    const direct = dataOrText(
      row,
      ["data-existing-transaction-id", "data-matched-xero-transaction-id"],
      [
        "[data-existing-transaction-id]",
        "[data-matched-xero-transaction-id]",
        "[data-transactionid]",
        "[data-transaction-id]",
        "input[name*='transactionId' i][value]"
      ]
    );
    if (direct) return direct;
    const link = first(row, [
      "a[href*='/Bank/ViewTransaction/']",
      "a[href*='/Transactions/View/']",
      "a[href*='transactionId=']"
    ]);
    if (!link) return "";
    const match = link.href.match(/(?:ViewTransaction\/|Transactions\/View\/|transactionId=)([^/?&#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function activePanelName(row) {
    const selected = first(row, [
      "[role='tab'][aria-selected='true']",
      "[data-testid*='tab'][aria-selected='true']",
      "[role='tab'].active",
      ".xui-tab--active"
    ]);
    return normalize(selected && selected.textContent).toLowerCase();
  }

  function legacyState(row) {
    if (!row.matches(LEGACY_ROW_SELECTOR)) return "";
    const visiblePanel = Array.from(
      row.querySelectorAll(":scope > .statement:not(.bank-transaction) > .info")
    ).find(visible);
    if (visiblePanel) {
      if (visiblePanel.classList.contains("c0")) return "match";
      if (visiblePanel.classList.contains("c2")) return "create";
      if (visiblePanel.classList.contains("c5")) return "discuss";
    }
    const stateRoot = Array.from(row.children).find(
      (element) => element.classList.contains("statement") && !element.classList.contains("bank-transaction")
    );
    if (!stateRoot) return "";
    if (stateRoot.classList.contains("create")) return "create";
    if (stateRoot.classList.contains("comments")) return "discuss";
    if (stateRoot.classList.contains("match")) return "match";
    return "";
  }

  function classifyMode(row, fields, existingTransactionId, warnings) {
    const active = legacyState(row) || activePanelName(row);
    if (/\bmatch\b/.test(active)) {
      if (existingTransactionId) return "green_match";
      warnings.push("Match tab was visible without an existing transaction ID");
      return "unknown";
    }
    if (/\bdiscuss\b/.test(active)) return "discuss";
    const hasPrefill = Object.values(fields).some(Boolean);
    if (/\bcreate\b/.test(active)) return hasPrefill ? "create_prefilled" : "blank_create";
    if (hasPrefill) return "create_prefilled";
    warnings.push("active reconciliation tab was not identifiable");
    return "unknown";
  }

  function parseAmount(raw) {
    const negative = /^\s*-/.test(raw) || /^\s*\(/.test(raw);
    const cleaned = normalize(raw).replace(/[^0-9.]/g, "");
    if (!cleaned || !/^\d+(?:\.\d+)?$/.test(cleaned)) {
      throw new Error(`could not parse amount '${normalize(raw)}'`);
    }
    return { amount: cleaned, negative };
  }

  function parseDate(raw) {
    const value = normalize(raw);
    let year;
    let month;
    let day;
    let match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value);
    if (match) [, year, month, day] = match;
    if (!match) {
      match = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec(value);
      if (match) {
        const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
        const index = months.indexOf(match[2].slice(0, 3).toLowerCase());
        if (index !== -1) {
          day = match[1];
          month = String(index + 1);
          year = match[3];
        }
      }
    }
    if (!year) {
      match = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(value);
      if (match) [, day, month, year] = match;
    }
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (!Number.isInteger(y) || y < 1900 || y > 2200 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
      throw new Error(`could not parse date '${value}'`);
    }
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function legacyTrackingValue(panel, index, placeholder) {
    const inputs = Array.from(panel.querySelectorAll(".tracking input[type='text']"));
    const value = normalize(inputs[index] && inputs[index].value);
    return value.toLowerCase() === placeholder.toLowerCase() ? "" : value;
  }

  function legacyFields(row) {
    const empty = {
      contact: "",
      account: "",
      description: "",
      tax_type: "",
      event_name: "",
      project_name: ""
    };
    if (legacyState(row) !== "create") return empty;
    const panel = row.querySelector(":scope > .statement:not(.bank-transaction) > .info.c2");
    if (!panel || !visible(panel)) return empty;
    const compactId = normalize(row.getAttribute("data-statementlineid")).replace(/-/g, "");
    const value = (selector) => normalize((row.querySelector(selector) || {}).value);
    return {
      contact: value(`#paidTo${compactId}_value`),
      account: value(`#paidAccount${compactId}_value`),
      description: value(`#paidDesc${compactId}`),
      event_name: legacyTrackingValue(panel, 0, "Event Name"),
      project_name: legacyTrackingValue(panel, 1, "Project Name"),
      tax_type: legacyTrackingValue(panel, 2, "Tax Rate")
    };
  }

  function capturedFields(row) {
    if (row.matches(LEGACY_ROW_SELECTOR)) return legacyFields(row);
    return {
      contact: selectedValue(row, "contact"),
      account: selectedValue(row, "account"),
      description: selectedValue(row, "description"),
      tax_type: selectedValue(row, "tax"),
      event_name: selectedValue(row, "event"),
      project_name: selectedValue(row, "project")
    };
  }

  function legacyAmount(row) {
    const candidates = [
      ["debit", textFrom(row, [".amount-spent"]).replace(/^Spent\s*/i, "")],
      ["credit", textFrom(row, [".amount-received"]).replace(/^Received\s*/i, "")]
    ].filter((candidate) => /\d/.test(candidate[1]));
    if (candidates.length !== 1) throw new Error("legacy row has no unambiguous spent/received amount");
    const parsed = parseAmount(candidates[0][1]);
    return { direction: candidates[0][0], amount: parsed.amount };
  }

  function captureRow(row) {
    const warnings = [];
    const statementLineId = dataOrText(
      row,
      ["data-statement-line-id", "data-statementlineid", "data-bank-transaction-id", "data-id"],
      ["[data-statement-line-id]", "input[name*='statementLineId' i]"]
    );
    if (!statementLineId) throw new Error("statement line has no stable ID");

    const date = dataOrText(
      row,
      ["data-statement-date", "data-date"],
      ["[data-testid='posted-date']", "[data-testid*='date']", ".statement-date", "time"]
    );
    if (!date) throw new Error(`${statementLineId} has no visible date`);
    let parsedAmount;
    let direction;
    if (row.matches(LEGACY_ROW_SELECTOR)) {
      const legacy = legacyAmount(row);
      parsedAmount = { amount: legacy.amount, negative: false };
      direction = legacy.direction;
    } else {
      const rawAmount = dataOrText(
        row,
        ["data-amount"],
        ["[data-testid*='amount']", ".statement-amount", ".amount"]
      );
      parsedAmount = parseAmount(rawAmount);
      const explicitDirection = normalize(row.getAttribute("data-direction")).toLowerCase();
      const rowText = normalize(row.textContent).toLowerCase();
      direction = explicitDirection;
      if (!["debit", "credit"].includes(direction)) {
        if (parsedAmount.negative || /\bspent\b|\bpayment\b|\bdebit\b/.test(rowText)) direction = "debit";
        else if (/\breceived\b|\bdeposit\b|\bcredit\b/.test(rowText)) direction = "credit";
        else throw new Error(`${statementLineId} has no unambiguous direction`);
      }
    }

    const fields = capturedFields(row);
    const existingTransactionId = transactionId(row);
    const okButton = Array.from(row.querySelectorAll("a, button, [role='button']")).find(
      (element) => visible(element) && /^ok$/i.test(normalize(element.textContent))
    );
    return {
      statement_line_id: statementLineId,
      date: parseDate(date),
      narration: dataOrText(
        row,
        ["data-narration"],
        ["[data-testid='payee']", "[data-testid*='narration']", ".statement-narration"]
      ),
      reference: dataOrText(
        row,
        ["data-reference"],
        ["[data-testid='reference']", "[data-testid*='reference']", ".statement-reference"]
      ),
      direction,
      amount: parsedAmount.amount,
      currency: normalize(row.getAttribute("data-currency") || document.documentElement.dataset.currency || "AUD").toUpperCase(),
      ...fields,
      ui_mode: classifyMode(row, fields, existingTransactionId, warnings),
      matched_xero_transaction_id: existingTransactionId,
      has_ok_button: Boolean(okButton),
      parse_warnings: warnings
    };
  }

  function bankAccountId() {
    const root = document.querySelector("[data-bank-account-id]");
    if (root && normalize(root.getAttribute("data-bank-account-id"))) {
      return normalize(root.getAttribute("data-bank-account-id"));
    }
    const url = new URL(window.location.href);
    for (const key of ["bankAccountID", "bankAccountId", "accountID", "accountId"]) {
      if (url.searchParams.get(key)) return normalize(url.searchParams.get(key));
    }
    const pathMatch = url.pathname.match(/\/Bank\/(?:Reconcile|Reconciliation)\/([^/?#]+)/i);
    return pathMatch ? decodeURIComponent(pathMatch[1]) : "";
  }

  function paginationEvidence(observedCount) {
    const legacyRows = Array.from(document.querySelectorAll(LEGACY_ROW_SELECTOR));
    if (legacyRows.length) {
      const scripts = Array.from(document.querySelectorAll("#ItemsToReconcile script"))
        .map((script) => script.textContent || "")
        .join("\n");
      const totalMatch = scripts.match(/\b_TotalCount\s*=\s*([0-9,]+)/);
      const reconcileText = normalize((document.querySelector("a[href*='BankRec.aspx']") || {}).textContent);
      const reconcileMatch = reconcileText.match(/\(([0-9,]+)\)/);
      const expectedCount = Number(
        String((totalMatch && totalMatch[1]) || (reconcileMatch && reconcileMatch[1]) || "").replace(/,/g, "")
      );
      const allRowsPresent = Number.isInteger(expectedCount) && expectedCount === observedCount;
      if (allRowsPresent) {
        return {
          expected_count: expectedCount,
          page: {
            page_number: 1,
            page_count: 1,
            observed_count: observedCount,
            has_previous: false,
            has_next: false
          },
          complete_dom_coverage: true,
          layout: "legacy_bankrec"
        };
      }
    }
    const container = first(document, [
      "[data-testid*='pagination']",
      "nav[aria-label*='pagination' i]",
      ".pagination"
    ]);
    let current = 1;
    let pageCount = 1;
    let expectedCount = null;
    if (container) {
      const currentElement = first(container, ["[aria-current='page']", "[data-current-page]"]);
      current = Number(normalize(currentElement && (currentElement.dataset.currentPage || currentElement.textContent))) || 1;
      const numbered = Array.from(container.querySelectorAll("button, a"))
        .map((element) => Number(normalize(element.textContent)))
        .filter((value) => Number.isInteger(value) && value > 0);
      pageCount = numbered.length ? Math.max(...numbered) : Number(container.dataset.pageCount) || 1;
      const totalText = normalize(container.getAttribute("data-total-count") || container.textContent);
      const totalMatch = totalText.match(/\bof\s+([0-9,]+)\b/i);
      expectedCount = Number((container.getAttribute("data-total-count") || (totalMatch && totalMatch[1]) || "").replace(/,/g, ""));
      if (!Number.isInteger(expectedCount)) expectedCount = null;
    }
    const previous = container && first(container, ["[aria-label*='previous' i]", "[rel='prev']"]);
    const next = container && first(container, ["[aria-label*='next' i]", "[rel='next']"]);
    const enabled = (element) => Boolean(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true";
    return {
      expected_count: expectedCount,
      page: {
        page_number: current,
        page_count: pageCount,
        observed_count: observedCount,
        has_previous: enabled(previous),
        has_next: enabled(next)
      },
      complete_dom_coverage: pageCount === 1 && expectedCount === observedCount,
      layout: legacyRows.length ? "legacy_bankrec_partial" : "modern"
    };
  }

  function capturePage() {
    const errors = [];
    const rows = Array.from(document.querySelectorAll(ROW_SELECTORS.join(",")));
    const uniqueRows = rows.filter((row, index) => rows.indexOf(row) === index);
    const lines = [];
    for (const row of uniqueRows) {
      try {
        lines.push(captureRow(row));
      } catch (error) {
        errors.push(String(error && error.message ? error.message : error));
      }
    }
    if (!rows.length) errors.push("no Xero reconciliation rows were visible");
    const accountId = bankAccountId();
    if (!accountId) errors.push("bank account ID was not visible in the page or URL");
    const coverage = paginationEvidence(lines.length);
    return {
      bank_account_id: accountId,
      expected_count: coverage.expected_count,
      page: coverage.page,
      lines,
      capture_error: errors.join("; "),
      complete_dom_coverage: coverage.complete_dom_coverage,
      layout: coverage.layout
    };
  }

  function applyAnnotations(annotations) {
    document.querySelectorAll("[data-xero-capture-annotation]").forEach((node) => node.remove());
    const byId = new Map((annotations || []).map((item) => [String(item.statementLineId || ""), item]));
    const rows = Array.from(document.querySelectorAll(ROW_SELECTORS.join(",")));
    let applied = 0;
    for (const row of rows) {
      const id = dataOrText(
        row,
        ["data-statement-line-id", "data-statementlineid", "data-bank-transaction-id", "data-id"],
        ["[data-statement-line-id]", "input[name*='statementLineId' i]"]
      );
      const item = byId.get(id);
      if (!item || !normalize(item.likelyDescription)) continue;
      const label = document.createElement("div");
      label.setAttribute("data-xero-capture-annotation", "true");
      label.setAttribute("role", "note");
      label.style.cssText = "pointer-events:none;margin:6px 0;padding:7px 9px;border-left:3px solid #1769aa;background:#edf6ff;color:#16324f;font:12px/1.35 system-ui,sans-serif;";
      const description = normalize(item.likelyDescription);
      const question = normalize(item.reviewQuestion);
      const blocker = normalize(item.blockerReason);
      if (item.readyInXero === true) label.textContent = "Prepared in Xero — check Match or Find & Match";
      else if (item.resultLane === "ready_to_prepare") label.textContent = `Ready for approval: ${description}`;
      else if (item.resultLane === "existing_match") label.textContent = `Find & Match in Xero: ${description}`;
      else if (item.resultLane === "blocked") label.textContent = `Blocked: ${blocker || question || description}`;
      else label.textContent = `Likely: ${description}${question ? ` — ${question}` : ""}`;
      if (normalize(item.evidenceSummary)) label.title = normalize(item.evidenceSummary);
      row.appendChild(label);
      applied += 1;
    }
    return applied;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return false;
    try {
      if (message.type === "CAPTURE_XERO_PAGE") {
        sendResponse({ ok: true, capture: capturePage() });
        return false;
      }
      if (message.type === "APPLY_XERO_ANNOTATIONS") {
        sendResponse({ ok: true, applied: applyAnnotations(message.annotations) });
        return false;
      }
    } catch (error) {
      sendResponse({ ok: false, error: String(error && error.message ? error.message : error) });
    }
    return false;
  });
})();
