-- Phase 1E: Candidate messenger — Conversation, Message, MessageTemplate.
-- Adds three new tables and their RLS policies.

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "message_channel_type" AS ENUM (
    'in_app',
    'email',
    'telegram',
    'hh_chat'
);

CREATE TYPE "message_direction" AS ENUM (
    'inbound',
    'outbound'
);

CREATE TYPE "message_status" AS ENUM (
    'draft',
    'queued',
    'sent',
    'delivered',
    'failed',
    'received'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Conversations
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "conversations" (
    "id"             UUID         NOT NULL DEFAULT uuidv7(),
    "tenant_id"      UUID         NOT NULL,
    "candidate_id"   UUID         NOT NULL,
    "application_id" UUID,
    "subject"        TEXT,
    "last_message_at" TIMESTAMP(3),
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversations_tenant_id_idx"      ON "conversations"("tenant_id");
CREATE INDEX "conversations_candidate_id_idx"   ON "conversations"("candidate_id");
CREATE INDEX "conversations_application_id_idx" ON "conversations"("application_id");

ALTER TABLE "conversations"
    ADD CONSTRAINT "conversations_candidate_id_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversations"
    ADD CONSTRAINT "conversations_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Messages
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "messages" (
    "id"              UUID                   NOT NULL DEFAULT uuidv7(),
    "tenant_id"       UUID                   NOT NULL,
    "conversation_id" UUID                   NOT NULL,
    "channel"         "message_channel_type" NOT NULL,
    "direction"       "message_direction"    NOT NULL,
    "body"            TEXT                   NOT NULL,
    "sender_user_id"  UUID,
    "external_id"     TEXT,
    "status"          "message_status"       NOT NULL DEFAULT 'draft',
    "sent_at"         TIMESTAMP(3),
    "created_at"      TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "messages_tenant_id_idx"          ON "messages"("tenant_id");
CREATE INDEX "messages_conversation_id_idx"    ON "messages"("conversation_id");
CREATE INDEX "messages_channel_external_id_idx" ON "messages"("channel", "external_id");

-- Inbound dedup: (channel, external_id) must be unique when external_id is not null.
CREATE UNIQUE INDEX "messages_channel_external_id_unique"
    ON "messages"("channel", "external_id")
    WHERE "external_id" IS NOT NULL;

ALTER TABLE "messages"
    ADD CONSTRAINT "messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- MessageTemplates
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "message_templates" (
    "id"                UUID                    NOT NULL DEFAULT uuidv7(),
    "tenant_id"         UUID                    NOT NULL,
    "name"              TEXT                    NOT NULL,
    "channel"           "message_channel_type",
    "subject"           TEXT,
    "body"              TEXT                    NOT NULL,
    "created_by_user_id" UUID                   NOT NULL,
    "created_at"        TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3)            NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "message_templates_tenant_id_idx" ON "message_templates"("tenant_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────────

-- conversations
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "conversations_select" ON "conversations" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );

CREATE POLICY "conversations_write" ON "conversations" FOR ALL
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );

-- messages
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;

CREATE POLICY "messages_select" ON "messages" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );

CREATE POLICY "messages_write" ON "messages" FOR ALL
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );

-- message_templates
ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_templates" FORCE ROW LEVEL SECURITY;

CREATE POLICY "message_templates_select" ON "message_templates" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );

CREATE POLICY "message_templates_write" ON "message_templates" FOR ALL
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );

-- Grant app_user access
GRANT SELECT, INSERT, UPDATE, DELETE ON
    "conversations",
    "messages",
    "message_templates"
TO app_user;
