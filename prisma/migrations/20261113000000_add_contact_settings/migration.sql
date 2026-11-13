-- CreateTable
CREATE TABLE "contact_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "zalo_oa_id" TEXT,
    "zalo_phone" TEXT,
    "messenger_page" TEXT,
    "hotline" TEXT,
    "welcome_message" TEXT,
    "is_chat_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_settings_pkey" PRIMARY KEY ("id")
);

-- Enable Row Level Security (RLS)
ALTER TABLE "contact_settings" ENABLE ROW LEVEL SECURITY;

-- Seed default row
INSERT INTO "contact_settings" (
    "id",
    "zalo_oa_id",
    "zalo_phone",
    "messenger_page",
    "hotline",
    "welcome_message",
    "is_chat_enabled",
    "updated_by",
    "updated_at"
) VALUES (
    'default',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    false,
    NULL,
    CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

