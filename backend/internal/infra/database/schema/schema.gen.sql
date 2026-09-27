-- Create "users" table
CREATE TABLE "users" (
  "id" bigserial NOT NULL,
  "email" text NOT NULL DEFAULT '',
  "name" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "ck_users_status" CHECK (status = ANY (ARRAY['active'::text, 'suspended'::text, 'deactivated'::text])),
  CONSTRAINT "ck_users_status_deleted_at" CHECK ((status = 'deactivated'::text) = (deleted_at IS NOT NULL))
);
-- Create index "uq_users_email_active" to table: "users"
CREATE UNIQUE INDEX "uq_users_email_active" ON "users" ((lower(btrim(email, '	
 '::text)))) WHERE ((deleted_at IS NULL) AND (btrim(email, '	
 '::text) <> ''::text));
-- Create "workspaces" table
CREATE TABLE "workspaces" (
  "id" uuid NOT NULL,
  "slug" character varying(64) NOT NULL,
  "name" character varying(200) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "personal_owner_user_id" bigint NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_workspaces_slug" UNIQUE ("slug"),
  CONSTRAINT "fk_workspaces_personal_owner" FOREIGN KEY ("personal_owner_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE SET NULL,
  CONSTRAINT "ck_workspaces_slug_len" CHECK ((char_length((slug)::text) >= 1) AND (char_length((slug)::text) <= 64))
);
-- Create index "uq_workspaces_personal_owner" to table: "workspaces"
CREATE UNIQUE INDEX "uq_workspaces_personal_owner" ON "workspaces" ("personal_owner_user_id") WHERE (personal_owner_user_id IS NOT NULL);
-- Create "spaces" table
CREATE TABLE "spaces" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "key" character varying(64) NOT NULL,
  "name" character varying(200) NOT NULL,
  "visibility" character varying(16) NOT NULL DEFAULT 'workspace',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_spaces_workspace_id" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "uq_spaces_workspace_key" UNIQUE ("workspace_id", "key"),
  CONSTRAINT "fk_spaces_workspace" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_spaces_key_len" CHECK ((char_length((key)::text) >= 1) AND (char_length((key)::text) <= 64)),
  CONSTRAINT "ck_spaces_visibility" CHECK ((visibility)::text = ANY (ARRAY[('workspace'::character varying)::text, ('private'::character varying)::text]))
);
-- Create index "idx_spaces_workspace_id" to table: "spaces"
CREATE INDEX "idx_spaces_workspace_id" ON "spaces" ("workspace_id");
-- Create "pages" table
CREATE TABLE "pages" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "parent_id" uuid NULL,
  "position" text NOT NULL COLLATE "C",
  "title" character varying(200) NOT NULL DEFAULT '',
  "created_by_user_id" bigint NOT NULL,
  "archived_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "icon" jsonb NULL,
  "cover" jsonb NULL,
  "last_edited_by_user_id" bigint NULL,
  "visibility" character varying(16) NOT NULL DEFAULT 'space',
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_pages_workspace_id" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "uq_pages_workspace_space_id" UNIQUE ("workspace_id", "space_id", "id"),
  CONSTRAINT "fk_pages_created_by" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_pages_last_edited_by" FOREIGN KEY ("last_edited_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_pages_parent" FOREIGN KEY ("workspace_id", "space_id", "parent_id") REFERENCES "pages" ("workspace_id", "space_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_pages_space" FOREIGN KEY ("workspace_id", "space_id") REFERENCES "spaces" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_pages_cover_object" CHECK ((cover IS NULL) OR ((jsonb_typeof(cover) = 'object'::text) AND (cover <> '{}'::jsonb))),
  CONSTRAINT "ck_pages_icon_object" CHECK ((icon IS NULL) OR ((jsonb_typeof(icon) = 'object'::text) AND (icon <> '{}'::jsonb))),
  CONSTRAINT "ck_pages_parent_not_self" CHECK ((parent_id IS NULL) OR (parent_id <> id)),
  CONSTRAINT "ck_pages_position_not_empty" CHECK ("position" <> ''::text),
  CONSTRAINT "ck_pages_visibility" CHECK ((visibility)::text = ANY (ARRAY[('public'::character varying)::text, ('space'::character varying)::text, ('private'::character varying)::text]))
);
-- Create index "idx_pages_archived_at" to table: "pages"
CREATE INDEX "idx_pages_archived_at" ON "pages" ("archived_at");
-- Create index "idx_pages_parent_id" to table: "pages"
CREATE INDEX "idx_pages_parent_id" ON "pages" ("parent_id");
-- Create index "idx_pages_space_id" to table: "pages"
CREATE INDEX "idx_pages_space_id" ON "pages" ("space_id");
-- Create index "idx_pages_workspace_id" to table: "pages"
CREATE INDEX "idx_pages_workspace_id" ON "pages" ("workspace_id");
-- Create index "uq_pages_parent_position" to table: "pages"
CREATE UNIQUE INDEX "uq_pages_parent_position" ON "pages" ("parent_id", "position") WHERE (archived_at IS NULL);
-- Create index "uq_pages_space_position" to table: "pages"
CREATE UNIQUE INDEX "uq_pages_space_position" ON "pages" ("space_id", "position") WHERE ((parent_id IS NULL) AND (archived_at IS NULL));
-- Create "blocks" table
CREATE TABLE "blocks" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "page_id" uuid NOT NULL,
  "parent_id" uuid NULL,
  "position" text NOT NULL COLLATE "C",
  "type" character varying(32) NOT NULL,
  "attrs" jsonb NOT NULL DEFAULT '{}',
  "inline" jsonb NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_blocks_workspace_page_id" UNIQUE ("workspace_id", "page_id", "id"),
  CONSTRAINT "fk_blocks_page" FOREIGN KEY ("workspace_id", "page_id") REFERENCES "pages" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_blocks_parent" FOREIGN KEY ("workspace_id", "page_id", "parent_id") REFERENCES "blocks" ("workspace_id", "page_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_blocks_attrs_object" CHECK (jsonb_typeof(attrs) = 'object'::text),
  CONSTRAINT "ck_blocks_inline_array" CHECK ((inline IS NULL) OR (jsonb_typeof(inline) = 'array'::text)),
  CONSTRAINT "ck_blocks_parent_not_self" CHECK ((parent_id IS NULL) OR (parent_id <> id)),
  CONSTRAINT "ck_blocks_position_not_empty" CHECK ("position" <> ''::text)
);
-- Create index "idx_blocks_page_id" to table: "blocks"
CREATE INDEX "idx_blocks_page_id" ON "blocks" ("page_id");
-- Create index "idx_blocks_parent_id" to table: "blocks"
CREATE INDEX "idx_blocks_parent_id" ON "blocks" ("parent_id");
-- Create index "idx_blocks_workspace_id" to table: "blocks"
CREATE INDEX "idx_blocks_workspace_id" ON "blocks" ("workspace_id");
-- Create index "uq_blocks_page_position" to table: "blocks"
CREATE UNIQUE INDEX "uq_blocks_page_position" ON "blocks" ("page_id", "position") WHERE (parent_id IS NULL);
-- Create index "uq_blocks_parent_position" to table: "blocks"
CREATE UNIQUE INDEX "uq_blocks_parent_position" ON "blocks" ("parent_id", "position");
-- Create "comment_threads" table
CREATE TABLE "comment_threads" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "page_id" uuid NOT NULL,
  "block_id" uuid NULL,
  "anchor_from" integer NULL,
  "anchor_to" integer NULL,
  "quote" text NULL,
  "resolved_at" timestamptz NULL,
  "resolved_by_user_id" bigint NULL,
  "created_by_user_id" bigint NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "fk_comment_threads_block" FOREIGN KEY ("block_id") REFERENCES "blocks" ("id") ON UPDATE NO ACTION ON DELETE SET NULL,
  CONSTRAINT "fk_comment_threads_created_by" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_comment_threads_page" FOREIGN KEY ("workspace_id", "page_id") REFERENCES "pages" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_comment_threads_resolved_by" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "ck_comment_threads_anchor_pair" CHECK ((anchor_from IS NULL) = (anchor_to IS NULL)),
  CONSTRAINT "ck_comment_threads_resolved_pair" CHECK ((resolved_at IS NULL) = (resolved_by_user_id IS NULL))
);
-- Create index "idx_comment_threads_block" to table: "comment_threads"
CREATE INDEX "idx_comment_threads_block" ON "comment_threads" ("block_id");
-- Create index "idx_comment_threads_page" to table: "comment_threads"
CREATE INDEX "idx_comment_threads_page" ON "comment_threads" ("workspace_id", "page_id");
-- Create "comments" table
CREATE TABLE "comments" (
  "id" uuid NOT NULL,
  "thread_id" uuid NOT NULL,
  "author_user_id" bigint NOT NULL,
  "body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "fk_comments_author" FOREIGN KEY ("author_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_comments_thread" FOREIGN KEY ("thread_id") REFERENCES "comment_threads" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_comments_body_array" CHECK (jsonb_typeof(body) = 'array'::text)
);
-- Create index "idx_comments_thread" to table: "comments"
CREATE INDEX "idx_comments_thread" ON "comments" ("thread_id");
-- Create "invitations" table
CREATE TABLE "invitations" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "scope" character varying(16) NOT NULL,
  "space_id" uuid NULL,
  "page_id" uuid NULL,
  "role" character varying(16) NOT NULL,
  "email" text NOT NULL,
  "invitee_name" character varying(200) NOT NULL DEFAULT '',
  "token_hash" bytea NOT NULL,
  "invited_by_user_id" bigint NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "last_sent_at" timestamptz NOT NULL DEFAULT now(),
  "last_sent_by_user_id" bigint NOT NULL,
  "send_count" integer NOT NULL DEFAULT 1,
  "accepted_at" timestamptz NULL,
  "accepted_by_user_id" bigint NULL,
  "declined_at" timestamptz NULL,
  "declined_by_user_id" bigint NULL,
  "revoked_at" timestamptz NULL,
  "revoked_by_user_id" bigint NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_invitations_token_hash" UNIQUE ("token_hash"),
  CONSTRAINT "uq_invitations_workspace_id" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "fk_invitations_accepted_by" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_invitations_declined_by" FOREIGN KEY ("declined_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_invitations_invited_by" FOREIGN KEY ("invited_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_invitations_last_sent_by" FOREIGN KEY ("last_sent_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_invitations_page" FOREIGN KEY ("workspace_id", "page_id") REFERENCES "pages" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_invitations_revoked_by" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_invitations_space" FOREIGN KEY ("workspace_id", "space_id") REFERENCES "spaces" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_invitations_workspace" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_invitations_accepted_in_time" CHECK ((accepted_at IS NULL) OR ((accepted_at >= created_at) AND (accepted_at <= expires_at))),
  CONSTRAINT "ck_invitations_accepted_pair" CHECK ((accepted_at IS NULL) = (accepted_by_user_id IS NULL)),
  CONSTRAINT "ck_invitations_declined_pair" CHECK ((declined_at IS NULL) = (declined_by_user_id IS NULL)),
  CONSTRAINT "ck_invitations_email_normalized" CHECK ((email <> ''::text) AND (email = lower(btrim(email, '	
 '::text))) AND ("position"(email, '@'::text) > 1) AND (char_length(email) <= 254)),
  CONSTRAINT "ck_invitations_expires_after_created" CHECK (expires_at > created_at),
  CONSTRAINT "ck_invitations_revoked_pair" CHECK ((revoked_at IS NULL) = (revoked_by_user_id IS NULL)),
  CONSTRAINT "ck_invitations_role" CHECK ((role)::text = ANY (ARRAY[('admin'::character varying)::text, ('editor'::character varying)::text, ('commenter'::character varying)::text, ('viewer'::character varying)::text])),
  CONSTRAINT "ck_invitations_scope" CHECK ((scope)::text = ANY (ARRAY[('workspace'::character varying)::text, ('space'::character varying)::text, ('page'::character varying)::text])),
  CONSTRAINT "ck_invitations_scoped_role_not_admin" CHECK (((scope)::text = 'workspace'::text) OR ((role)::text <> 'admin'::text)),
  CONSTRAINT "ck_invitations_send_count" CHECK (send_count >= 1),
  CONSTRAINT "ck_invitations_single_outcome" CHECK (((((accepted_at IS NOT NULL))::integer + ((declined_at IS NOT NULL))::integer) + ((revoked_at IS NOT NULL))::integer) <= 1),
  CONSTRAINT "ck_invitations_target" CHECK ((((scope)::text = 'workspace'::text) AND (space_id IS NULL) AND (page_id IS NULL)) OR (((scope)::text = 'space'::text) AND (space_id IS NOT NULL) AND (page_id IS NULL)) OR (((scope)::text = 'page'::text) AND (space_id IS NULL) AND (page_id IS NOT NULL))),
  CONSTRAINT "ck_invitations_token_hash_len" CHECK (octet_length(token_hash) = 32)
);
-- Create index "idx_invitations_email_created" to table: "invitations"
CREATE INDEX "idx_invitations_email_created" ON "invitations" ("email", "created_at" DESC);
-- Create index "idx_invitations_open_inviter" to table: "invitations"
CREATE INDEX "idx_invitations_open_inviter" ON "invitations" ("invited_by_user_id") WHERE ((accepted_at IS NULL) AND (declined_at IS NULL) AND (revoked_at IS NULL));
-- Create index "idx_invitations_workspace_created" to table: "invitations"
CREATE INDEX "idx_invitations_workspace_created" ON "invitations" ("workspace_id", "created_at" DESC);
-- Create index "uq_invitations_open_target" to table: "invitations"
CREATE UNIQUE INDEX "uq_invitations_open_target" ON "invitations" ("workspace_id", "email", "scope", (COALESCE(space_id, '00000000-0000-0000-0000-000000000000'::uuid)), (COALESCE(page_id, '00000000-0000-0000-0000-000000000000'::uuid))) WHERE ((accepted_at IS NULL) AND (declined_at IS NULL) AND (revoked_at IS NULL));
-- Create "invitation_sends" table
CREATE TABLE "invitation_sends" (
  "id" uuid NOT NULL,
  "invitation_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "email" text NOT NULL,
  "sent_by_user_id" bigint NOT NULL,
  "sent_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "fk_invitation_sends_invitation" FOREIGN KEY ("invitation_id") REFERENCES "invitations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_invitation_sends_sent_by" FOREIGN KEY ("sent_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_invitation_sends_workspace" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_invitation_sends_email_normalized" CHECK ((email <> ''::text) AND (email = lower(btrim(email, '	
 '::text))))
);
-- Create index "idx_invitation_sends_email_sent" to table: "invitation_sends"
CREATE INDEX "idx_invitation_sends_email_sent" ON "invitation_sends" ("email", "sent_at" DESC);
-- Create index "idx_invitation_sends_invitation" to table: "invitation_sends"
CREATE INDEX "idx_invitation_sends_invitation" ON "invitation_sends" ("invitation_id");
-- Create index "idx_invitation_sends_sender_sent" to table: "invitation_sends"
CREATE INDEX "idx_invitation_sends_sender_sent" ON "invitation_sends" ("sent_by_user_id", "sent_at" DESC);
-- Create "membership_events" table
CREATE TABLE "membership_events" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "target_user_id" bigint NOT NULL,
  "actor_user_id" bigint NOT NULL,
  "action" character varying(32) NOT NULL,
  "old_label" text NULL,
  "new_label" text NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "fk_membership_events_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_membership_events_target" FOREIGN KEY ("target_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_membership_events_workspace" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_membership_events_action" CHECK ((action)::text = ANY (ARRAY[('member_added'::character varying)::text, ('invited'::character varying)::text, ('invitation_accepted'::character varying)::text, ('invitation_declined'::character varying)::text, ('role_changed'::character varying)::text, ('member_removed'::character varying)::text, ('left'::character varying)::text, ('suspended'::character varying)::text]))
);
-- Create index "idx_membership_events_workspace_created" to table: "membership_events"
CREATE INDEX "idx_membership_events_workspace_created" ON "membership_events" ("workspace_id", "created_at");
-- Create "notifications" table
CREATE TABLE "notifications" (
  "id" bigserial NOT NULL,
  "user_id" bigint NOT NULL,
  "type" text NOT NULL DEFAULT '',
  "title" text NOT NULL DEFAULT '',
  "body" text NOT NULL DEFAULT '',
  "is_read" boolean NOT NULL DEFAULT false,
  "link_path" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "fk_notifications_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_notifications_link_path" CHECK ((link_path = ''::text) OR (("left"(link_path, 1) = '/'::text) AND ("left"(link_path, 2) <> '//'::text) AND ("left"(link_path, 2) <> ('/'::text || chr(92)))))
);
-- Create index "idx_notifications_user_id" to table: "notifications"
CREATE INDEX "idx_notifications_user_id" ON "notifications" ("user_id");
-- Create "page_favorites" table
CREATE TABLE "page_favorites" (
  "user_id" bigint NOT NULL,
  "workspace_id" uuid NOT NULL,
  "page_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "page_id"),
  CONSTRAINT "fk_page_favorites_page" FOREIGN KEY ("workspace_id", "page_id") REFERENCES "pages" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_page_favorites_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_page_favorites_user_created_at" to table: "page_favorites"
CREATE INDEX "idx_page_favorites_user_created_at" ON "page_favorites" ("user_id", "created_at");
-- Create "principals" table
CREATE TABLE "principals" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "kind" character varying(16) NOT NULL,
  "user_id" bigint NULL,
  "space_id" uuid NULL,
  "page_id" uuid NULL,
  "name" character varying(200) NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_principals_workspace_id" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "uq_principals_workspace_kind_id" UNIQUE ("workspace_id", "kind", "id"),
  CONSTRAINT "uq_principals_workspace_kind_page_id" UNIQUE ("workspace_id", "kind", "page_id", "id"),
  CONSTRAINT "fk_principals_page" FOREIGN KEY ("workspace_id", "page_id") REFERENCES "pages" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_principals_space" FOREIGN KEY ("workspace_id", "space_id") REFERENCES "spaces" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_principals_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_principals_workspace" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_principals_kind" CHECK ((kind)::text = ANY (ARRAY[('user'::character varying)::text, ('group'::character varying)::text, ('space_all'::character varying)::text, ('share_link'::character varying)::text])),
  CONSTRAINT "ck_principals_name" CHECK (((kind)::text = 'group'::text) = ((name)::text <> (''::character varying)::text)),
  CONSTRAINT "ck_principals_page_id" CHECK (((kind)::text = 'share_link'::text) = (page_id IS NOT NULL)),
  CONSTRAINT "ck_principals_space_id" CHECK (((kind)::text = 'space_all'::text) = (space_id IS NOT NULL)),
  CONSTRAINT "ck_principals_user_id" CHECK (((kind)::text = 'user'::text) = (user_id IS NOT NULL))
);
-- Create index "idx_principals_page_id" to table: "principals"
CREATE INDEX "idx_principals_page_id" ON "principals" ("page_id");
-- Create index "idx_principals_space_id" to table: "principals"
CREATE INDEX "idx_principals_space_id" ON "principals" ("space_id");
-- Create index "idx_principals_user_id" to table: "principals"
CREATE INDEX "idx_principals_user_id" ON "principals" ("user_id");
-- Create index "idx_principals_workspace_id" to table: "principals"
CREATE INDEX "idx_principals_workspace_id" ON "principals" ("workspace_id");
-- Create index "uq_principals_group_name" to table: "principals"
CREATE UNIQUE INDEX "uq_principals_group_name" ON "principals" ("workspace_id", "name") WHERE ((kind)::text = 'group'::text);
-- Create index "uq_principals_space_all" to table: "principals"
CREATE UNIQUE INDEX "uq_principals_space_all" ON "principals" ("workspace_id", "space_id") WHERE ((kind)::text = 'space_all'::text);
-- Create index "uq_principals_workspace_user" to table: "principals"
CREATE UNIQUE INDEX "uq_principals_workspace_user" ON "principals" ("workspace_id", "user_id") WHERE ((kind)::text = 'user'::text);
-- Create "page_grants" table
CREATE TABLE "page_grants" (
  "workspace_id" uuid NOT NULL,
  "page_id" uuid NOT NULL,
  "principal_id" uuid NOT NULL,
  "role" character varying(16) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id", "page_id", "principal_id"),
  CONSTRAINT "fk_page_grants_page" FOREIGN KEY ("workspace_id", "page_id") REFERENCES "pages" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_page_grants_principal" FOREIGN KEY ("workspace_id", "principal_id") REFERENCES "principals" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_page_grants_role" CHECK ((role)::text = ANY (ARRAY[('admin'::character varying)::text, ('editor'::character varying)::text, ('commenter'::character varying)::text, ('viewer'::character varying)::text]))
);
-- Create index "idx_page_grants_principal" to table: "page_grants"
CREATE INDEX "idx_page_grants_principal" ON "page_grants" ("workspace_id", "principal_id");
-- Create "labels" table
CREATE TABLE "labels" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "name" character varying(64) NOT NULL,
  "name_key" character varying(64) NULL GENERATED ALWAYS AS (lower(btrim((name)::text))) STORED,
  "color" character varying(7) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_labels_workspace_id" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "ck_labels_color_hex" CHECK ((color)::text ~ '^#[0-9a-f]{6}$'::text),
  CONSTRAINT "ck_labels_name_trimmed" CHECK (((name)::text = btrim((name)::text)) AND ((name)::text <> ''::text))
);
-- Create index "uq_labels_workspace_name" to table: "labels"
CREATE UNIQUE INDEX "uq_labels_workspace_name" ON "labels" ("workspace_id", "name_key");
-- Create "page_labels" table
CREATE TABLE "page_labels" (
  "workspace_id" uuid NOT NULL,
  "page_id" uuid NOT NULL,
  "label_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("page_id", "label_id"),
  CONSTRAINT "fk_page_labels_label" FOREIGN KEY ("workspace_id", "label_id") REFERENCES "labels" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_page_labels_page" FOREIGN KEY ("workspace_id", "page_id") REFERENCES "pages" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_page_labels_label" to table: "page_labels"
CREATE INDEX "idx_page_labels_label" ON "page_labels" ("label_id");
-- Create "page_links" table
CREATE TABLE "page_links" (
  "source_block_id" uuid NOT NULL,
  "target_page_id" uuid NOT NULL,
  PRIMARY KEY ("source_block_id", "target_page_id"),
  CONSTRAINT "fk_page_links_source_block" FOREIGN KEY ("source_block_id") REFERENCES "blocks" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_page_links_target_page" FOREIGN KEY ("target_page_id") REFERENCES "pages" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_page_links_target_page_id" to table: "page_links"
CREATE INDEX "idx_page_links_target_page_id" ON "page_links" ("target_page_id");
-- Create "page_paths" table
CREATE TABLE "page_paths" (
  "workspace_id" uuid NOT NULL,
  "page_id" uuid NOT NULL,
  "ancestor_id" uuid NOT NULL,
  "depth" integer NOT NULL,
  PRIMARY KEY ("page_id", "ancestor_id"),
  CONSTRAINT "fk_page_paths_ancestor" FOREIGN KEY ("workspace_id", "ancestor_id") REFERENCES "pages" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_page_paths_page" FOREIGN KEY ("workspace_id", "page_id") REFERENCES "pages" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_page_paths_depth" CHECK ((depth >= 0) AND ((depth = 0) = (page_id = ancestor_id)))
);
-- Create index "idx_page_paths_ancestor_id" to table: "page_paths"
CREATE INDEX "idx_page_paths_ancestor_id" ON "page_paths" ("ancestor_id");
-- Create index "idx_page_paths_workspace_id" to table: "page_paths"
CREATE INDEX "idx_page_paths_workspace_id" ON "page_paths" ("workspace_id");
-- Create "page_search" table
CREATE TABLE "page_search" (
  "page_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("page_id"),
  CONSTRAINT "fk_page_search_page" FOREIGN KEY ("workspace_id", "page_id") REFERENCES "pages" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_page_search_body_trgm" to table: "page_search"
CREATE INDEX "idx_page_search_body_trgm" ON "page_search" USING GIN ("body" gin_trgm_ops);
-- Create index "idx_page_search_title_trgm" to table: "page_search"
CREATE INDEX "idx_page_search_title_trgm" ON "page_search" USING GIN ("title" gin_trgm_ops);
-- Create "page_snapshots" table
CREATE TABLE "page_snapshots" (
  "page_id" uuid NOT NULL,
  "doc" jsonb NOT NULL,
  "built_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("page_id"),
  CONSTRAINT "fk_page_snapshots_page" FOREIGN KEY ("page_id") REFERENCES "pages" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_page_snapshots_doc" CHECK ((jsonb_typeof(doc) = 'object'::text) AND ((doc ->> 'type'::text) = 'doc'::text))
);
-- Create "page_versions" table
CREATE TABLE "page_versions" (
  "workspace_id" uuid NOT NULL,
  "page_id" uuid NOT NULL,
  "seq" bigint NOT NULL,
  "doc" jsonb NOT NULL,
  "author_user_id" bigint NOT NULL,
  "note" text NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("page_id", "seq"),
  CONSTRAINT "fk_page_versions_author" FOREIGN KEY ("author_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_page_versions_page" FOREIGN KEY ("workspace_id", "page_id") REFERENCES "pages" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_page_versions_doc" CHECK ((jsonb_typeof(doc) = 'object'::text) AND ((doc ->> 'type'::text) = 'doc'::text))
);
-- Create "page_suggestions" table
CREATE TABLE "page_suggestions" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "page_id" uuid NOT NULL,
  "base_seq" bigint NULL,
  "doc" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "author_user_id" bigint NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz NULL,
  "resolved_by_user_id" bigint NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "fk_page_suggestions_author" FOREIGN KEY ("author_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_page_suggestions_base_version" FOREIGN KEY ("page_id", "base_seq") REFERENCES "page_versions" ("page_id", "seq") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "fk_page_suggestions_page" FOREIGN KEY ("workspace_id", "page_id") REFERENCES "pages" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_page_suggestions_resolved_by" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "ck_page_suggestions_doc" CHECK ((jsonb_typeof(doc) = 'object'::text) AND ((doc ->> 'type'::text) = 'doc'::text)),
  CONSTRAINT "ck_page_suggestions_resolution_consistency" CHECK (((status = 'open'::text) AND (resolved_at IS NULL) AND (resolved_by_user_id IS NULL)) OR ((status <> 'open'::text) AND (resolved_at IS NOT NULL) AND (resolved_by_user_id IS NOT NULL))),
  CONSTRAINT "ck_page_suggestions_status" CHECK (status = ANY (ARRAY['open'::text, 'accepted'::text, 'rejected'::text]))
);
-- Create index "idx_page_suggestions_open_base_seq" to table: "page_suggestions"
CREATE INDEX "idx_page_suggestions_open_base_seq" ON "page_suggestions" ("page_id", "base_seq") WHERE (status = 'open'::text);
-- Create index "idx_page_suggestions_page" to table: "page_suggestions"
CREATE INDEX "idx_page_suggestions_page" ON "page_suggestions" ("workspace_id", "page_id");
-- Create "page_templates" table
CREATE TABLE "page_templates" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "space_id" uuid NULL,
  "name" text NOT NULL,
  "icon" jsonb NULL,
  "doc" jsonb NOT NULL,
  "created_by_user_id" bigint NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_page_templates_workspace_name" UNIQUE ("workspace_id", "name"),
  CONSTRAINT "fk_page_templates_created_by" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_page_templates_space" FOREIGN KEY ("workspace_id", "space_id") REFERENCES "spaces" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_page_templates_workspace" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_page_templates_doc" CHECK ((jsonb_typeof(doc) = 'object'::text) AND ((doc ->> 'type'::text) = 'doc'::text)),
  CONSTRAINT "ck_page_templates_icon" CHECK ((icon IS NULL) OR (jsonb_typeof(icon) = 'object'::text))
);
-- Create index "idx_page_templates_workspace_id" to table: "page_templates"
CREATE INDEX "idx_page_templates_workspace_id" ON "page_templates" ("workspace_id");
-- Create "projects" table
CREATE TABLE "projects" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "key" character varying(64) NOT NULL,
  "name" character varying(200) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_projects_workspace_id" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "uq_projects_workspace_key" UNIQUE ("workspace_id", "key"),
  CONSTRAINT "fk_projects_workspace" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_projects_key_len" CHECK ((char_length((key)::text) >= 1) AND (char_length((key)::text) <= 64))
);
-- Create index "idx_projects_workspace_id" to table: "projects"
CREATE INDEX "idx_projects_workspace_id" ON "projects" ("workspace_id");
-- Create "ticket_statuses" table
CREATE TABLE "ticket_statuses" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "name" character varying(50) NOT NULL,
  "name_lower" character varying(50) NULL GENERATED ALWAYS AS (lower((name)::text)) STORED,
  "category" character varying(16) NOT NULL,
  "color" character varying(7) NOT NULL,
  "position" text NOT NULL COLLATE "C",
  "is_initial" boolean NOT NULL DEFAULT false,
  "archived_at" timestamptz NULL,
  "deleted_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_ticket_statuses_workspace_project_id" UNIQUE ("workspace_id", "project_id", "id"),
  CONSTRAINT "fk_ticket_statuses_project" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_ticket_statuses_category" CHECK ((category)::text = ANY (ARRAY[('todo'::character varying)::text, ('in_progress'::character varying)::text, ('done'::character varying)::text])),
  CONSTRAINT "ck_ticket_statuses_color_hex" CHECK ((color)::text ~ '^#[0-9a-f]{6}$'::text),
  CONSTRAINT "ck_ticket_statuses_initial_active" CHECK (NOT (is_initial AND (archived_at IS NOT NULL))),
  CONSTRAINT "ck_ticket_statuses_name_trimmed" CHECK (((name)::text = btrim((name)::text)) AND ((name)::text <> ''::text)),
  CONSTRAINT "ck_ticket_statuses_position_not_empty" CHECK ("position" <> ''::text)
);
-- Create index "idx_ticket_statuses_workspace_project" to table: "ticket_statuses"
CREATE INDEX "idx_ticket_statuses_workspace_project" ON "ticket_statuses" ("workspace_id", "project_id");
-- Create index "uq_ticket_statuses_project_initial" to table: "ticket_statuses"
CREATE UNIQUE INDEX "uq_ticket_statuses_project_initial" ON "ticket_statuses" ("project_id") WHERE (is_initial AND (archived_at IS NULL) AND (deleted_at IS NULL));
-- Create index "uq_ticket_statuses_project_name" to table: "ticket_statuses"
CREATE UNIQUE INDEX "uq_ticket_statuses_project_name" ON "ticket_statuses" ("project_id", "name_lower") WHERE ((archived_at IS NULL) AND (deleted_at IS NULL));
-- Create index "uq_ticket_statuses_project_position" to table: "ticket_statuses"
CREATE UNIQUE INDEX "uq_ticket_statuses_project_position" ON "ticket_statuses" ("project_id", "position") WHERE ((archived_at IS NULL) AND (deleted_at IS NULL));
-- Create "teams" table
CREATE TABLE "teams" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "name" character varying(60) NOT NULL,
  "name_lower" character varying(60) NULL GENERATED ALWAYS AS (lower((name)::text)) STORED,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_teams_workspace_id" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "uq_teams_workspace_project_id" UNIQUE ("workspace_id", "project_id", "id"),
  CONSTRAINT "fk_teams_project" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_teams_name_not_blank" CHECK (btrim((name)::text) <> ''::text)
);
-- Create index "uq_teams_project_name" to table: "teams"
CREATE UNIQUE INDEX "uq_teams_project_name" ON "teams" ("project_id", "name_lower");
-- Create "ticket_types" table
CREATE TABLE "ticket_types" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "name" character varying(50) NOT NULL,
  "name_lower" character varying(50) NULL GENERATED ALWAYS AS (lower((name)::text)) STORED,
  "color" character varying(7) NOT NULL,
  "hierarchy_level" integer NOT NULL DEFAULT 0,
  "position" text NOT NULL COLLATE "C",
  "is_default" boolean NOT NULL DEFAULT false,
  "template_title" character varying(200) NULL,
  "template_doc" jsonb NULL,
  "archived_at" timestamptz NULL,
  "deleted_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_ticket_types_workspace_project_id" UNIQUE ("workspace_id", "project_id", "id"),
  CONSTRAINT "fk_ticket_types_project" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_ticket_types_color_hex" CHECK ((color)::text ~ '^#[0-9a-f]{6}$'::text),
  CONSTRAINT "ck_ticket_types_default_active" CHECK (NOT (is_default AND (archived_at IS NOT NULL))),
  CONSTRAINT "ck_ticket_types_hierarchy_level" CHECK ((hierarchy_level >= '-1'::integer) AND (hierarchy_level <= 1)),
  CONSTRAINT "ck_ticket_types_name_trimmed" CHECK (((name)::text = btrim((name)::text)) AND ((name)::text <> ''::text)),
  CONSTRAINT "ck_ticket_types_position_not_empty" CHECK ("position" <> ''::text),
  CONSTRAINT "ck_ticket_types_template_doc" CHECK ((template_doc IS NULL) OR ((jsonb_typeof(template_doc) = 'object'::text) AND ((template_doc ->> 'type'::text) = 'doc'::text))),
  CONSTRAINT "ck_ticket_types_template_title_not_blank" CHECK ((template_title IS NULL) OR (btrim((template_title)::text) <> ''::text))
);
-- Create index "idx_ticket_types_workspace_project" to table: "ticket_types"
CREATE INDEX "idx_ticket_types_workspace_project" ON "ticket_types" ("workspace_id", "project_id");
-- Create index "uq_ticket_types_project_default" to table: "ticket_types"
CREATE UNIQUE INDEX "uq_ticket_types_project_default" ON "ticket_types" ("project_id") WHERE (is_default AND (archived_at IS NULL) AND (deleted_at IS NULL));
-- Create index "uq_ticket_types_project_name" to table: "ticket_types"
CREATE UNIQUE INDEX "uq_ticket_types_project_name" ON "ticket_types" ("project_id", "name_lower") WHERE ((archived_at IS NULL) AND (deleted_at IS NULL));
-- Create index "uq_ticket_types_project_position" to table: "ticket_types"
CREATE UNIQUE INDEX "uq_ticket_types_project_position" ON "ticket_types" ("project_id", "position") WHERE ((archived_at IS NULL) AND (deleted_at IS NULL));
-- Create "tickets" table
CREATE TABLE "tickets" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "number" bigint NOT NULL,
  "type_id" uuid NOT NULL,
  "status_id" uuid NOT NULL,
  "parent_id" uuid NULL,
  "title" character varying(200) NOT NULL,
  "doc" jsonb NOT NULL,
  "plain_text" text NOT NULL DEFAULT '',
  "priority" integer NOT NULL DEFAULT 2,
  "story_points" integer NULL,
  "team_id" uuid NULL,
  "start_date" date NULL,
  "due_date" date NULL,
  "closed_at" timestamptz NULL,
  "resolution" character varying(20) NULL,
  "created_by_user_id" bigint NOT NULL,
  "archived_at" timestamptz NULL,
  "deleted_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_tickets_project_number" UNIQUE ("workspace_id", "project_id", "number"),
  CONSTRAINT "uq_tickets_workspace_id" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "uq_tickets_workspace_project_id" UNIQUE ("workspace_id", "project_id", "id"),
  CONSTRAINT "fk_tickets_created_by" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_tickets_parent" FOREIGN KEY ("workspace_id", "project_id", "parent_id") REFERENCES "tickets" ("workspace_id", "project_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_tickets_project" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_tickets_status" FOREIGN KEY ("workspace_id", "project_id", "status_id") REFERENCES "ticket_statuses" ("workspace_id", "project_id", "id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "fk_tickets_team" FOREIGN KEY ("workspace_id", "project_id", "team_id") REFERENCES "teams" ("workspace_id", "project_id", "id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "fk_tickets_type" FOREIGN KEY ("workspace_id", "project_id", "type_id") REFERENCES "ticket_types" ("workspace_id", "project_id", "id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "ck_tickets_closed_pair" CHECK ((closed_at IS NULL) = (resolution IS NULL)),
  CONSTRAINT "ck_tickets_dates_ordered" CHECK ((start_date IS NULL) OR (due_date IS NULL) OR (start_date <= due_date)),
  CONSTRAINT "ck_tickets_doc" CHECK ((jsonb_typeof(doc) = 'object'::text) AND ((doc ->> 'type'::text) = 'doc'::text)),
  CONSTRAINT "ck_tickets_number_positive" CHECK (number > 0),
  CONSTRAINT "ck_tickets_parent_not_self" CHECK ((parent_id IS NULL) OR (parent_id <> id)),
  CONSTRAINT "ck_tickets_priority" CHECK (priority = ANY (ARRAY[1, 2, 3])),
  CONSTRAINT "ck_tickets_resolution" CHECK ((resolution IS NULL) OR ((resolution)::text = ANY (ARRAY[('done'::character varying)::text, ('wont_do'::character varying)::text, ('invalid'::character varying)::text, ('duplicate'::character varying)::text, ('cannot_reproduce'::character varying)::text]))),
  CONSTRAINT "ck_tickets_story_points_range" CHECK ((story_points IS NULL) OR ((story_points >= 0) AND (story_points <= 1000))),
  CONSTRAINT "ck_tickets_title_not_blank" CHECK (btrim((title)::text) <> ''::text)
);
-- Create index "idx_tickets_archived_at" to table: "tickets"
CREATE INDEX "idx_tickets_archived_at" ON "tickets" ("archived_at");
-- Create index "idx_tickets_deleted_at" to table: "tickets"
CREATE INDEX "idx_tickets_deleted_at" ON "tickets" ("deleted_at");
-- Create index "idx_tickets_parent_id" to table: "tickets"
CREATE INDEX "idx_tickets_parent_id" ON "tickets" ("parent_id");
-- Create index "idx_tickets_plain_text_trgm" to table: "tickets"
CREATE INDEX "idx_tickets_plain_text_trgm" ON "tickets" USING GIN ("plain_text" gin_trgm_ops);
-- Create index "idx_tickets_project_status" to table: "tickets"
CREATE INDEX "idx_tickets_project_status" ON "tickets" ("workspace_id", "project_id", "status_id");
-- Create index "idx_tickets_project_type" to table: "tickets"
CREATE INDEX "idx_tickets_project_type" ON "tickets" ("workspace_id", "project_id", "type_id");
-- Create index "idx_tickets_title_trgm" to table: "tickets"
CREATE INDEX "idx_tickets_title_trgm" ON "tickets" USING GIN ("title" gin_trgm_ops);
-- Create "page_ticket_links" table
CREATE TABLE "page_ticket_links" (
  "source_block_id" uuid NOT NULL,
  "target_ticket_id" uuid NOT NULL,
  PRIMARY KEY ("source_block_id", "target_ticket_id"),
  CONSTRAINT "fk_page_ticket_links_source_block" FOREIGN KEY ("source_block_id") REFERENCES "blocks" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_page_ticket_links_target_ticket" FOREIGN KEY ("target_ticket_id") REFERENCES "tickets" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_page_ticket_links_target_ticket_id" to table: "page_ticket_links"
CREATE INDEX "idx_page_ticket_links_target_ticket_id" ON "page_ticket_links" ("target_ticket_id");
-- Create "page_views" table
CREATE TABLE "page_views" (
  "user_id" bigint NOT NULL,
  "workspace_id" uuid NOT NULL,
  "page_id" uuid NOT NULL,
  "viewed_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "page_id"),
  CONSTRAINT "fk_page_views_page" FOREIGN KEY ("workspace_id", "page_id") REFERENCES "pages" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_page_views_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_page_views_page_id" to table: "page_views"
CREATE INDEX "idx_page_views_page_id" ON "page_views" ("page_id");
-- Create index "idx_page_views_user_viewed_at" to table: "page_views"
CREATE INDEX "idx_page_views_user_viewed_at" ON "page_views" ("user_id", "viewed_at");
-- Create "principal_members" table
CREATE TABLE "principal_members" (
  "workspace_id" uuid NOT NULL,
  "group_principal_id" uuid NOT NULL,
  "member_principal_id" uuid NOT NULL,
  "group_kind" character varying(16) NULL GENERATED ALWAYS AS ('group'::character varying) STORED,
  "member_kind" character varying(16) NULL GENERATED ALWAYS AS ('user'::character varying) STORED,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("group_principal_id", "member_principal_id"),
  CONSTRAINT "fk_principal_members_group" FOREIGN KEY ("workspace_id", "group_kind", "group_principal_id") REFERENCES "principals" ("workspace_id", "kind", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_principal_members_member" FOREIGN KEY ("workspace_id", "member_kind", "member_principal_id") REFERENCES "principals" ("workspace_id", "kind", "id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_principal_members_member" to table: "principal_members"
CREATE INDEX "idx_principal_members_member" ON "principal_members" ("workspace_id", "member_principal_id");
-- Create "profiles" table
CREATE TABLE "profiles" (
  "user_id" bigint NOT NULL,
  "bio" text NOT NULL DEFAULT '',
  "avatar_url" text NOT NULL DEFAULT '',
  "status_text" text NOT NULL DEFAULT '',
  "status_emoji" text NOT NULL DEFAULT '',
  "status_expires_at" timestamptz NULL,
  "updated_at" timestamptz NOT NULL,
  PRIMARY KEY ("user_id"),
  CONSTRAINT "fk_profiles_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create "project_versions" table
CREATE TABLE "project_versions" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "name" character varying(60) NOT NULL,
  "name_lower" character varying(60) NULL GENERATED ALWAYS AS (lower((name)::text)) STORED,
  "released_at" timestamptz NULL,
  "position" text NOT NULL COLLATE "C",
  "archived_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_project_versions_workspace_project_id" UNIQUE ("workspace_id", "project_id", "id"),
  CONSTRAINT "fk_project_versions_project" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_project_versions_name_not_blank" CHECK (btrim((name)::text) <> ''::text),
  CONSTRAINT "ck_project_versions_position_not_empty" CHECK ("position" <> ''::text)
);
-- Create index "idx_project_versions_project_position" to table: "project_versions"
CREATE INDEX "idx_project_versions_project_position" ON "project_versions" ("workspace_id", "project_id", "position");
-- Create index "uq_project_versions_project_name" to table: "project_versions"
CREATE UNIQUE INDEX "uq_project_versions_project_name" ON "project_versions" ("project_id", "name_lower") WHERE (archived_at IS NULL);
-- Create "share_links" table
CREATE TABLE "share_links" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "page_id" uuid NOT NULL,
  "principal_id" uuid NOT NULL,
  "principal_kind" character varying(16) NULL GENERATED ALWAYS AS ('share_link'::character varying) STORED,
  "capability" character varying(8) NOT NULL,
  "token_hash" bytea NOT NULL,
  "password_hash" text NULL,
  "expires_at" timestamptz NULL,
  "revoked_at" timestamptz NULL,
  "created_by_user_id" bigint NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_share_links_principal" UNIQUE ("principal_id"),
  CONSTRAINT "uq_share_links_token_hash" UNIQUE ("token_hash"),
  CONSTRAINT "fk_share_links_created_by" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_share_links_page" FOREIGN KEY ("workspace_id", "page_id") REFERENCES "pages" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_share_links_principal" FOREIGN KEY ("workspace_id", "principal_kind", "page_id", "principal_id") REFERENCES "principals" ("workspace_id", "kind", "page_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_share_links_capability" CHECK ((capability)::text = ANY (ARRAY[('view'::character varying)::text, ('edit'::character varying)::text])),
  CONSTRAINT "ck_share_links_password_hash" CHECK ((password_hash IS NULL) OR (password_hash <> ''::text)),
  CONSTRAINT "ck_share_links_token_hash_len" CHECK (octet_length(token_hash) = 32)
);
-- Create index "idx_share_links_created_by" to table: "share_links"
CREATE INDEX "idx_share_links_created_by" ON "share_links" ("created_by_user_id");
-- Create index "idx_share_links_page" to table: "share_links"
CREATE INDEX "idx_share_links_page" ON "share_links" ("workspace_id", "page_id");
-- Create "space_grants" table
CREATE TABLE "space_grants" (
  "workspace_id" uuid NOT NULL,
  "space_id" uuid NOT NULL,
  "principal_id" uuid NOT NULL,
  "role" character varying(16) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id", "space_id", "principal_id"),
  CONSTRAINT "fk_space_grants_principal" FOREIGN KEY ("workspace_id", "principal_id") REFERENCES "principals" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_space_grants_space" FOREIGN KEY ("workspace_id", "space_id") REFERENCES "spaces" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_space_grants_role" CHECK ((role)::text = ANY (ARRAY[('admin'::character varying)::text, ('editor'::character varying)::text, ('commenter'::character varying)::text, ('viewer'::character varying)::text]))
);
-- Create index "idx_space_grants_principal" to table: "space_grants"
CREATE INDEX "idx_space_grants_principal" ON "space_grants" ("workspace_id", "principal_id");
-- Create "sprints" table
CREATE TABLE "sprints" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "name" character varying(200) NOT NULL,
  "state" character varying(16) NOT NULL,
  "start_date" date NULL,
  "end_date" date NULL,
  "position" text NOT NULL COLLATE "C",
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_sprints_project_position" UNIQUE ("workspace_id", "project_id", "position"),
  CONSTRAINT "uq_sprints_workspace_id" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "fk_sprints_project" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_sprints_name_not_empty" CHECK (btrim((name)::text) <> ''::text),
  CONSTRAINT "ck_sprints_period_order" CHECK ((start_date IS NULL) OR (end_date IS NULL) OR (start_date <= end_date)),
  CONSTRAINT "ck_sprints_state" CHECK ((state)::text = ANY (ARRAY[('planned'::character varying)::text, ('active'::character varying)::text, ('completed'::character varying)::text]))
);
-- Create index "idx_sprints_project_position" to table: "sprints"
CREATE INDEX "idx_sprints_project_position" ON "sprints" ("workspace_id", "project_id", "position");
-- Create index "uq_sprints_project_active" to table: "sprints"
CREATE UNIQUE INDEX "uq_sprints_project_active" ON "sprints" ("workspace_id", "project_id") WHERE ((state)::text = 'active'::text);
-- Create "team_members" table
CREATE TABLE "team_members" (
  "workspace_id" uuid NOT NULL,
  "team_id" uuid NOT NULL,
  "user_id" bigint NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id", "team_id", "user_id"),
  CONSTRAINT "fk_team_members_team" FOREIGN KEY ("workspace_id", "team_id") REFERENCES "teams" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_team_members_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_team_members_user" to table: "team_members"
CREATE INDEX "idx_team_members_user" ON "team_members" ("user_id");
-- Create "ticket_assignments" table
CREATE TABLE "ticket_assignments" (
  "workspace_id" uuid NOT NULL,
  "ticket_id" uuid NOT NULL,
  "assignee_principal_id" uuid NOT NULL,
  "assignee_kind" character varying(16) NULL GENERATED ALWAYS AS ('user'::character varying) STORED,
  "assigned_by_user_id" bigint NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("ticket_id"),
  CONSTRAINT "fk_ticket_assignments_assigned_by" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_ticket_assignments_principal" FOREIGN KEY ("workspace_id", "assignee_kind", "assignee_principal_id") REFERENCES "principals" ("workspace_id", "kind", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_assignments_ticket" FOREIGN KEY ("workspace_id", "ticket_id") REFERENCES "tickets" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_ticket_assignments_principal" to table: "ticket_assignments"
CREATE INDEX "idx_ticket_assignments_principal" ON "ticket_assignments" ("workspace_id", "assignee_principal_id");
-- Create "ticket_attachments" table
CREATE TABLE "ticket_attachments" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "ticket_id" uuid NOT NULL,
  "key" text NOT NULL,
  "filename" character varying(255) NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "uploaded_by_user_id" bigint NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "fk_ticket_attachments_ticket" FOREIGN KEY ("workspace_id", "ticket_id") REFERENCES "tickets" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_attachments_uploaded_by" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "ck_ticket_attachments_content_type_not_empty" CHECK (content_type <> ''::text),
  CONSTRAINT "ck_ticket_attachments_filename_not_empty" CHECK (btrim((filename)::text) <> ''::text),
  CONSTRAINT "ck_ticket_attachments_size_positive" CHECK (size_bytes > 0)
);
-- Create index "idx_ticket_attachments_ticket_created" to table: "ticket_attachments"
CREATE INDEX "idx_ticket_attachments_ticket_created" ON "ticket_attachments" ("ticket_id", "created_at");
-- Create "ticket_backlog_ranks" table
CREATE TABLE "ticket_backlog_ranks" (
  "workspace_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "ticket_id" uuid NOT NULL,
  "position" text NOT NULL COLLATE "C",
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id", "ticket_id"),
  CONSTRAINT "uq_ticket_backlog_ranks_project_position" UNIQUE ("workspace_id", "project_id", "position"),
  CONSTRAINT "fk_ticket_backlog_ranks_project" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_backlog_ranks_ticket" FOREIGN KEY ("workspace_id", "ticket_id") REFERENCES "tickets" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_ticket_backlog_ranks_position_not_empty" CHECK ("position" <> ''::text)
);
-- Create "ticket_change_groups" table
CREATE TABLE "ticket_change_groups" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "ticket_id" uuid NOT NULL,
  "actor_user_id" bigint NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_ticket_change_groups_workspace_id" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "fk_ticket_change_groups_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_ticket_change_groups_ticket" FOREIGN KEY ("workspace_id", "ticket_id") REFERENCES "tickets" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_ticket_change_groups_ticket_created" to table: "ticket_change_groups"
CREATE INDEX "idx_ticket_change_groups_ticket_created" ON "ticket_change_groups" ("ticket_id", "created_at");
-- Create "ticket_change_items" table
CREATE TABLE "ticket_change_items" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "field" character varying(32) NOT NULL,
  "old_value" text NULL,
  "new_value" text NULL,
  "old_label" text NULL,
  "new_label" text NULL,
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "fk_ticket_change_items_group" FOREIGN KEY ("workspace_id", "group_id") REFERENCES "ticket_change_groups" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_ticket_change_items_changed" CHECK ((old_value IS DISTINCT FROM new_value) OR (old_label IS DISTINCT FROM new_label) OR ((field)::text = 'doc'::text)),
  CONSTRAINT "ck_ticket_change_items_field" CHECK ((field)::text = ANY (ARRAY[('title'::character varying)::text, ('doc'::character varying)::text, ('status'::character varying)::text, ('type'::character varying)::text, ('priority'::character varying)::text, ('assignee'::character varying)::text, ('parent'::character varying)::text, ('start_date'::character varying)::text, ('due_date'::character varying)::text, ('resolution'::character varying)::text, ('position'::character varying)::text, ('archived'::character varying)::text, ('category'::character varying)::text, ('milestone'::character varying)::text, ('link'::character varying)::text, ('deleted'::character varying)::text]))
);
-- Create index "idx_ticket_change_items_group_id" to table: "ticket_change_items"
CREATE INDEX "idx_ticket_change_items_group_id" ON "ticket_change_items" ("group_id");
-- Create "ticket_comments" table
CREATE TABLE "ticket_comments" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "ticket_id" uuid NOT NULL,
  "parent_comment_id" uuid NULL,
  "author_user_id" bigint NOT NULL,
  "body" jsonb NOT NULL,
  "edited_at" timestamptz NULL,
  "deleted_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "uq_ticket_comments_workspace_id" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "fk_ticket_comments_author" FOREIGN KEY ("author_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_ticket_comments_parent" FOREIGN KEY ("workspace_id", "parent_comment_id") REFERENCES "ticket_comments" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_comments_ticket" FOREIGN KEY ("workspace_id", "ticket_id") REFERENCES "tickets" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_ticket_comments_body_array" CHECK (jsonb_typeof(body) = 'array'::text)
);
-- Create index "idx_ticket_comments_parent" to table: "ticket_comments"
CREATE INDEX "idx_ticket_comments_parent" ON "ticket_comments" ("parent_comment_id");
-- Create index "idx_ticket_comments_ticket_created" to table: "ticket_comments"
CREATE INDEX "idx_ticket_comments_ticket_created" ON "ticket_comments" ("ticket_id", "created_at");
-- Create "ticket_comment_edits" table
CREATE TABLE "ticket_comment_edits" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "comment_id" uuid NOT NULL,
  "editor_user_id" bigint NOT NULL,
  "previous_body" jsonb NOT NULL,
  "edited_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "fk_ticket_comment_edits_comment" FOREIGN KEY ("workspace_id", "comment_id") REFERENCES "ticket_comments" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_comment_edits_editor" FOREIGN KEY ("editor_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "ck_ticket_comment_edits_previous_body_array" CHECK (jsonb_typeof(previous_body) = 'array'::text)
);
-- Create index "idx_ticket_comment_edits_comment" to table: "ticket_comment_edits"
CREATE INDEX "idx_ticket_comment_edits_comment" ON "ticket_comment_edits" ("comment_id", "edited_at");
-- Create "ticket_comment_reactions" table
CREATE TABLE "ticket_comment_reactions" (
  "workspace_id" uuid NOT NULL,
  "comment_id" uuid NOT NULL,
  "user_id" bigint NOT NULL,
  "emoji" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("comment_id", "user_id", "emoji"),
  CONSTRAINT "fk_ticket_comment_reactions_comment" FOREIGN KEY ("workspace_id", "comment_id") REFERENCES "ticket_comments" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_comment_reactions_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_ticket_comment_reactions_emoji_not_empty" CHECK ((emoji <> ''::text) AND (octet_length(emoji) <= 32))
);
-- Create "ticket_counters" table
CREATE TABLE "ticket_counters" (
  "workspace_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "last_number" bigint NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("workspace_id", "project_id"),
  CONSTRAINT "fk_ticket_counters_project" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_ticket_counters_last_number_positive" CHECK (last_number > 0)
);
-- Create "ticket_fix_versions" table
CREATE TABLE "ticket_fix_versions" (
  "workspace_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "ticket_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id", "ticket_id", "version_id"),
  CONSTRAINT "fk_ticket_fix_versions_ticket" FOREIGN KEY ("workspace_id", "project_id", "ticket_id") REFERENCES "tickets" ("workspace_id", "project_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_fix_versions_version" FOREIGN KEY ("workspace_id", "project_id", "version_id") REFERENCES "project_versions" ("workspace_id", "project_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_ticket_fix_versions_version" to table: "ticket_fix_versions"
CREATE INDEX "idx_ticket_fix_versions_version" ON "ticket_fix_versions" ("workspace_id", "version_id");
-- Create "ticket_labels" table
CREATE TABLE "ticket_labels" (
  "workspace_id" uuid NOT NULL,
  "ticket_id" uuid NOT NULL,
  "label_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("ticket_id", "label_id"),
  CONSTRAINT "fk_ticket_labels_label" FOREIGN KEY ("workspace_id", "label_id") REFERENCES "labels" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_labels_ticket" FOREIGN KEY ("workspace_id", "ticket_id") REFERENCES "tickets" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_ticket_labels_label" to table: "ticket_labels"
CREATE INDEX "idx_ticket_labels_label" ON "ticket_labels" ("label_id");
-- Create "ticket_page_links" table
CREATE TABLE "ticket_page_links" (
  "workspace_id" uuid NOT NULL,
  "source_ticket_id" uuid NOT NULL,
  "target_page_id" uuid NOT NULL,
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("source_ticket_id", "target_page_id"),
  CONSTRAINT "fk_ticket_page_links_source" FOREIGN KEY ("workspace_id", "source_ticket_id") REFERENCES "tickets" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_page_links_target" FOREIGN KEY ("workspace_id", "target_page_id") REFERENCES "pages" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_ticket_page_links_target" to table: "ticket_page_links"
CREATE INDEX "idx_ticket_page_links_target" ON "ticket_page_links" ("target_page_id");
-- Create "ticket_paths" table
CREATE TABLE "ticket_paths" (
  "workspace_id" uuid NOT NULL,
  "ticket_id" uuid NOT NULL,
  "ancestor_id" uuid NOT NULL,
  "depth" integer NOT NULL,
  PRIMARY KEY ("ticket_id", "ancestor_id"),
  CONSTRAINT "fk_ticket_paths_ancestor" FOREIGN KEY ("workspace_id", "ancestor_id") REFERENCES "tickets" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_paths_ticket" FOREIGN KEY ("workspace_id", "ticket_id") REFERENCES "tickets" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_ticket_paths_depth" CHECK ((depth >= 0) AND ((depth = 0) = (ticket_id = ancestor_id)))
);
-- Create index "idx_ticket_paths_ancestor_id" to table: "ticket_paths"
CREATE INDEX "idx_ticket_paths_ancestor_id" ON "ticket_paths" ("ancestor_id");
-- Create index "idx_ticket_paths_workspace_id" to table: "ticket_paths"
CREATE INDEX "idx_ticket_paths_workspace_id" ON "ticket_paths" ("workspace_id");
-- Create "ticket_saved_filters" table
CREATE TABLE "ticket_saved_filters" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" bigint NOT NULL,
  "name" character varying(60) NOT NULL,
  "name_lower" character varying(60) NULL GENERATED ALWAYS AS (lower((name)::text)) STORED,
  "status_id" uuid NULL,
  "type_id" uuid NULL,
  "label_id" uuid NULL,
  "assignee_principal_id" uuid NULL,
  "assignee_kind" character varying(16) NULL GENERATED ALWAYS AS ('user'::character varying) STORED,
  "unassigned" boolean NOT NULL DEFAULT false,
  "assigned_to_me" boolean NOT NULL DEFAULT false,
  "overdue" boolean NOT NULL DEFAULT false,
  "q" character varying(200) NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "fk_ticket_saved_filters_assignee" FOREIGN KEY ("workspace_id", "assignee_kind", "assignee_principal_id") REFERENCES "principals" ("workspace_id", "kind", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_saved_filters_label" FOREIGN KEY ("workspace_id", "label_id") REFERENCES "labels" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_saved_filters_project" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_saved_filters_status" FOREIGN KEY ("workspace_id", "project_id", "status_id") REFERENCES "ticket_statuses" ("workspace_id", "project_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_saved_filters_type" FOREIGN KEY ("workspace_id", "project_id", "type_id") REFERENCES "ticket_types" ("workspace_id", "project_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_saved_filters_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_ticket_saved_filters_assignee_mode" CHECK (((((assignee_principal_id IS NOT NULL))::integer + (unassigned)::integer) + (assigned_to_me)::integer) <= 1),
  CONSTRAINT "ck_ticket_saved_filters_has_condition" CHECK ((status_id IS NOT NULL) OR (type_id IS NOT NULL) OR (label_id IS NOT NULL) OR (assignee_principal_id IS NOT NULL) OR unassigned OR assigned_to_me OR overdue OR (q IS NOT NULL)),
  CONSTRAINT "ck_ticket_saved_filters_name_trimmed" CHECK (((name)::text = btrim((name)::text)) AND ((name)::text <> ''::text)),
  CONSTRAINT "ck_ticket_saved_filters_q_not_blank" CHECK ((q IS NULL) OR (btrim((q)::text) <> ''::text))
);
-- Create index "uq_ticket_saved_filters_owner_name" to table: "ticket_saved_filters"
CREATE UNIQUE INDEX "uq_ticket_saved_filters_owner_name" ON "ticket_saved_filters" ("project_id", "user_id", "name_lower");
-- Create "ticket_sprint_ranks" table
CREATE TABLE "ticket_sprint_ranks" (
  "workspace_id" uuid NOT NULL,
  "sprint_id" uuid NOT NULL,
  "ticket_id" uuid NOT NULL,
  "position" text NOT NULL COLLATE "C",
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id", "ticket_id"),
  CONSTRAINT "uq_ticket_sprint_ranks_sprint_position" UNIQUE ("workspace_id", "sprint_id", "position"),
  CONSTRAINT "fk_ticket_sprint_ranks_sprint" FOREIGN KEY ("workspace_id", "sprint_id") REFERENCES "sprints" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_sprint_ranks_ticket" FOREIGN KEY ("workspace_id", "ticket_id") REFERENCES "tickets" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_ticket_sprint_ranks_position_not_empty" CHECK ("position" <> ''::text)
);
-- Create "ticket_status_transitions" table
CREATE TABLE "ticket_status_transitions" (
  "id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "ticket_id" uuid NOT NULL,
  "from_status_id" uuid NOT NULL,
  "to_status_id" uuid NOT NULL,
  "changed_by_user_id" bigint NOT NULL,
  "changed_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "fk_ticket_status_transitions_changed_by" FOREIGN KEY ("changed_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_ticket_status_transitions_from" FOREIGN KEY ("workspace_id", "project_id", "from_status_id") REFERENCES "ticket_statuses" ("workspace_id", "project_id", "id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "fk_ticket_status_transitions_ticket" FOREIGN KEY ("workspace_id", "ticket_id") REFERENCES "tickets" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_status_transitions_to" FOREIGN KEY ("workspace_id", "project_id", "to_status_id") REFERENCES "ticket_statuses" ("workspace_id", "project_id", "id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "ck_ticket_status_transitions_distinct" CHECK (from_status_id <> to_status_id)
);
-- Create index "idx_ticket_status_transitions_ticket_changed" to table: "ticket_status_transitions"
CREATE INDEX "idx_ticket_status_transitions_ticket_changed" ON "ticket_status_transitions" ("ticket_id", "changed_at");
-- Create "ticket_ticket_links" table
CREATE TABLE "ticket_ticket_links" (
  "workspace_id" uuid NOT NULL,
  "source_ticket_id" uuid NOT NULL,
  "target_ticket_id" uuid NOT NULL,
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("source_ticket_id", "target_ticket_id"),
  CONSTRAINT "fk_ticket_ticket_links_source" FOREIGN KEY ("workspace_id", "source_ticket_id") REFERENCES "tickets" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_ticket_links_target" FOREIGN KEY ("workspace_id", "target_ticket_id") REFERENCES "tickets" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_ticket_ticket_links_not_self" CHECK (source_ticket_id <> target_ticket_id)
);
-- Create index "idx_ticket_ticket_links_target" to table: "ticket_ticket_links"
CREATE INDEX "idx_ticket_ticket_links_target" ON "ticket_ticket_links" ("target_ticket_id");
-- Create "ticket_watchers" table
CREATE TABLE "ticket_watchers" (
  "workspace_id" uuid NOT NULL,
  "ticket_id" uuid NOT NULL,
  "user_id" bigint NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id", "ticket_id", "user_id"),
  CONSTRAINT "fk_ticket_watchers_ticket" FOREIGN KEY ("workspace_id", "ticket_id") REFERENCES "tickets" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_ticket_watchers_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_ticket_watchers_user" to table: "ticket_watchers"
CREATE INDEX "idx_ticket_watchers_user" ON "ticket_watchers" ("workspace_id", "user_id");
-- Create "user_oidc_identities" table
CREATE TABLE "user_oidc_identities" (
  "id" bigserial NOT NULL,
  "user_id" bigint NOT NULL,
  "provider" text NOT NULL DEFAULT 'oidc',
  "subject" text NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "fk_user_oidc_identities_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_user_oidc_identities_not_empty" CHECK ((provider <> ''::text) AND (subject <> ''::text))
);
-- Create index "uq_user_oidc_provider_subject" to table: "user_oidc_identities"
CREATE UNIQUE INDEX "uq_user_oidc_provider_subject" ON "user_oidc_identities" ("provider", "subject");
-- Create index "uq_user_oidc_user_provider" to table: "user_oidc_identities"
CREATE UNIQUE INDEX "uq_user_oidc_user_provider" ON "user_oidc_identities" ("user_id", "provider");
-- Create "workspace_grants" table
CREATE TABLE "workspace_grants" (
  "workspace_id" uuid NOT NULL,
  "principal_id" uuid NOT NULL,
  "role" character varying(16) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id", "principal_id"),
  CONSTRAINT "fk_workspace_grants_principal" FOREIGN KEY ("workspace_id", "principal_id") REFERENCES "principals" ("workspace_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_workspace_grants_role" CHECK ((role)::text = ANY (ARRAY[('admin'::character varying)::text, ('editor'::character varying)::text, ('commenter'::character varying)::text, ('viewer'::character varying)::text]))
);
-- Create "workspace_members" table
CREATE TABLE "workspace_members" (
  "workspace_id" uuid NOT NULL,
  "user_id" bigint NOT NULL,
  "status" text NOT NULL,
  "invited_by_user_id" bigint NULL,
  "joined_at" timestamptz NULL,
  "left_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id", "user_id"),
  CONSTRAINT "fk_workspace_members_invited_by" FOREIGN KEY ("invited_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_workspace_members_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_workspace_members_workspace" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ck_workspace_members_status" CHECK (status = ANY (ARRAY['invited'::text, 'active'::text, 'suspended'::text, 'left'::text]))
);
