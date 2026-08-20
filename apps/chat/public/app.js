(() => {
  "use strict";

  const DEFAULT_CONFIG = {
    name: "Project Manager",
    subtitle:
      "Turn meetings, documents, and project ideas into clear next actions.",
    welcomeMessage:
      "Hello! I’m your Project Manager. Add a meeting transcript or tell me what you’re working on, and I’ll help turn it into decisions, plans, and safe next actions.",
    primaryColour: "#6D4AFF",
    examplePrompts: [
      "Turn these meeting notes into decisions and action items",
      "Build a practical project plan from this document",
      "Show me the highest-priority work in my local project",
    ],
  };
  const WORKSPACE_NAME = "My AI Agent";
  const DEFAULT_AGENTS = [
    {
      id: "project-manager",
      name: "Project Manager",
      description:
        "Plans projects, analyses meetings, and turns decisions into safe next actions.",
      status: "active",
      accentColour: "violet",
      examplePrompts: DEFAULT_CONFIG.examplePrompts,
      settingsFields: [
        {
          id: "teamMembers",
          label: "Who is usually in your meetings",
          description: "Names and roles you refer to often.",
          kind: "line",
          maxLength: 300,
        },
        {
          id: "taskConventions",
          label: "How you word and time your to-dos",
          description: "Preferred task style, timing, and ownership conventions.",
          kind: "block",
          maxLength: 800,
        },
      ],
      skills: [],
      syncRequired: true,
    },
    {
      id: "sales",
      name: "Sales",
      description: "Researches prospects, drafts replies, and turns calls into proposals.",
      status: "active",
      accentColour: "teal",
      examplePrompts: [
        "Draft a reply to this enquiry that just came in",
        "Turn these call notes into a recap and a proposal",
        "Write a cold email to this person",
      ],
      settingsFields: [
        {
          id: "idealCustomer",
          label: "Who you sell to",
          description: "Sector, job titles, and company size.",
          kind: "line",
          maxLength: 300,
        },
        {
          id: "outreachTone",
          label: "How your outreach should sound",
          description: "Tone, structure, and words to avoid.",
          kind: "block",
          maxLength: 800,
        },
      ],
      skills: [],
      syncRequired: true,
    },
    {
      id: "marketing",
      name: "Marketing",
      description: "Plans campaigns and creates grounded content from supplied or researched evidence.",
      status: "active",
      accentColour: "amber",
      examplePrompts: [
        "Turn these customer notes into three grounded content themes",
        "Build a practical campaign plan from this brief",
        "Review this draft and identify unsupported claims",
      ],
      settingsFields: [
        {
          id: "websiteDomain",
          label: "Your website address",
          description: "The main public domain for your business.",
          kind: "line",
          maxLength: 300,
        },
        {
          id: "contentVoice",
          label: "How your content should sound, and words to avoid",
          description: "Content-specific voice and language boundaries.",
          kind: "block",
          maxLength: 800,
        },
      ],
      skills: [],
      syncRequired: true,
    },
    {
      id: "investment",
      name: "Investment",
      description: "Reviews grants, funding evidence, and business updates without making financial decisions.",
      status: "active",
      accentColour: "emerald",
      examplePrompts: [
        "Compare these two funding opportunities from the supplied documents",
        "Turn this grant brief into eligibility questions and deadlines",
        "Draft a factual investor update from these notes",
      ],
      settingsFields: [
        {
          id: "eligibilityFacts",
          label: "Where your business is registered and what stage it is at",
          description: "Location, structure, stage, and other eligibility facts.",
          kind: "line",
          maxLength: 300,
        },
        {
          id: "updateAudience",
          label: "Who reads your monthly update and what they want to hear",
          description: "Audience, detail level, and sensitive topics to leave out.",
          kind: "block",
          maxLength: 800,
        },
      ],
      skills: [],
      syncRequired: true,
    },
    {
      id: "bookkeeping",
      name: "Bookkeeping",
      description: "Prepares coding-review suggestions and questions for the user to complete in their accounting system.",
      status: "active",
      accentColour: "rose",
      examplePrompts: [
        "Review these transactions and suggest coding categories with confidence",
        "List the questions I should take to my bookkeeper from this statement",
        "Summarise the unpaid invoices in this document",
      ],
      settingsFields: [
        {
          id: "commonSuppliers",
          label: "Your regular suppliers and what each spend is for",
          description: "One supplier and its usual purpose per line.",
          kind: "block",
          maxLength: 800,
        },
        {
          id: "accountRules",
          label: "Accounts or categories you use, and how you split personal from business",
          description: "Your own coding rules; suggestions still require human review.",
          kind: "block",
          maxLength: 800,
        },
      ],
      skills: [],
      syncRequired: true,
    },
  ];
  const SKILL_ICONS = {
    checklist: "M4 7h9M4 12h9M4 17h6m6-9 2 2 4-4M16 17l2 2 4-4",
    profile: "M12 12a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2ZM5 20a7 7 0 0 1 14 0",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5.2-1.8L21 21",
    globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.6 2.5 15 0 18-2.5-3-2.5-15.4 0-18Z",
    article: "M6 3h9l4 4v14H6V3Zm9 0v4h4M9 12h7M9 16h5",
    grant: "M12 3 4 7v5c0 4.6 3.3 8.3 8 9 4.7-.7 8-4.4 8-9V7l-8-4Zm-2.6 8.6 2 2 3.8-4",
    calendar: "M5 6h14v14H5V6Zm0 4h14M9 3v4m6-4v4m-4 8h4",
    ledger: "M5 4h11l3 3v13H5V4Zm3 5h6M8 13h8M8 17h5",
  };
  const SKILL_ICON_BY_ID = {
    "meeting-to-actions": "checklist",
    "project-assistant": "checklist",
    "meeting-analysis": "checklist",
    "task-capture": "checklist",
    "weekly-status": "calendar",
    "linkedin-profile-lookup": "profile",
    "linkedin-prospect-search": "search",
    "domain-research": "globe",
    "paid-domain-research": "globe",
    "seo-article-writer": "article",
    "seo-aeo-article-writer": "article",
    "funding-radar": "grant",
    "funding-and-investor-updates": "grant",
    "monthly-update": "calendar",
    "xero-coding-review": "ledger",
  };
  const STORAGE_KEY = "ai-solopreneur-chat-session";
  const MAX_DOCUMENTS = 3;
  const LARGE_PASTE_THRESHOLD = 4_000;

  const elements = {
    agentDialog: document.querySelector("#agent-dialog"),
    agentDialogChat: document.querySelector("#agent-dialog-chat"),
    agentDialogClose: document.querySelector("#agent-dialog-close"),
    agentDialogDescription: document.querySelector("#agent-dialog-description"),
    agentDialogFields: document.querySelector("#agent-dialog-fields"),
    agentDialogForm: document.querySelector("#agent-dialog-form"),
    agentDialogKicker: document.querySelector("#agent-dialog-kicker"),
    agentDialogSave: document.querySelector("#agent-dialog-save"),
    agentDialogSkills: document.querySelector("#agent-dialog-skills"),
    agentDialogStatus: document.querySelector("#agent-dialog-status"),
    agentDialogSync: document.querySelector("#agent-dialog-sync"),
    agentDialogTitle: document.querySelector("#agent-dialog-title"),
    agentPanel: document.querySelector(".agent-panel"),
    agentInitials: document.querySelector("#agent-initials"),
    agentList: document.querySelector("#agent-list"),
    agentName: document.querySelector("#agent-name"),
    agentSubtitle: document.querySelector("#agent-subtitle"),
    attachmentMenu: document.querySelector("#attachment-menu"),
    attachmentMenuButton: document.querySelector("#attachment-menu-button"),
    characterCount: document.querySelector("#character-count"),
    chatHeader: document.querySelector(".chat-header"),
    conversation: document.querySelector("#conversation"),
    conversationAgentName: document.querySelector("#conversation-agent-name"),
    conversationTitleText: document.querySelector("#conversation-title-text"),
    documentList: document.querySelector("#document-list"),
    documentStatus: document.querySelector("#document-status"),
    fileInput: document.querySelector("#file-input"),
    form: document.querySelector("#chat-form"),
    historyButton: document.querySelector("#history-button"),
    historyClose: document.querySelector("#history-close"),
    historyList: document.querySelector("#history-list"),
    historyMore: document.querySelector("#history-more"),
    historyNew: document.querySelector("#history-new"),
    historySearchForm: document.querySelector("#history-search-form"),
    historySearchInput: document.querySelector("#history-search-input"),
    historyStatus: document.querySelector("#history-status"),
    input: document.querySelector("#message-input"),
    mobileAgentInitials: document.querySelector("#mobile-agent-initials"),
    myBusinessButton: document.querySelector("#my-business-button"),
    pasteButton: document.querySelector("#paste-button"),
    pasteCancel: document.querySelector("#paste-cancel"),
    pasteDialog: document.querySelector("#paste-dialog"),
    pastedName: document.querySelector("#pasted-name"),
    pastedText: document.querySelector("#pasted-text"),
    pasteForm: document.querySelector("#paste-form"),
    profileAgentName: document.querySelector("#profile-agent-name"),
    profileAvatar: document.querySelector("#profile-avatar"),
    profileAvatarButton: document.querySelector("#profile-avatar-button"),
    profileAvatarInitials: document.querySelector("#profile-avatar-initials"),
    profileBoundaries: document.querySelector("#profile-boundaries"),
    profileBusinessName: document.querySelector("#profile-business-name"),
    profileCancel: document.querySelector("#profile-cancel"),
    profileDialog: document.querySelector("#profile-dialog"),
    profileForm: document.querySelector("#profile-form"),
    profileOffer: document.querySelector("#profile-offer"),
    profilePrice: document.querySelector("#profile-price"),
    profileSample1: document.querySelector("#profile-sample-1"),
    profileSample2: document.querySelector("#profile-sample-2"),
    profileSave: document.querySelector("#profile-save"),
    profileStatus: document.querySelector("#profile-status"),
    profileVoice: document.querySelector("#profile-voice"),
    profileWho: document.querySelector("#profile-who"),
    requestStatus: document.querySelector("#request-status"),
    resetButton: document.querySelector("#reset-button"),
    sendButton: document.querySelector("#send-button"),
    sendButtonLabel: document.querySelector("#send-button-label"),
    suggestionList: document.querySelector("#suggestion-list"),
    suggestions: document.querySelector("#suggestions"),
    uploadButton: document.querySelector("#upload-button"),
  };

  let sessionId = loadOrCreateSession();
  let requestInProgress = false;
  let documentRequestInProgress = false;
  let switchingConversation = false;
  let loadingMessage = null;
  let agents = DEFAULT_AGENTS;
  let activeAgentId = "project-manager";
  let uploadedDocuments = [];
  let sessionDocuments = [];
  let profile = null;
  let pendingAvatarDataUrl = "";
  let conversations = [];
  let nextConversationCursor = null;
  let currentMessages = [];
  let nextMessageBefore = null;
  let activeConversationTitle = "New conversation";
  let pendingRefreshTimer = null;
  let articleRefreshTimer = null;
  let agentSettings = null;
  let agentDialogAgentId = "";
  let agentDialogReturnFocus = null;
  const narrowLayout = window.matchMedia("(max-width: 50rem)");

  function cleanText(value, fallback, maximumLength) {
    if (typeof value !== "string") {
      return fallback;
    }
    const cleaned = value.trim();
    return cleaned.length > 0 ? cleaned.slice(0, maximumLength) : fallback;
  }

  function loadConfig() {
    const supplied =
      typeof window.AGENT_CONFIG === "object" && window.AGENT_CONFIG !== null
        ? window.AGENT_CONFIG
        : {};
    const prompts = Array.isArray(supplied.examplePrompts)
      ? supplied.examplePrompts
          .filter((prompt) => typeof prompt === "string" && prompt.trim())
          .slice(0, 6)
          .map((prompt) => prompt.trim().slice(0, 180))
      : DEFAULT_CONFIG.examplePrompts;
    const suppliedColour = cleanText(
      supplied.primaryColour,
      DEFAULT_CONFIG.primaryColour,
      40,
    );

    return {
      name: cleanText(supplied.name, DEFAULT_CONFIG.name, 60),
      subtitle: cleanText(
        supplied.subtitle,
        DEFAULT_CONFIG.subtitle,
        160,
      ),
      welcomeMessage: cleanText(
        supplied.welcomeMessage,
        DEFAULT_CONFIG.welcomeMessage,
        800,
      ),
      primaryColour:
        window.CSS?.supports("color", suppliedColour)
          ? suppliedColour
          : DEFAULT_CONFIG.primaryColour,
      examplePrompts:
        prompts.length > 0 ? prompts : DEFAULT_CONFIG.examplePrompts,
    };
  }

  const config = loadConfig();

  function activeAgent() {
    return (
      agents.find(
        (agent) => agent.id === activeAgentId && agent.status === "active",
      ) ?? agents.find((agent) => agent.status === "active")
    );
  }

  function workspaceName() {
    const saved = profile?.agentName ?? "";
    return saved.length > 0 ? saved : WORKSPACE_NAME;
  }

  function displayAgentName() {
    return activeAgent()?.name ?? config.name;
  }

  function getInitials(name) {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase();
  }

  function createSessionId() {
    return window.crypto.randomUUID();
  }

  function storeSession(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // The chat still works when private browsing blocks local storage.
    }
  }

  function loadOrCreateSession() {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (
        stored &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          stored,
        )
      ) {
        return stored;
      }
    } catch {
      // Fall through to a fresh session.
    }

    const freshSession = createSessionId();
    storeSession(freshSession);
    return freshSession;
  }

  function applyAgentIdentity() {
    const name = displayAgentName();
    const workspace = workspaceName();
    document.title = `${workspace} · ${name}`;
    document.documentElement.style.setProperty(
      "--brand-primary",
      config.primaryColour,
    );
    elements.agentName.textContent = workspace;
    elements.agentSubtitle.textContent = config.subtitle;
    elements.conversationAgentName.textContent = name;
    elements.conversationTitleText.textContent = activeConversationTitle;
    elements.input.setAttribute("aria-label", `Message ${name}`);
    elements.input.placeholder = `What should ${name} do?`;
    elements.chatHeader.dataset.agentId = activeAgent()?.id ?? "project-manager";

    elements.agentInitials.textContent =
      (profile?.agentName ?? "").length > 0 ? getInitials(workspace) : "AI";
    elements.mobileAgentInitials.textContent = getInitials(name);
    applySavedAvatar();
    // Every path that changes the active agent comes through here, so this is
    // the one place the funding progress poll starts and stops.
    syncScanProgress();
  }

  function applySavedAvatar() {
    const avatar = profile?.avatarDataUrl ?? "";
    if (avatar.length > 0) {
      elements.agentInitials.style.backgroundImage = `url("${avatar}")`;
      elements.agentInitials.classList.add("brand__mark--photo");
    } else {
      elements.agentInitials.style.removeProperty("background-image");
      elements.agentInitials.classList.remove("brand__mark--photo");
    }
  }

  function scrollConversation() {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    elements.conversation.scrollTo({
      top: elements.conversation.scrollHeight,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }

  function createAvatar(kind) {
    const avatar = document.createElement("span");
    avatar.className = `message__avatar message__avatar--${kind}`;
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent =
      kind === "agent" ? getInitials(displayAgentName()) : "You";
    return avatar;
  }

  function documentMetadata(documentItem) {
    const pageText =
      typeof documentItem.pageCount === "number"
        ? ` · ${documentItem.pageCount} pages`
        : "";
    const expiryText = documentItem.expired ? " · Expired" : "";
    return `${documentItem.wordCount.toLocaleString()} words${pageText}${expiryText}`;
  }

  function documentTypeLabel(documentItem) {
    if (documentItem.type === "pasted-text") {
      return "TEXT";
    }
    return String(documentItem.type || "FILE").toUpperCase().slice(0, 5);
  }

  function createSentAttachment(documentItem) {
    const attachment = document.createElement("div");
    attachment.className = "sent-attachment";
    attachment.classList.toggle(
      "sent-attachment--expired",
      documentItem.expired === true,
    );
    attachment.setAttribute(
      "aria-label",
      `Attached ${documentItem.name}, ${documentMetadata(documentItem)}`,
    );

    const preview = document.createElement("span");
    preview.className = `sent-attachment__preview sent-attachment__preview--${documentItem.type}`;
    preview.setAttribute("aria-hidden", "true");

    const pageFold = document.createElement("span");
    pageFold.className = "sent-attachment__fold";

    const previewLines = document.createElement("span");
    previewLines.className = "sent-attachment__lines";
    for (let index = 0; index < 3; index += 1) {
      previewLines.append(document.createElement("span"));
    }

    const type = document.createElement("span");
    type.className = "sent-attachment__type";
    type.textContent = documentTypeLabel(documentItem);
    preview.append(pageFold, previewLines, type);

    const details = document.createElement("span");
    details.className = "sent-attachment__details";

    const name = document.createElement("span");
    name.className = "sent-attachment__name";
    name.textContent = documentItem.name;
    name.title = documentItem.name;

    const metadata = document.createElement("span");
    metadata.className = "sent-attachment__meta";
    metadata.textContent = documentMetadata(documentItem);

    details.append(name, metadata);
    attachment.append(preview, details);
    return attachment;
  }

  // Google's callback lands in a different tab, so the chat finds out by
  // asking. Polling starts only once a connect link has actually been shown,
  // and stops as soon as the answer is yes.
  let gmailConnectOffered = false;
  let gmailWatchTimer = null;

  function stopGmailConnectionWatch() {
    if (gmailWatchTimer !== null) {
      clearInterval(gmailWatchTimer);
      gmailWatchTimer = null;
    }
  }

  function startGmailConnectionWatch() {
    if (gmailWatchTimer !== null) {
      return;
    }
    gmailWatchTimer = setInterval(async () => {
      if (document.hidden || requestInProgress) {
        return;
      }
      let status;
      try {
        const response = await fetch("/api/gmail/status", { headers: { Accept: "application/json" } });
        if (!response.ok) {
          return;
        }
        status = await response.json();
      } catch {
        return;
      }
      if (status?.connected !== true) {
        return;
      }
      stopGmailConnectionWatch();
      if (!gmailConnectOffered) {
        return;
      }
      gmailConnectOffered = false;
      const mailbox = typeof status.emailAddress === "string" && status.emailAddress !== ""
        ? ` as ${status.emailAddress}`
        : "";
      // Sent as the learner, and shown in the transcript, so the handover is
      // visible rather than something that happened behind their back.
      void sendMessage(
        `I have connected Gmail${mailbox}. Please start the monthly update now.`,
        true,
      );
    }, 2_500);
  }

  // Agent replies are plain text. Two local paths, and only these two, become
  // links: an article download, and the Gmail connect route. Nothing else is
  // linkified — an agent that reads a stranger's email must never be able to
  // turn a URL from that email into something clickable.
  const SAFE_LINKS = [
    {
      pattern: /\/api\/seo-article\/download\/[A-Za-z0-9_-]{40,60}\.md/g,
      build(href) {
        const link = document.createElement("a");
        link.className = "message__download";
        link.href = href;
        link.download = "";
        link.textContent = "Download the article (.md)";
        return link;
      },
    },
    {
      pattern: /(?:http:\/\/localhost:\d{2,5})?\/api\/gmail\/connect\b/g,
      build() {
        const link = document.createElement("a");
        link.className = "message__connect";
        // A new tab, so the conversation is still here when they come back.
        link.href = "/api/gmail/connect";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Connect Gmail (read-only)";
        gmailConnectOffered = true;
        startGmailConnectionWatch();
        return link;
      },
    },
  ];

  function appendSafeMessageText(element, text) {
    const matches = [];
    for (const { pattern, build } of SAFE_LINKS) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        matches.push({ index: match.index ?? 0, length: match[0].length, href: match[0], build });
      }
    }
    matches.sort((left, right) => left.index - right.index);

    let offset = 0;
    for (const match of matches) {
      if (match.index < offset) {
        continue;
      }
      element.append(document.createTextNode(text.slice(offset, match.index)));
      element.append(match.build(match.href));
      offset = match.index + match.length;
    }
    element.append(document.createTextNode(text.slice(offset)));
  }

  function addMessage(kind, text, attachments = [], options = {}) {
    const wrapper = document.createElement("article");
    wrapper.className = `message message--${kind}`;
    if (["pending", "failed", "interrupted"].includes(options.status)) {
      wrapper.classList.add(`message--${options.status}`);
    }
    if (options.id) {
      wrapper.dataset.messageId = options.id;
    }

    const body = document.createElement("div");
    body.className = "message__body";

    const label = document.createElement("p");
    label.className = "message__label";
    label.textContent = kind === "agent" ? displayAgentName() : "You";

    const copy = document.createElement("p");
    copy.className = "message__copy";
    appendSafeMessageText(copy, text);

    body.append(label);
    if (kind === "user" && attachments.length > 0) {
      const attachmentList = document.createElement("div");
      attachmentList.className = "message__attachments";
      attachmentList.setAttribute("aria-label", "Sent attachments");
      for (const documentItem of attachments) {
        attachmentList.append(createSentAttachment(documentItem));
      }
      body.append(attachmentList);
    }
    body.append(copy);
    if (["pending", "failed", "interrupted"].includes(options.status)) {
      const status = document.createElement("p");
      status.className = "message__status";
      status.textContent =
        options.status === "pending"
          ? "Reply in progress…"
          : options.status === "interrupted"
          ? "Reply interrupted — send this again as a new message."
          : "Reply failed — send this again to retry.";
      body.append(status);
    }
    wrapper.append(createAvatar(kind), body);
    elements.conversation.append(wrapper);
    if (options.scroll !== false) {
      scrollConversation();
    }
    return wrapper;
  }

  function shortArticleText(value, maximum = 180) {
    if (typeof value !== "string") return "";
    const cleaned = value.replace(/\s+/g, " ").trim();
    return cleaned.length <= maximum
      ? cleaned
      : `${cleaned.slice(0, maximum - 1).trimEnd()}…`;
  }

  function articleStatusText(job) {
    const stages = {
      queued: "Your article is waiting to start.",
      preparing_research: "Checking the research and reliable sources…",
      drafting: "Writing and checking the draft…",
      repairing: "Improving the evidence and wording…",
      ready_for_review: "Your article is ready.",
    };
    return stages[job?.stage] ?? "Writing and checking your article…";
  }

  function appendArticleContext(panel, brief) {
    const who = shortArticleText(brief?.context?.who?.value);
    const offer = shortArticleText(brief?.context?.offer?.value);
    if (!who && !offer) return;
    const context = document.createElement("div");
    context.className = "article-panel__context";
    if (who) {
      const line = document.createElement("p");
      line.textContent = `Who you help: ${who}`;
      context.append(line);
    }
    if (offer) {
      const line = document.createElement("p");
      line.textContent = `What you sell: ${offer}`;
      context.append(line);
    }
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "article-panel__text-button";
    edit.textContent = "Edit My Business";
    edit.addEventListener("click", () => void openProfileDialog());
    context.append(edit);
    panel.append(context);
  }

  function renderArticlePanel(payload) {
    const previousPanel = elements.conversation.querySelector(".article-panel");
    const brief = payload?.brief;
    if (!brief) {
      previousPanel?.remove();
      return;
    }
    const shouldReveal =
      previousPanel?.dataset.briefId !== brief.briefId ||
      previousPanel?.dataset.status !== brief.status;
    previousPanel?.remove();

    const panel = document.createElement("section");
    panel.className = "article-panel";
    panel.dataset.briefId = brief.briefId;
    panel.dataset.status = brief.status;

    const eyebrow = document.createElement("p");
    eyebrow.className = "article-panel__eyebrow";
    eyebrow.textContent = brief.research?.source === "paid"
      ? "Article ideas from live search data"
      : "Article ideas from website research";

    const title = document.createElement("h3");
    title.className = "article-panel__title";

    if (brief.status === "writing") {
      title.textContent = "Writing your article";
      const selected = document.createElement("p");
      selected.className = "article-panel__selected";
      selected.textContent = brief.selection?.title ?? "Your selected article";
      const progress = document.createElement("p");
      progress.className = "article-panel__progress";
      progress.textContent = articleStatusText(payload.job);
      panel.append(eyebrow, title, selected, progress);
    } else if (brief.status === "complete" && payload.article) {
      title.textContent = "Your article is ready";
      const selected = document.createElement("p");
      selected.className = "article-panel__selected";
      selected.textContent = brief.selection?.title ?? "SEO article";
      const download = document.createElement("a");
      download.className = "article-panel__primary";
      download.href = payload.article.downloadUrl;
      download.download = "";
      download.textContent = "Download article";
      panel.append(eyebrow, title, selected, download);
    } else if (brief.status === "failed") {
      title.textContent = "This draft needs attention";
      const detail = document.createElement("p");
      detail.className = "article-panel__progress";
      detail.textContent = payload.job?.errorMessage ??
        "The article could not be completed. Ask the agent what is needed next.";
      panel.append(eyebrow, title, detail);
    } else if (brief.status === "needs_details") {
      title.textContent = "One quick detail before I write";
      const detail = document.createElement("p");
      detail.className = "article-panel__progress";
      const labels = {
        who: "who you help",
        offer: "what you sell",
        price: "what the article can say about price",
        boundaries: "what the article must not promise",
      };
      const missing = (brief.missingFields ?? []).map((field) => labels[field] ?? field);
      detail.textContent = missing.length > 0
        ? `Tell the agent ${missing.join(" and ")}.`
        : "Reply to the short question in the chat.";
      panel.append(eyebrow, title, detail);
      appendArticleContext(panel, brief);
    } else {
      title.textContent = "Choose what to write";
      const intro = document.createElement("p");
      intro.className = "article-panel__intro";
      intro.textContent = "Pick one idea. You can change the details before anything is written.";
      panel.append(eyebrow, title, intro);
      appendArticleContext(panel, brief);

      const choices = document.createElement("div");
      choices.className = "article-panel__choices";
      for (const opportunity of brief.opportunities ?? []) {
        const card = document.createElement("article");
        card.className = "article-choice";
        const number = document.createElement("span");
        number.className = "article-choice__number";
        number.textContent = String(opportunity.number);
        const content = document.createElement("div");
        const heading = document.createElement("h4");
        heading.textContent = opportunity.title;
        const reason = document.createElement("p");
        reason.textContent = opportunity.reason;
        const facts = document.createElement("p");
        facts.className = "article-choice__facts";
        const interest = Number.isFinite(opportunity.searchVolume)
          ? `About ${Number(opportunity.searchVolume).toLocaleString()} searches a month`
          : "Search interest not measured";
        facts.textContent = `${interest} · ${opportunity.competition} competition`;
        const choose = document.createElement("button");
        choose.type = "button";
        choose.className = "article-panel__primary";
        choose.textContent = "Write this article";
        choose.addEventListener("click", () => {
          void sendMessage(
            `Write article option ${opportunity.number} for ${brief.domain}.`,
            true,
          );
        });
        content.append(heading, reason, facts, choose);
        card.append(number, content);
        choices.append(card);
      }
      panel.append(choices);

      const actions = document.createElement("div");
      actions.className = "article-panel__actions";
      const best = document.createElement("button");
      best.type = "button";
      best.className = "article-panel__secondary";
      best.textContent = "Choose the best one for me";
      best.addEventListener("click", () => {
        void sendMessage(`Choose the best article for ${brief.domain} and write it.`, true);
      });
      const custom = document.createElement("button");
      custom.type = "button";
      custom.className = "article-panel__text-button";
      custom.textContent = "Use another topic";
      custom.addEventListener("click", () => {
        elements.input.value = `Write an article for ${brief.domain} about `;
        updateCharacterCount();
        resizeInput();
        elements.input.focus();
      });
      actions.append(best, custom);
      panel.append(actions);
    }

    elements.conversation.append(panel);
    if (shouldReveal) {
      window.requestAnimationFrame(() => {
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    if (brief.status === "writing") {
      articleRefreshTimer = window.setTimeout(() => {
        void refreshArticlePanel();
      }, 4_000);
    }
  }

  async function refreshArticlePanel() {
    if (articleRefreshTimer !== null) {
      window.clearTimeout(articleRefreshTimer);
      articleRefreshTimer = null;
    }
    const expectedSessionId = sessionId;
    try {
      const response = await fetch(
        `/api/seo-article/briefs?sessionId=${encodeURIComponent(expectedSessionId)}`,
        { headers: { Accept: "application/json" } },
      );
      if (response.status === 404) {
        elements.conversation.querySelector(".article-panel")?.remove();
        return;
      }
      const body = await parseResponse(response, "The article plan could not be loaded.");
      if (sessionId !== expectedSessionId) return;
      renderArticlePanel(body);
    } catch {
      // The normal chat stays usable when the optional article panel is offline.
    }
  }

  function addLoadingMessage() {
    const wrapper = document.createElement("article");
    wrapper.className = "message message--agent";

    const body = document.createElement("div");
    body.className = "message__body";

    const label = document.createElement("p");
    label.className = "message__label";
    label.textContent = displayAgentName();

    const dots = document.createElement("span");
    dots.className = "thinking-dots";
    dots.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 3; index += 1) {
      dots.append(document.createElement("span"));
    }

    const accessibleText = document.createElement("span");
    accessibleText.className = "visually-hidden";
    accessibleText.textContent = `${displayAgentName()} is thinking`;

    body.append(label, dots, accessibleText);
    wrapper.append(createAvatar("agent"), body);
    elements.conversation.append(wrapper);
    scrollConversation();
    return wrapper;
  }

  function addError(message, retryRequest) {
    const alert = document.createElement("div");
    alert.className = "chat-error";
    alert.setAttribute("role", "alert");

    const icon = document.createElement("span");
    icon.className = "chat-error__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "!";

    const content = document.createElement("div");
    const title = document.createElement("p");
    title.className = "chat-error__title";
    title.textContent = "That didn’t work";
    const detail = document.createElement("p");
    detail.className = "chat-error__detail";
    detail.textContent = message;
    content.append(title, detail);

    if (retryRequest) {
      const retry = document.createElement("button");
      retry.className = "retry-button";
      retry.type = "button";
      retry.textContent = "Try again";
      retry.addEventListener("click", () => {
        alert.remove();
        void sendMessage(retryRequest.message, true, retryRequest.documents);
      });
      content.append(retry);
    }

    alert.append(icon, content);
    elements.conversation.append(alert);
    scrollConversation();
  }

  function friendlyError(errorBody, fallback) {
    if (
      typeof errorBody === "object" &&
      errorBody !== null &&
      typeof errorBody.error === "object" &&
      errorBody.error !== null &&
      typeof errorBody.error.message === "string"
    ) {
      return errorBody.error.message;
    }
    return fallback;
  }

  async function parseResponse(response, fallback) {
    let body = null;
    try {
      body = await response.json();
    } catch {
      // Use the stable fallback below.
    }
    if (!response.ok) {
      throw new Error(friendlyError(body, fallback));
    }
    return body;
  }

  async function loadAgents() {
    try {
      const response = await fetch("/api/agents", {
        headers: { Accept: "application/json" },
      });
      const body = await parseResponse(
        response,
        "The local agent list could not be loaded.",
      );
      if (
        body?.schemaVersion === 2 &&
        body &&
        Array.isArray(body.agents) &&
        body.agents.some((agent) => agent?.status === "active")
      ) {
        agents = body.agents.map((agent) => ({
          ...agent,
          settingsFields: Array.isArray(agent.settingsFields)
            ? agent.settingsFields
            : [],
          skills: Array.isArray(agent.skills) ? agent.skills : [],
          syncRequired: agent.syncRequired !== false,
        }));
        activeAgentId =
          agents.find((agent) => agent.id === activeAgentId)?.status === "active"
            ? activeAgentId
            : agents.find((agent) => agent.status === "active").id;
      }
    } catch {
      agents = DEFAULT_AGENTS;
    }
  }

  async function loadAgentSettings() {
    const response = await fetch("/api/agent-settings", {
      headers: { Accept: "application/json" },
    });
    const body = await parseResponse(
      response,
      "Agent settings could not be loaded.",
    );
    if (body?.schemaVersion !== 1 || typeof body.settings !== "object") {
      throw new Error("Agent settings returned an unexpected response.");
    }
    agentSettings = body.settings;
  }

  function relativeTime(value) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
      return "Saved locally";
    }
    const seconds = Math.round((timestamp - Date.now()) / 1_000);
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    if (Math.abs(seconds) < 60) {
      return formatter.format(seconds, "second");
    }
    const minutes = Math.round(seconds / 60);
    if (Math.abs(minutes) < 60) {
      return formatter.format(minutes, "minute");
    }
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) {
      return formatter.format(hours, "hour");
    }
    return formatter.format(Math.round(hours / 24), "day");
  }

  function syncHistoryPanelAccess() {
    elements.agentPanel.inert =
      narrowLayout.matches &&
      !elements.agentPanel.classList.contains("agent-panel--open");
  }

  function setHistoryOpen(isOpen) {
    const focusWasInPanel = elements.agentPanel.contains(document.activeElement);
    elements.agentPanel.classList.toggle("agent-panel--open", isOpen);
    elements.historyButton.setAttribute("aria-expanded", String(isOpen));
    syncHistoryPanelAccess();
    if (isOpen) {
      elements.historySearchInput.focus();
    } else if (focusWasInPanel) {
      elements.historyButton.focus();
    }
  }

  function renderHistoryList(items = conversations, isSearch = false) {
    elements.historyList.replaceChildren();
    if (items.length === 0) {
      elements.historyStatus.textContent = isSearch
        ? "No saved chats match that search."
        : "No saved chats yet.";
      return;
    }
    elements.historyStatus.textContent = isSearch
      ? `${items.length} matching message${items.length === 1 ? "" : "s"}`
      : "Saved on this computer";
    for (const item of items) {
      if (isSearch) {
        const result = document.createElement("button");
        result.className = "history-result";
        result.type = "button";

        const title = document.createElement("span");
        title.className = "history-result__title";
        title.textContent = item.conversationTitle;
        const snippet = document.createElement("span");
        snippet.className = "history-result__snippet";
        snippet.textContent = item.snippet;
        result.append(title, snippet);
        result.addEventListener("click", () => {
          void loadConversation(item.conversationId, item.messageId);
        });
        elements.historyList.append(result);
        continue;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "history-item";
      wrapper.classList.toggle("history-item--active", item.id === sessionId);
      wrapper.setAttribute("role", "listitem");

      const open = document.createElement("button");
      open.className = "history-item__open";
      open.type = "button";
      open.setAttribute("aria-current", item.id === sessionId ? "true" : "false");
      const title = document.createElement("span");
      title.className = "history-item__title";
      title.textContent = item.title;
      const meta = document.createElement("span");
      meta.className = "history-item__meta";
      meta.textContent = `${relativeTime(item.updatedAt)} · ${item.messageCount} message${item.messageCount === 1 ? "" : "s"}`;
      open.append(title, meta);
      open.addEventListener("click", () => {
        void loadConversation(item.id);
      });

      const actions = document.createElement("span");
      actions.className = "history-item__actions";
      const rename = document.createElement("button");
      rename.className = "history-item__action";
      rename.type = "button";
      rename.textContent = "✎";
      rename.setAttribute("aria-label", `Rename ${item.title}`);
      rename.addEventListener("click", () => {
        void renameConversation(item);
      });
      const remove = document.createElement("button");
      remove.className = "history-item__action";
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Delete ${item.title}`);
      remove.addEventListener("click", () => {
        void deleteConversation(item);
      });
      actions.append(rename, remove);
      wrapper.append(open, actions);
      elements.historyList.append(wrapper);
    }
  }

  async function loadConversationList({ append = false } = {}) {
    const cursor = append && nextConversationCursor
      ? `&cursor=${encodeURIComponent(nextConversationCursor)}`
      : "";
    const response = await fetch(`/api/conversations?limit=50${cursor}`, {
      headers: { Accept: "application/json" },
    });
    const body = await parseResponse(response, "Saved chats could not be loaded.");
    const received = Array.isArray(body?.conversations) ? body.conversations : [];
    conversations = append ? [...conversations, ...received] : received;
    nextConversationCursor = body?.nextCursor ?? null;
    elements.historyMore.hidden = !nextConversationCursor;
    renderHistoryList();
    return conversations;
  }

  function discardPendingDocuments(previousSessionId) {
    const documents = sessionDocuments;
    uploadedDocuments = [];
    sessionDocuments = [];
    renderDocuments();
    for (const documentItem of documents) {
      void fetch(
        `/api/documents/${encodeURIComponent(documentItem.id)}?sessionId=${encodeURIComponent(previousSessionId)}`,
        { method: "DELETE" },
      );
    }
  }

  function renderStoredConversation(targetMessageId) {
    if (pendingRefreshTimer !== null) {
      window.clearTimeout(pendingRefreshTimer);
      pendingRefreshTimer = null;
    }
    if (articleRefreshTimer !== null) {
      window.clearTimeout(articleRefreshTimer);
      articleRefreshTimer = null;
    }
    elements.conversation.replaceChildren();
    if (nextMessageBefore) {
      const older = document.createElement("button");
      older.className = "load-older";
      older.type = "button";
      older.textContent = "Load earlier messages";
      older.addEventListener("click", () => {
        void loadOlderMessages();
      });
      elements.conversation.append(older);
    }
    if (currentMessages.length === 0) {
      addMessage("agent", config.welcomeMessage, [], { scroll: false });
      elements.suggestions.hidden = false;
    } else {
      elements.suggestions.hidden = true;
      for (const message of currentMessages) {
        addMessage(
          message.role === "assistant" ? "agent" : "user",
          message.content,
          message.attachments ?? [],
          {
            id: message.id,
            status: message.status,
            scroll: false,
          },
        );
      }
    }
    const target = targetMessageId
      ? elements.conversation.querySelector(
          `[data-message-id="${CSS.escape(targetMessageId)}"]`,
        )
      : null;
    if (target) {
      target.classList.add("message--target");
      target.scrollIntoView({ block: "center" });
      elements.conversation.focus();
    } else {
      elements.conversation.scrollTop = elements.conversation.scrollHeight;
    }
    if (currentMessages.some((message) => message.status === "pending")) {
      const expectedSessionId = sessionId;
      pendingRefreshTimer = window.setTimeout(() => {
        if (sessionId === expectedSessionId && !requestInProgress) {
          void loadConversation(sessionId, undefined, true).catch(() => {});
        }
      }, 1_500);
    }
    if (currentMessages.length > 0) {
      void refreshArticlePanel();
    }
  }

  async function loadConversation(id, targetMessageId, allowBusy = false) {
    if (!allowBusy && (requestInProgress || documentRequestInProgress)) {
      return;
    }
    const response = await fetch(
      `/api/conversations/${encodeURIComponent(id)}?limit=100`,
      { headers: { Accept: "application/json" } },
    );
    const body = await parseResponse(response, "That saved chat could not be loaded.");
    const previousSessionId = sessionId;
    if (previousSessionId !== id && sessionDocuments.length > 0) {
      discardPendingDocuments(previousSessionId);
    }
    sessionId = body.conversation.id;
    storeSession(sessionId);
    activeConversationTitle = body.conversation.title;
    const availableAgent = agents.find(
      (agent) => agent.id === body.conversation.agentId && agent.status === "active",
    );
    if (availableAgent) {
      activeAgentId = availableAgent.id;
    }
    currentMessages = Array.isArray(body.messages) ? body.messages : [];
    nextMessageBefore = body.nextBefore ?? null;
    elements.input.value = "";
    updateCharacterCount();
    resizeInput();
    applyAgentIdentity();
    renderAgentList();
    renderSuggestions();
    renderStoredConversation(targetMessageId);
    renderHistoryList();
    setHistoryOpen(false);
    elements.input.focus();
  }

  async function loadOlderMessages() {
    if (!nextMessageBefore) {
      return;
    }
    const response = await fetch(
      `/api/conversations/${encodeURIComponent(sessionId)}?limit=100&before=${encodeURIComponent(nextMessageBefore)}`,
      { headers: { Accept: "application/json" } },
    );
    const body = await parseResponse(response, "Earlier messages could not be loaded.");
    currentMessages = [...(body.messages ?? []), ...currentMessages];
    nextMessageBefore = body.nextBefore ?? null;
    renderStoredConversation();
    elements.conversation.scrollTop = 0;
  }

  async function createConversation(agentId = activeAgentId) {
    if (requestInProgress || documentRequestInProgress) {
      return;
    }
    const previousSessionId = sessionId;
    if (sessionDocuments.length > 0) {
      discardPendingDocuments(previousSessionId);
    }
    // Switching agent changes activeAgentId first and builds the conversation
    // afterwards, so for a moment the open conversation belongs to the agent
    // being left. A background delivery that sent into that gap was rejected
    // with "Conversation belongs to a different agent" — right of the server,
    // and a result nobody would have seen.
    switchingConversation = true;
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      const body = await parseResponse(response, "A new chat could not be created.");
      await loadConversationList();
      await loadConversation(body.conversation.id);
      elements.requestStatus.textContent = "New conversation started";
    } finally {
      switchingConversation = false;
    }
  }

  async function renameConversation(conversation) {
    const supplied = window.prompt("Rename this conversation", conversation.title);
    if (supplied === null) {
      return;
    }
    const title = supplied.replace(/\s+/g, " ").trim();
    if (!title || title.length > 80) {
      elements.historyStatus.textContent = "Use a title from 1 to 80 characters.";
      return;
    }
    const response = await fetch(
      `/api/conversations/${encodeURIComponent(conversation.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      },
    );
    await parseResponse(response, "That chat could not be renamed.");
    if (conversation.id === sessionId) {
      activeConversationTitle = title;
      elements.conversationTitleText.textContent = title;
    }
    await loadConversationList();
  }

  async function deleteConversation(conversation) {
    if (!window.confirm(`Permanently delete “${conversation.title}” from this computer?`)) {
      return;
    }
    const response = await fetch(
      `/api/conversations/${encodeURIComponent(conversation.id)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      await parseResponse(response, "That chat could not be deleted.");
    }
    const deletedCurrent = conversation.id === sessionId;
    await loadConversationList();
    if (deletedCurrent) {
      const replacement = conversations.find(
        (candidate) => candidate.agentId === activeAgentId,
      ) ?? conversations[0];
      if (replacement) {
        await loadConversation(replacement.id);
      } else {
        await createConversation(activeAgentId);
      }
    }
  }

  async function searchConversations(query) {
    const cleaned = query.trim();
    if (!cleaned) {
      renderHistoryList();
      elements.historyMore.hidden = !nextConversationCursor;
      return;
    }
    const response = await fetch(
      `/api/conversations/search?q=${encodeURIComponent(cleaned)}&limit=50`,
      { headers: { Accept: "application/json" } },
    );
    const body = await parseResponse(response, "Saved chats could not be searched.");
    elements.historyMore.hidden = true;
    renderHistoryList(Array.isArray(body.results) ? body.results : [], true);
  }

  function skillIcon(skillId) {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(namespace, "path");
    const iconName = SKILL_ICON_BY_ID[skillId] ?? "checklist";
    path.setAttribute("d", SKILL_ICONS[iconName]);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("stroke-width", "1.7");
    svg.append(path);
    return svg;
  }

  function skillPackageState(skill) {
    const modules = Array.isArray(skill.modules) ? skill.modules : [];
    const missingExtensions = modules.filter(
      (module) => module.role === "extension" && module.installed !== true,
    );
    let label;
    if (skill.installed === true) {
      label =
        missingExtensions.length > 0
          ? `Installed. Optional additions not installed: ${missingExtensions.map((module) => module.name).join(", ")}.`
          : "Installed.";
    } else if (skill.partiallyInstalled === true) {
      label = "Partly installed.";
    } else {
      label = skill.installable === false ? "Included with the base agent." : "Not installed.";
    }
    if (skill.needsSync === true) {
      label += " Run npm run sync-skills before relying on it in chat.";
    }
    return label;
  }

  function agentStatusLabel(agent) {
    const availability =
      agent.status === "active"
        ? agent.id === activeAgentId
          ? "Active"
          : "Available"
        : "Coming soon";
    return agent.syncRequired ? `${availability} · Sync needed` : availability;
  }

  function renderAgentList() {
    elements.agentList.replaceChildren();
    for (const agent of agents) {
      const card = document.createElement("button");
      card.className = "agent-card";
      card.type = "button";
      card.dataset.agentId = agent.id;
      card.dataset.status = agent.status;
      card.dataset.syncRequired = String(agent.syncRequired === true);
      card.setAttribute(
        "aria-current",
        agent.id === activeAgentId ? "true" : "false",
      );
      card.setAttribute("aria-haspopup", "dialog");

      const name = document.createElement("span");
      name.className = "agent-card__name";
      name.textContent = agent.name;

      const status = document.createElement("span");
      status.className = "agent-card__status";
      status.textContent = agentStatusLabel(agent);

      const description = document.createElement("span");
      description.className = "agent-card__description";
      description.textContent = agent.description;

      const skills = document.createElement("span");
      skills.className = "agent-card__skills";
      const skillPackages = Array.isArray(agent.skills) ? agent.skills : [];
      for (const skill of skillPackages) {
        const chip = document.createElement("span");
        chip.className = "agent-card__skill";
        chip.dataset.installed = String(skill.installed === true);
        chip.dataset.partial = String(skill.partiallyInstalled === true);
        chip.setAttribute("aria-hidden", "true");
        chip.dataset.tooltip = `${skill.name}: ${skill.description} ${skillPackageState(skill)}`;
        chip.append(skillIcon(skill.id));
        skills.append(chip);
      }

      const summary = document.createElement("span");
      summary.className = "visually-hidden";
      summary.textContent =
        skillPackages.length > 0
          ? `Skill packages: ${skillPackages.map((skill) => `${skill.name}, ${skillPackageState(skill)}`).join(" ")}`
          : "No packaged skills yet.";

      card.append(name, status, description, skills, summary);
      card.addEventListener("click", () => {
        void openAgentDialog(agent, card);
      });
      elements.agentList.append(card);
    }
  }

  function renderAgentDialog(agent, settingsAvailable = true) {
    agentDialogAgentId = agent.id;
    elements.agentDialog.dataset.agentId = agent.id;
    elements.agentDialogKicker.textContent =
      agent.status === "active" ? "Agent" : "Coming soon";
    elements.agentDialogTitle.textContent = agent.name;
    elements.agentDialogDescription.textContent =
      agent.status === "active"
        ? agent.description
        : `${agent.description} You cannot chat with this one yet.`;

    elements.agentDialogSkills.replaceChildren();
    const skills = Array.isArray(agent.skills) ? agent.skills : [];
    if (skills.length === 0) {
      const empty = document.createElement("li");
      empty.className = "agent-dialog__empty";
      empty.textContent = "No packaged skills are available for this agent yet.";
      elements.agentDialogSkills.append(empty);
    } else {
      for (const skill of skills) {
        const item = document.createElement("li");
        item.dataset.installed = String(skill.installed === true);
        item.dataset.partial = String(skill.partiallyInstalled === true);
        const icon = document.createElement("span");
        icon.className = "agent-dialog__skill-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.append(skillIcon(skill.id));
        const copy = document.createElement("span");
        const name = document.createElement("strong");
        name.textContent = skill.name;
        const description = document.createElement("span");
        description.textContent = skill.description;
        const state = document.createElement("span");
        state.className = "agent-dialog__skill-state";
        state.textContent = skillPackageState(skill);
        copy.append(name, description, state);
        const modules = Array.isArray(skill.modules) ? skill.modules : [];
        if (modules.length > 1) {
          const capabilityList = document.createElement("span");
          capabilityList.className = "agent-dialog__skill-modules";
          capabilityList.textContent = `Includes: ${modules
            .map(
              (module) =>
                `${module.name}${module.role === "extension" ? " (optional)" : ""}`,
            )
            .join(", ")}.`;
          copy.append(capabilityList);
        }
        item.append(icon, copy);
        elements.agentDialogSkills.append(item);
      }
    }

    elements.agentDialogFields.replaceChildren();
    const fields = Array.isArray(agent.settingsFields)
      ? agent.settingsFields
      : [];
    const savedValues = agentSettings?.[agent.id] ?? {};
    for (const field of fields) {
      const group = document.createElement("div");
      group.className = "agent-dialog__field";
      const id = `agent-field-${agent.id}-${field.id}`;
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = field.label;
      const control =
        field.kind === "line"
          ? document.createElement("input")
          : document.createElement("textarea");
      control.id = id;
      control.dataset.agentField = field.id;
      control.maxLength = field.maxLength;
      control.value = savedValues[field.id] ?? "";
      control.disabled = !settingsAvailable;
      if (control instanceof HTMLTextAreaElement) {
        control.rows = 3;
      }
      group.append(label);
      if (field.description) {
        const hint = document.createElement("p");
        hint.className = "agent-dialog__hint";
        hint.id = `${id}-hint`;
        hint.textContent = field.description;
        control.setAttribute("aria-describedby", hint.id);
        group.append(hint);
      }
      group.append(control);
      elements.agentDialogFields.append(group);
    }

    elements.agentDialogSync.textContent = agent.syncRequired
      ? "Sync required: run npm run sync-skills before relying on these details in chat."
      : "This agent's instructions are synced.";
    elements.agentDialogChat.textContent = `Chat with ${agent.name}`;
    elements.agentDialogChat.hidden =
      agent.status !== "active" || agent.id === activeAgentId;
    elements.agentDialogChat.disabled =
      requestInProgress || documentRequestInProgress;
    elements.agentDialogSave.hidden = fields.length === 0;
    elements.agentDialogSave.disabled = !settingsAvailable;
  }

  async function openAgentDialog(agent, origin) {
    agentDialogReturnFocus = origin;
    let settingsAvailable = true;
    elements.agentDialogStatus.textContent = "";
    if (agentSettings === null) {
      try {
        await loadAgentSettings();
      } catch (error) {
        settingsAvailable = false;
        elements.agentDialogStatus.textContent =
          error instanceof Error
            ? error.message
            : "Agent settings could not be loaded.";
      }
    }
    renderAgentDialog(agent, settingsAvailable);
    elements.agentDialog.showModal();
    const firstField = elements.agentDialogFields.querySelector(
      "input:not(:disabled), textarea:not(:disabled)",
    );
    (firstField ?? elements.agentDialogClose).focus();
  }

  async function selectAgent(agent) {
    agentDialogReturnFocus = null;
    elements.agentDialog.close();
    if (agent.id === activeAgentId) {
      elements.input.focus();
      return;
    }
    activeAgentId = agent.id;
    applyAgentIdentity();
    renderAgentList();
    renderSuggestions();
    elements.input.focus();
    try {
      await createConversation(agent.id);
    } catch (error) {
      addError(
        error instanceof Error
          ? error.message
          : `A ${agent.name} conversation could not be started.`,
      );
      elements.input.focus();
    }
  }

  function renderSuggestions() {
    elements.suggestionList.replaceChildren();
    const selectedPrompts =
      activeAgent()?.examplePrompts?.length > 0
        ? activeAgent().examplePrompts
        : config.examplePrompts;
    for (const prompt of selectedPrompts.slice(0, 6)) {
      const button = document.createElement("button");
      button.className = "suggestion-button";
      button.type = "button";
      button.textContent = prompt;
      button.addEventListener("click", () => {
        void sendMessage(prompt, true);
      });
      elements.suggestionList.append(button);
    }
  }

  function renderDocuments() {
    elements.documentList.replaceChildren();
    for (const documentItem of uploadedDocuments) {
      const chip = document.createElement("div");
      chip.className = "document-chip";

      const name = document.createElement("span");
      name.className = "document-chip__name";
      name.textContent = documentItem.name;
      name.title = documentItem.name;

      const metadata = document.createElement("span");
      metadata.className = "document-chip__meta";
      metadata.textContent = documentMetadata(documentItem);

      const remove = document.createElement("button");
      remove.className = "document-chip__remove";
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${documentItem.name}`);
      remove.disabled = requestInProgress || documentRequestInProgress;
      remove.addEventListener("click", () => {
        void removeDocument(documentItem.id);
      });

      chip.append(name, metadata, remove);
      elements.documentList.append(chip);
    }
  }

  function renderNewConversation() {
    elements.conversation.replaceChildren();
    addMessage("agent", config.welcomeMessage);
    elements.suggestions.hidden = false;
    elements.input.value = "";
    updateCharacterCount();
    resizeInput();
  }

  function setBusy(isBusy) {
    requestInProgress = isBusy;
    const controlsBusy = isBusy || documentRequestInProgress;
    if (controlsBusy) {
      setAttachmentMenuOpen(false);
    }
    elements.conversation.setAttribute("aria-busy", String(isBusy));
    elements.input.disabled = controlsBusy;
    elements.sendButton.disabled = controlsBusy;
    elements.resetButton.disabled = controlsBusy;
    elements.historyNew.disabled = controlsBusy;
    elements.historyMore.disabled = controlsBusy;
    elements.historySearchInput.disabled = controlsBusy;
    elements.attachmentMenuButton.disabled = controlsBusy;
    elements.uploadButton.disabled = controlsBusy;
    elements.pasteButton.disabled = controlsBusy;
    for (const suggestion of elements.suggestionList.querySelectorAll("button")) {
      suggestion.disabled = controlsBusy;
    }
    for (const historyControl of elements.historyList.querySelectorAll("button")) {
      historyControl.disabled = controlsBusy;
    }
    elements.sendButtonLabel.textContent = isBusy ? "Working" : "Send";
    elements.requestStatus.textContent = isBusy
      ? `${displayAgentName()} is working on your request…`
      : "Press Enter to send · Shift + Enter for a new line";
    elements.agentDialogChat.disabled = controlsBusy;
    renderDocuments();
  }

  function setDocumentBusy(isBusy, message = "") {
    documentRequestInProgress = isBusy;
    elements.documentStatus.textContent = message;
    setBusy(requestInProgress);
  }

  function setAttachmentMenuOpen(isOpen) {
    elements.attachmentMenu.hidden = !isOpen;
    elements.attachmentMenuButton.setAttribute(
      "aria-expanded",
      String(isOpen),
    );
    if (isOpen) {
      elements.uploadButton.focus();
    }
  }

  async function uploadFile(file) {
    if (uploadedDocuments.length >= MAX_DOCUMENTS) {
      addError(`Add no more than ${MAX_DOCUMENTS} documents to one message.`);
      return;
    }

    setDocumentBusy(true, `Reading ${file.name}…`);
    try {
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("file", file);
      const response = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });
      const body = await parseResponse(
        response,
        "The document could not be read.",
      );
      if (!body?.document?.id) {
        throw new Error("The document reader returned an unexpected result.");
      }
      uploadedDocuments.push(body.document);
      sessionDocuments.push(body.document);
      renderDocuments();
      elements.documentStatus.textContent =
        body.document.warnings?.length > 0
          ? body.document.warnings[0]
          : "";
    } catch (error) {
      elements.documentStatus.textContent = "";
      addError(
        error instanceof Error
          ? error.message
          : "The document could not be read.",
      );
    } finally {
      documentRequestInProgress = false;
      setBusy(requestInProgress);
      elements.fileInput.value = "";
    }
  }

  async function uploadPastedText(name, text) {
    if (uploadedDocuments.length >= MAX_DOCUMENTS) {
      addError(`Add no more than ${MAX_DOCUMENTS} documents to one message.`);
      return false;
    }

    setDocumentBusy(true, "Preparing pasted text…");
    try {
      const response = await fetch("/api/documents/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, name, text }),
      });
      const body = await parseResponse(
        response,
        "The pasted text could not be prepared.",
      );
      if (!body?.document?.id) {
        throw new Error("The document reader returned an unexpected result.");
      }
      uploadedDocuments.push(body.document);
      sessionDocuments.push(body.document);
      renderDocuments();
      elements.documentStatus.textContent = "";
      return true;
    } catch (error) {
      elements.documentStatus.textContent = "";
      addError(
        error instanceof Error
          ? error.message
          : "The pasted text could not be prepared.",
      );
      return false;
    } finally {
      documentRequestInProgress = false;
      setBusy(requestInProgress);
    }
  }

  async function removeDocument(id) {
    const documentItem = uploadedDocuments.find((item) => item.id === id);
    if (!documentItem) {
      return;
    }

    setDocumentBusy(true, `Removing ${documentItem.name}…`);
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(id)}?sessionId=${encodeURIComponent(sessionId)}`,
        { method: "DELETE" },
      );
      if (!response.ok && response.status !== 404) {
        const body = await response.json().catch(() => null);
        throw new Error(
          friendlyError(body, "The document could not be removed."),
        );
      }
      uploadedDocuments = uploadedDocuments.filter((item) => item.id !== id);
      sessionDocuments = sessionDocuments.filter((item) => item.id !== id);
      elements.documentStatus.textContent = "";
    } catch (error) {
      addError(
        error instanceof Error
          ? error.message
          : "The document could not be removed.",
      );
    } finally {
      documentRequestInProgress = false;
      setBusy(requestInProgress);
    }
  }

  // Returns whether the turn landed. Callers that a person drives ignore it;
  // the automatic funding read-out uses it to tell a delivered result from a
  // send that never arrived.
  async function sendMessage(
    rawMessage,
    showUserMessage,
    retryDocuments,
  ) {
    if (requestInProgress || documentRequestInProgress) {
      return false;
    }

    const message = rawMessage.trim();
    if (!message) {
      elements.input.focus();
      return false;
    }

    const requestDocuments = Array.isArray(retryDocuments)
      ? retryDocuments
      : [...uploadedDocuments];

    if (showUserMessage) {
      addMessage("user", message, requestDocuments);
      uploadedDocuments = [];
      elements.fileInput.value = "";
      elements.pastedName.value = "";
      elements.pastedText.value = "";
      elements.documentStatus.textContent = "";
      renderDocuments();
    }
    elements.suggestions.hidden = true;
    elements.input.value = "";
    updateCharacterCount();
    resizeInput();
    setBusy(true);
    loadingMessage = addLoadingMessage();
    let delivered = false;
    const requestId = createSessionId();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          sessionId,
          agentId: activeAgentId,
          message,
          documentIds: requestDocuments.map((item) => item.id),
        }),
      });

      const responseBody = await parseResponse(
        response,
        "The local agent could not reply. Check that n8n is running, then try again.",
      );
      if (
        typeof responseBody !== "object" ||
        responseBody === null ||
        responseBody.sessionId !== sessionId ||
        typeof responseBody.reply !== "string" ||
        !responseBody.reply.trim()
      ) {
        throw new Error(
          "The agent returned an unexpected response. Check the workflow and try again.",
        );
      }

      loadingMessage.remove();
      loadingMessage = null;
      addMessage("agent", responseBody.reply.trim());
      // The reply is on screen and stored: the turn has landed. Everything
      // below is a cosmetic refresh of the history panel, and letting its
      // failure count as a failed send made the funding read-out arrive
      // twice — once for real, once because the first was scored a miss.
      delivered = true;
      await loadConversationList();
      await loadConversation(sessionId, undefined, true);
    } catch (error) {
      loadingMessage?.remove();
      loadingMessage = null;
      try {
        await loadConversationList();
        await loadConversation(sessionId, undefined, true);
      } catch {
        // Keep the visible optimistic message when history refresh also fails.
      }
      addError(
        error instanceof Error
          ? error.message
          : "The local agent could not reply. Check n8n and try again.",
        { message, documents: requestDocuments },
      );
    } finally {
      setBusy(false);
      elements.input.focus();
      // "Go and search" starts a scan mid-conversation; check straight away
      // rather than making the new bar wait for the next scheduled poll.
      if (activeAgentId === FUNDING_AGENT_ID) {
        void refreshScanProgress();
      }
    }
    return delivered;
  }

  // ---- Funding search progress ------------------------------------------
  // A funding search runs server-side for the best part of an hour, and a
  // chat transcript cannot show that anything is happening. While the
  // Investment agent is open, the page polls a small endpoint that reads the
  // search's own progress notes, and draws them as a card at the foot of the
  // conversation — in the transcript, under the agent's reply, where the
  // person is already looking.
  const FUNDING_AGENT_ID = "investment";
  const SCAN_POLL_MS = 12_000;
  // What the page asks the agent once a search lands. It goes through the
  // agent rather than being rendered here, because the whole point is results
  // in its own words rather than a wall of stored report text.
  //
  // Kept to something a person would plausibly type: the turn is stored like
  // any other and comes back on every reload, so a long machine-worded
  // instruction would sit in the transcript for ever looking like the owner
  // wrote it. How to say it belongs in the skill, not in a string here.
  const SCAN_RESULT_PROMPT = "What did the funding search find?";
  // A scheduled search runs at 11am with nobody watching, so waiting for a tab
  // that saw it running meant the owner still had to ask. Delivery is now
  // decided by what this browser has already read out, kept where it survives
  // a reload, rather than by what one page happened to witness.
  // One list of everything this browser has already read out, funding searches
  // and scheduled tasks alike, so neither can arrive twice and a reload does
  // not undo the memory of it.
  const DELIVERED_KEY = "chat-results-delivered";
  // Old enough and it is not news any more: the owner has moved on, and an
  // unprompted read-out of yesterday's work is noise. They can still ask.
  const DELIVER_WITHIN_MS = 12 * 60 * 60 * 1000;
  const DELIVERED_REMEMBERED = 60;
  let scanPollTimer = null;
  let resultsPollTimer = null;
  let scanWasRunning = false;
  let scanDoneUntil = 0;
  let deliveringScan = false;
  // A floor under the whole mechanism. Marking the search as read handles the
  // ordinary case, but it only works while finishedAt holds still; anything
  // that made it move would turn every poll into a fresh search and the
  // conversation into fifty read-outs. One a minute, whatever else is wrong.
  let lastDeliveredAt = 0;
  let scanCard = null;

  function deliveredList() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(DELIVERED_KEY) ?? "[]");
      return Array.isArray(raw) ? raw.map(String) : [];
    } catch {
      return [];
    }
  }

  function alreadyDelivered(id) {
    return deliveredList().includes(id);
  }

  function markDelivered(id) {
    try {
      const kept = [id, ...deliveredList().filter((seen) => seen !== id)];
      window.localStorage.setItem(
        DELIVERED_KEY,
        JSON.stringify(kept.slice(0, DELIVERED_REMEMBERED)),
      );
    } catch {
      // A browser refusing storage gets one read-out per page load rather
      // than none, which is the better way round to fail.
    }
  }

  function forgetDelivered(id) {
    try {
      window.localStorage.setItem(
        DELIVERED_KEY,
        JSON.stringify(deliveredList().filter((seen) => seen !== id)),
      );
    } catch {}
  }

  // Both kinds of result come back the same way: ask the agent, in words the
  // owner might have used, and let its answer land in the conversation. One at
  // a time, never twice in a minute, and never on top of someone mid-sentence.
  async function deliverViaAgent(id, prompt) {
    if (
      deliveringScan ||
      switchingConversation ||
      requestInProgress ||
      documentRequestInProgress
    ) {
      // Left unmarked on purpose: a person mid-sentence is not interrupted,
      // and the next poll picks it up twelve seconds later.
      return;
    }
    if (Date.now() - lastDeliveredAt < 60_000) {
      return;
    }
    deliveringScan = true;
    lastDeliveredAt = Date.now();
    try {
      // Marked before sending, because sending re-polls and an unmarked
      // result would deliver again on that poll and every one after it.
      markDelivered(id);
      // Shown, not hidden: the server stores it either way, so hiding it now
      // only means it appears out of nowhere on the next reload.
      const sent = await sendMessage(prompt, true);
      if (!sent) {
        // A send that never arrived would otherwise lose the result in
        // silence. Forget it and let the next poll try; the minute floor
        // above is what keeps that from becoming a storm.
        forgetDelivered(id);
      }
    } finally {
      deliveringScan = false;
    }
  }

  function worthDelivering(scan) {
    const finishedAt = String(scan.finishedAt ?? "");
    if (scan.interrupted === true || finishedAt === "") {
      return false;
    }
    const finished = Date.parse(finishedAt);
    if (Number.isNaN(finished) || Date.now() - finished > DELIVER_WITHIN_MS) {
      return false;
    }
    return !alreadyDelivered(`scan:${finishedAt}`);
  }

  // --- tasks that ran on a schedule ---------------------------------------
  // A schedule runs with nobody watching and saves its answer, and until now
  // that was the end of it: the owner had to know to ask, and to know which
  // task to ask about. Any finished task belonging to the agent on screen now
  // reads itself back, once.
  async function refreshScheduleResults() {
    let payload;
    try {
      const response = await fetch("/api/schedule-results", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return;
      }
      payload = await response.json();
    } catch {
      return;
    }
    if (!payload || payload.available === false || !Array.isArray(payload.runs)) {
      return;
    }
    for (const run of payload.runs) {
      if (String(run.agentId ?? "") !== activeAgentId) {
        continue;
      }
      const id = `sched:${run.scheduleId}@${run.ranAt}`;
      if (alreadyDelivered(id)) {
        continue;
      }
      const name = String(run.name ?? "").trim();
      // Named, so the answer is not a reply to a question nobody can see, and
      // phrased as a person would: the turn is stored and comes back on every
      // reload, so it has to read like something the owner might have typed.
      await deliverViaAgent(
        id,
        name === ""
          ? "What did my scheduled task turn up?"
          : `What did my scheduled task "${name}" turn up?`,
      );
      // One per pass. The next poll takes the next one, so two tasks landing
      // together arrive as two messages rather than a burst.
      return;
    }
  }

  function scanProgressCard() {
    if (scanCard) {
      return scanCard;
    }
    const card = document.createElement("div");
    card.className = "scan-progress";
    card.id = "scan-progress";
    card.setAttribute("role", "status");
    card.setAttribute("aria-live", "polite");
    card.hidden = true;

    const spinner = document.createElement("div");
    spinner.className = "scan-progress__spinner";
    spinner.setAttribute("aria-hidden", "true");

    const body = document.createElement("div");
    body.className = "scan-progress__body";
    const note = document.createElement("p");
    note.className = "scan-progress__note";
    const track = document.createElement("div");
    track.className = "scan-progress__track";
    track.setAttribute("aria-hidden", "true");
    const fill = document.createElement("div");
    fill.className = "scan-progress__fill";
    track.append(fill);
    body.append(note, track);

    const meta = document.createElement("p");
    meta.className = "scan-progress__meta";

    card.append(spinner, body, meta);
    scanCard = { card, note, fill, meta };
    return scanCard;
  }

  // Every path that draws the transcript replaces its children, so the card
  // re-attaches itself rather than assuming it survived.
  function attachScanCard(card) {
    if (card.parentElement !== elements.conversation) {
      elements.conversation.append(card);
      return;
    }
    if (elements.conversation.lastElementChild !== card) {
      elements.conversation.append(card);
    }
  }

  function hideScanCard() {
    if (scanCard) {
      scanCard.card.hidden = true;
      scanCard.card.remove();
    }
  }

  function renderScanProgress(scan) {
    if (!scan || scan.available === false) {
      hideScanCard();
      return;
    }
    const { card, note, fill, meta } = scanProgressCard();

    if (scan.running === true) {
      const wasHidden = card.hidden;
      scanWasRunning = true;
      card.classList.remove("scan-progress--done");
      const total = Number(scan.of) || 0;
      const step = Number(scan.step) || 0;
      // Step 0 is "reading the profile", so the bar shows a sliver rather
      // than nothing: a search that just started should look started.
      const percent =
        total > 0
          ? Math.max(4, Math.min(100, Math.round((step / total) * 100)))
          : 4;
      fill.style.width = `${percent}%`;
      note.textContent = String(scan.note ?? "Searching…");
      const started = Number(scan.startedMinutesAgo);
      const quiet = Number(scan.updatedMinutesAgo);
      let text = Number.isFinite(started) ? `Started ${started} min ago` : "";
      // A beat can hold one long API call, so a few quiet minutes are
      // normal; past that the card says when it last heard anything, so a
      // stall is visible instead of the bar just sitting still.
      if (Number.isFinite(quiet) && quiet >= 3) {
        text += ` · last update ${quiet} min ago`;
      }
      meta.textContent = text;
      card.hidden = false;
      attachScanCard(card);
      if (wasHidden) {
        scrollConversation();
      }
      return;
    }

    // Not running. Any finished search this browser has not read out yet gets
    // read out now — whether this page watched it run, or it was started by a
    // schedule hours ago and the owner has only just opened the chat.
    if (scanWasRunning) {
      scanWasRunning = false;
      scanDoneUntil = Date.now() + 90_000;
    }
    if (worthDelivering(scan)) {
      scanDoneUntil = Date.now() + 90_000;
      void deliverViaAgent(`scan:${scan.finishedAt}`, SCAN_RESULT_PROMPT);
    }
    if (Date.now() >= scanDoneUntil) {
      hideScanCard();
      return;
    }
    card.classList.add("scan-progress--done");
    const found = Number(scan.newCount) || 0;
    note.textContent =
      scan.interrupted === true
        ? "The search stopped without finishing. Ask me to search again."
        : found > 0
          ? `Search finished — ${found} new ${found === 1 ? "program" : "programs"} found.`
          : "Search finished.";
    meta.textContent = "";
    card.hidden = false;
    attachScanCard(card);
  }

  // Sending re-polls when it finishes, and an unmarked search would deliver
  // again on that poll, and again on the poll after that one — fifty read-outs
  // in four seconds, each one triggering the next. So the search is marked
  // before anything is sent, never unmarked, and only one send is ever in the
  // air at a time.
  async function refreshScanProgress() {
    // No visibility guard: the browser already throttles background-tab
    // timers, the poll is a couple of hundred bytes, and a guard here is one
    // more way for the bar to sit stale when the user comes back.
    if (activeAgentId !== FUNDING_AGENT_ID) {
      return;
    }
    try {
      const response = await fetch("/api/funding-progress", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        hideScanCard();
        return;
      }
      renderScanProgress(await response.json());
    } catch {
      hideScanCard();
    }
  }

  function syncScanProgress() {
    // Scheduled work belongs to every agent, not just this one, so its poll
    // runs whoever is on screen. The funding progress bar is Investment's
    // alone and starts and stops with it.
    if (resultsPollTimer === null) {
      resultsPollTimer = window.setInterval(() => {
        void refreshScheduleResults();
      }, SCAN_POLL_MS);
    }
    void refreshScheduleResults();

    if (activeAgentId === FUNDING_AGENT_ID) {
      if (scanPollTimer === null) {
        scanPollTimer = window.setInterval(() => {
          void refreshScanProgress();
        }, SCAN_POLL_MS);
      }
      void refreshScanProgress();
      return;
    }
    if (scanPollTimer !== null) {
      window.clearInterval(scanPollTimer);
      scanPollTimer = null;
    }
    scanWasRunning = false;
    scanDoneUntil = 0;
    hideScanCard();
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void refreshScanProgress();
      void refreshScheduleResults();
    }
  });

  function updateCharacterCount() {
    const length = elements.input.value.length;
    elements.characterCount.textContent = `${length} / 8000`;
    elements.characterCount.classList.toggle(
      "character-count--near-limit",
      length >= 7_200,
    );
  }

  function resizeInput() {
    elements.input.style.height = "auto";
    elements.input.style.height = `${Math.min(elements.input.scrollHeight, 160)}px`;
  }

  function startNewConversation() {
    elements.fileInput.value = "";
    elements.pastedName.value = "";
    elements.pastedText.value = "";
    elements.documentStatus.textContent = "";
    setAttachmentMenuOpen(false);
    void createConversation(activeAgentId).catch((error) => {
      addError(
        error instanceof Error
          ? error.message
          : "A new conversation could not be created.",
      );
    });
  }

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendMessage(elements.input.value, true);
  });

  elements.input.addEventListener("input", () => {
    updateCharacterCount();
    resizeInput();
  });

  elements.input.addEventListener("paste", (event) => {
    const pastedText = event.clipboardData?.getData("text") ?? "";
    if (
      pastedText.length > LARGE_PASTE_THRESHOLD ||
      elements.input.value.length + pastedText.length > 8_000
    ) {
      event.preventDefault();
      void uploadPastedText("Pasted transcript", pastedText).then((added) => {
        if (added) {
          elements.documentStatus.textContent =
            "Large pasted text was added as document context. Add an instruction below.";
        }
      });
    }
  });

  elements.input.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.isComposing
    ) {
      event.preventDefault();
      elements.form.requestSubmit();
    }
  });

  elements.attachmentMenuButton.addEventListener("click", () => {
    setAttachmentMenuOpen(elements.attachmentMenu.hidden);
  });

  elements.uploadButton.addEventListener("click", () => {
    setAttachmentMenuOpen(false);
    elements.fileInput.click();
  });

  elements.fileInput.addEventListener("change", () => {
    const file = elements.fileInput.files?.[0];
    if (file) {
      void uploadFile(file);
    }
  });

  elements.pasteButton.addEventListener("click", () => {
    setAttachmentMenuOpen(false);
    elements.pastedName.value = "Pasted transcript";
    elements.pastedText.value = "";
    elements.pasteDialog.showModal();
    elements.pastedText.focus();
  });

  elements.pasteCancel.addEventListener("click", () => {
    elements.pasteDialog.close();
  });

  const MAX_AVATAR_CHARACTERS = 256 * 1024;

  async function loadProfile() {
    try {
      const response = await fetch("/api/profile", {
        headers: { Accept: "application/json" },
      });
      const body = await parseResponse(
        response,
        "Saved agent details could not be loaded.",
      );
      profile = body.profile ?? null;
    } catch {
      // A missing profile must never stop the chat from loading.
      profile = null;
    }
    applySavedAvatar();
  }

  function setAvatarPreview(dataUrl) {
    if (dataUrl.length > 0) {
      elements.profileAvatarButton.style.backgroundImage = `url("${dataUrl}")`;
      elements.profileAvatarInitials.textContent = "";
    } else {
      elements.profileAvatarButton.style.removeProperty("background-image");
      elements.profileAvatarInitials.textContent = getInitials(
        elements.profileAgentName.value || WORKSPACE_NAME,
      );
    }
  }

  async function openProfileDialog() {
    if (profile === null) {
      await loadProfile();
    }
    const saved = profile ?? {};
    elements.profileAgentName.value = saved.agentName ?? "";
    elements.profileBusinessName.value = saved.businessName ?? "";
    elements.profileWho.value = saved.whoYouServe ?? "";
    elements.profileOffer.value = saved.offer ?? saved.sells ?? "";
    elements.profilePrice.value = saved.price ?? "";
    elements.profileBoundaries.value = saved.boundaries ?? "";
    elements.profileVoice.value = saved.voice ?? saved.tone ?? "";
    const samples = Array.isArray(saved.voiceSamples) ? saved.voiceSamples : [];
    elements.profileSample1.value = samples[0] ?? "";
    elements.profileSample2.value = samples[1] ?? "";
    pendingAvatarDataUrl = saved.avatarDataUrl ?? "";
    setAvatarPreview(pendingAvatarDataUrl);
    elements.profileAvatar.value = "";
    elements.profileStatus.textContent = "";
    elements.profileDialog.showModal();
    elements.profileAgentName.focus();
  }

  elements.profileAgentName.addEventListener("input", () => {
    if (pendingAvatarDataUrl.length === 0) {
      setAvatarPreview("");
    }
  });

  elements.profileAvatar.addEventListener("change", () => {
    const file = elements.profileAvatar.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (result.length > MAX_AVATAR_CHARACTERS) {
        elements.profileStatus.textContent =
          "That picture is too large. Choose one under 180 KB.";
        elements.profileAvatar.value = "";
        return;
      }
      pendingAvatarDataUrl = result;
      setAvatarPreview(result);
      elements.profileStatus.textContent = "";
    });
    reader.addEventListener("error", () => {
      elements.profileStatus.textContent = "That picture could not be read.";
    });
    reader.readAsDataURL(file);
  });

  elements.profileAvatarButton.addEventListener("click", () => {
    elements.profileAvatar.click();
  });

  elements.profileCancel.addEventListener("click", () => {
    elements.profileDialog.close();
  });

  elements.myBusinessButton.addEventListener("click", () => {
    void openProfileDialog();
  });

  elements.agentDialogClose.addEventListener("click", () => {
    elements.agentDialog.close();
  });

  elements.agentDialogChat.addEventListener("click", () => {
    const agent = agents.find((candidate) => candidate.id === agentDialogAgentId);
    if (agent?.status === "active") {
      void selectAgent(agent);
    }
  });

  elements.agentDialog.addEventListener("close", () => {
    const returnTarget = agentDialogReturnFocus;
    agentDialogReturnFocus = null;
    if (returnTarget?.isConnected) {
      returnTarget.focus();
    }
  });

  elements.agentDialogForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      const agent = agents.find((candidate) => candidate.id === agentDialogAgentId);
      if (!agent) {
        return;
      }
      const values = {};
      for (const control of elements.agentDialogFields.querySelectorAll(
        "[data-agent-field]",
      )) {
        values[control.dataset.agentField] = control.value;
      }
      elements.agentDialogSave.disabled = true;
      elements.agentDialogStatus.textContent = "Saving...";
      try {
        const response = await fetch("/api/agent-settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: agent.id, values }),
        });
        const body = await parseResponse(
          response,
          `${agent.name} settings could not be saved.`,
        );
        agentSettings = agentSettings ?? {};
        agentSettings[agent.id] = body.values ?? values;
        agent.syncRequired = true;
        elements.agentDialogSync.textContent =
          "Sync required: run npm run sync-skills before relying on these details in chat.";
        elements.agentDialogStatus.textContent =
          "Saved locally. Run npm run sync-skills to send these details to your agent.";
        if (agentDialogReturnFocus?.isConnected) {
          agentDialogReturnFocus.dataset.syncRequired = "true";
          const status = agentDialogReturnFocus.querySelector(
            ".agent-card__status",
          );
          if (status) {
            status.textContent = agentStatusLabel(agent);
          }
        }
      } catch (error) {
        elements.agentDialogStatus.textContent =
          error instanceof Error
            ? error.message
            : `${agent.name} settings could not be saved.`;
      } finally {
        elements.agentDialogSave.disabled = false;
      }
    })();
  });

  // A <dialog> backdrop is painted by the dialog itself, so a click on it
  // reports the dialog as the target. Anything inside the card reports that
  // card instead, which is what separates "outside" from "inside".
  for (const dialog of [
    elements.profileDialog,
    elements.pasteDialog,
    elements.agentDialog,
  ]) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        dialog.close();
      }
    });
  }

  elements.profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      elements.profileSave.disabled = true;
      elements.profileStatus.textContent = "Saving...";
      try {
        const response = await fetch("/api/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile: {
              agentName: elements.profileAgentName.value,
              avatarDataUrl: pendingAvatarDataUrl,
              businessName: elements.profileBusinessName.value,
              whoYouServe: elements.profileWho.value,
              offer: elements.profileOffer.value,
              price: elements.profilePrice.value,
              boundaries: elements.profileBoundaries.value,
              voice: elements.profileVoice.value,
              voiceSamples: [
                elements.profileSample1.value,
                elements.profileSample2.value,
              ],
            },
          }),
        });
        const body = await parseResponse(
          response,
          "Your agent details could not be saved.",
        );
        profile = body.profile ?? null;
        applyAgentIdentity();
        const articlePanel = elements.conversation.querySelector(".article-panel");
        if (articlePanel?.dataset.briefId) {
          const updateResponse = await fetch("/api/seo-article/briefs", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              briefId: articlePanel.dataset.briefId,
            }),
          });
          await parseResponse(updateResponse, "The article choices could not be refreshed.");
          await refreshArticlePanel();
          elements.profileStatus.textContent =
            "Saved. This article now uses your updated details.";
        } else {
          elements.profileStatus.textContent =
            "Saved. Run Sync Skills once before using these details in every chat.";
        }
      } catch (error) {
        elements.profileStatus.textContent =
          error?.message ?? "Your agent details could not be saved.";
      } finally {
        elements.profileSave.disabled = false;
      }
    })();
  });

  document.addEventListener("click", (event) => {
    if (
      !elements.attachmentMenu.hidden &&
      !elements.attachmentMenu.contains(event.target) &&
      !elements.attachmentMenuButton.contains(event.target)
    ) {
      setAttachmentMenuOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.attachmentMenu.hidden) {
      event.preventDefault();
      setAttachmentMenuOpen(false);
      elements.attachmentMenuButton.focus();
    }
    if (event.key === "Escape" && elements.agentDialog.open) {
      event.preventDefault();
      elements.agentDialog.close();
      return;
    }
    if (
      event.key === "Escape" &&
      elements.agentPanel.classList.contains("agent-panel--open")
    ) {
      if (document.querySelector("dialog[open]")) {
        return;
      }
      event.preventDefault();
      setHistoryOpen(false);
    }
  });

  elements.pasteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = elements.pastedName.value;
    const text = elements.pastedText.value;
    void uploadPastedText(name, text).then((added) => {
      if (added) {
        elements.pasteDialog.close();
        elements.input.focus();
      }
    });
  });

  elements.resetButton.addEventListener("click", startNewConversation);
  elements.historyNew.addEventListener("click", startNewConversation);
  elements.historyButton.addEventListener("click", () => {
    setHistoryOpen(true);
  });
  elements.historyClose.addEventListener("click", () => {
    setHistoryOpen(false);
  });
  elements.historyMore.addEventListener("click", () => {
    void loadConversationList({ append: true }).catch((error) => {
      elements.historyStatus.textContent =
        error instanceof Error ? error.message : "More chats could not be loaded.";
    });
  });
  elements.historySearchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void searchConversations(elements.historySearchInput.value).catch((error) => {
      elements.historyStatus.textContent =
        error instanceof Error ? error.message : "Saved chats could not be searched.";
    });
  });
  elements.historySearchInput.addEventListener("input", () => {
    if (!elements.historySearchInput.value.trim()) {
      renderHistoryList();
      elements.historyMore.hidden = !nextConversationCursor;
    }
  });
  narrowLayout.addEventListener("change", () => {
    if (!narrowLayout.matches) {
      elements.agentPanel.classList.remove("agent-panel--open");
      elements.historyButton.setAttribute("aria-expanded", "false");
    }
    syncHistoryPanelAccess();
  });

  async function initialise() {
    syncHistoryPanelAccess();
    await loadAgents();
    await loadProfile();
    applyAgentIdentity();
    renderAgentList();
    renderSuggestions();
    renderDocuments();
    try {
      await loadConversationList();
      try {
        await loadConversation(sessionId);
        return;
      } catch {
        // The browser may hold a pre-persistence session UUID.
      }
      const mostRecent = conversations.find(
        (conversation) => conversation.agentId === activeAgentId,
      ) ?? conversations[0];
      if (mostRecent) {
        await loadConversation(mostRecent.id);
      } else {
        await createConversation(activeAgentId);
      }
    } catch (error) {
      renderNewConversation();
      addError(
        error instanceof Error
          ? error.message
          : "Saved chats could not be loaded. Restart the local app and try again.",
      );
    }
  }

  void initialise();
})();
