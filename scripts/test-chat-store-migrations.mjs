import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ChatStore } from "../apps/chat/dist/chat-store.js";

const temporary = await mkdtemp(join(tmpdir(), "chat-store-migration-test-"));
const databasePath = join(temporary, "chat.sqlite");
let activeStore;
let activeDatabase;

try {
  activeStore = new ChatStore(databasePath);
  const original = activeStore;
  const existingJob = original.registerSeoArticleJob({
    sessionId: "11111111-1111-4111-8111-111111111111",
    requestId: "22222222-2222-4222-8222-222222222222",
    domain: "example.com",
    briefId: "",
    requestedTopic: "A topic the private schema cannot retain",
    topicSource: "custom",
    primaryKeyword: "preserved primary keyword",
    supportingKeywords: ["preserved supporting keyword"],
    input: { preserved: true },
  }).job;
  original.close();
  activeStore = undefined;

  activeDatabase = new DatabaseSync(databasePath);
  const privateFork = activeDatabase;
  privateFork.exec(`
    DROP TABLE seo_article_versions;
    DROP TABLE seo_article_briefs;
    DROP INDEX seo_article_jobs_brief;
    ALTER TABLE seo_article_jobs DROP COLUMN brief_id;
    ALTER TABLE seo_article_jobs DROP COLUMN requested_topic;
    ALTER TABLE seo_article_jobs DROP COLUMN topic_source;
    ALTER TABLE seo_article_jobs DROP COLUMN strategy_json;
    PRAGMA user_version = 6;
  `);
  privateFork.close();
  activeDatabase = undefined;

  activeStore = new ChatStore(databasePath);
  const reconciled = activeStore;
  assert.equal(reconciled.health().schemaVersion, 6);

  const preservedJob = reconciled.getSeoArticleJob(existingJob.sessionId, existingJob.jobId);
  assert(preservedJob, "the existing article job must survive schema reconciliation");
  assert.equal(preservedJob.requestId, existingJob.requestId);
  assert.equal(preservedJob.primaryKeyword, "preserved primary keyword");
  assert.deepEqual(preservedJob.supportingKeywords, ["preserved supporting keyword"]);
  assert.deepEqual(preservedJob.input, { preserved: true });
  assert.equal(preservedJob.requestedTopic, "preserved primary keyword");
  assert.equal(preservedJob.topicSource, "custom");

  activeDatabase = new DatabaseSync(databasePath, { readOnly: true });
  const schema = activeDatabase;
  const articleTables = new Set(
    schema
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'seo_article_%'",
      )
      .all()
      .map((row) => row.name),
  );
  assert.deepEqual(
    articleTables,
    new Set(["seo_article_briefs", "seo_article_jobs", "seo_article_versions"]),
  );
  const jobColumns = new Set(
    schema
      .prepare("PRAGMA table_info(seo_article_jobs)")
      .all()
      .map((row) => row.name),
  );
  for (const column of ["brief_id", "requested_topic", "topic_source", "strategy_json"]) {
    assert(jobColumns.has(column), `missing reconciled article-job column ${column}`);
  }
  schema.close();
  activeDatabase = undefined;
  reconciled.close();
  activeStore = undefined;
} finally {
  activeDatabase?.close();
  activeStore?.close();
  await rm(temporary, { recursive: true, force: true });
}

console.log("ChatStore reconciles colliding private-fork schema versions without data loss.");
