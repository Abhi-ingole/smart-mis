-- CreateTable
CREATE TABLE "companies" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "company_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" DATETIME,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "daily_metrics" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "company_id" INTEGER NOT NULL,
    "report_date" TEXT NOT NULL,
    "campaign" TEXT NOT NULL,
    "wa_recipients" INTEGER NOT NULL DEFAULT 0,
    "wa_delivered" INTEGER NOT NULL DEFAULT 0,
    "email_sent" INTEGER NOT NULL DEFAULT 0,
    "email_opened" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "wa_source_file" TEXT,
    "email_source_file" TEXT,
    "wa_extracted_json" TEXT,
    "email_extracted_json" TEXT,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "daily_metrics_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "targets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "company_id" INTEGER NOT NULL,
    "month" TEXT NOT NULL,
    "wa_recipients" INTEGER NOT NULL DEFAULT 0,
    "wa_delivered" INTEGER NOT NULL DEFAULT 0,
    "email_sent" INTEGER NOT NULL DEFAULT 0,
    "email_opened" INTEGER NOT NULL DEFAULT 0,
    "delivery_pct" REAL NOT NULL DEFAULT 0,
    "open_pct" REAL NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "targets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "company_id" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "holidays_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "reports" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "company_id" INTEGER NOT NULL,
    "report_date" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "kpis_json" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "whatsapp_text" TEXT NOT NULL,
    "sent_via" TEXT,
    "sent_to" TEXT,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reports_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "company_id" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "company_id" INTEGER,
    "user_id" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "details_json" TEXT,
    "ip" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "company_id" INTEGER NOT NULL,
    "stored_name" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "uploads_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_company_id_idx" ON "users"("company_id");

-- CreateIndex
CREATE INDEX "daily_metrics_company_id_report_date_idx" ON "daily_metrics"("company_id", "report_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_metrics_company_id_report_date_campaign_key" ON "daily_metrics"("company_id", "report_date", "campaign");

-- CreateIndex
CREATE UNIQUE INDEX "targets_company_id_month_key" ON "targets"("company_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_company_id_date_key" ON "holidays"("company_id", "date");

-- CreateIndex
CREATE INDEX "reports_company_id_report_date_idx" ON "reports"("company_id", "report_date");

-- CreateIndex
CREATE UNIQUE INDEX "settings_company_id_key_key" ON "settings"("company_id", "key");

-- CreateIndex
CREATE INDEX "audit_log_company_id_created_at_idx" ON "audit_log"("company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uploads_stored_name_key" ON "uploads"("stored_name");

-- CreateIndex
CREATE INDEX "uploads_company_id_idx" ON "uploads"("company_id");
