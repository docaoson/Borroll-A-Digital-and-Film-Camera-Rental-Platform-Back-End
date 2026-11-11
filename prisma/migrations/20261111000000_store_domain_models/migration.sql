-- Enable required Postgres extensions
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- CreateEnum
CREATE TYPE "ModelKind" AS ENUM ('CAMERA', 'LENS', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "CameraType" AS ENUM ('DIGITAL', 'FILM', 'INSTANT');

-- CreateEnum
CREATE TYPE "ImageKind" AS ENUM ('PRODUCT', 'SAMPLE');

-- CreateEnum
CREATE TYPE "UnitCondition" AS ENUM ('EXCELLENT', 'GOOD', 'FAIR');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('AVAILABLE', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PICKED_UP', 'RETURNED', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HandoverKind" AS ENUM ('PICKUP', 'RETURN');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('DEPOSIT_RECEIVED', 'RENTAL_RECEIVED', 'DEPOSIT_REFUNDED', 'DAMAGE_CHARGE', 'LATE_FEE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER');

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "open_hours" TEXT NOT NULL,
    "map_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_models" (
    "id" TEXT NOT NULL,
    "kind" "ModelKind" NOT NULL,
    "category_id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "camera_type" "CameraType",
    "mount" TEXT,
    "film_format" TEXT,
    "price_per_day" INTEGER NOT NULL,
    "price_per_week" INTEGER,
    "deposit" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "last_inspected_at" TIMESTAMP(3),
    "inspection_notes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_model_images" (
    "id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "kind" "ImageKind" NOT NULL DEFAULT 'PRODUCT',
    "caption" TEXT,
    "sample_lens" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_model_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_model_specs" (
    "model_id" TEXT NOT NULL,
    "specs" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_model_specs_pkey" PRIMARY KEY ("model_id")
);

-- CreateTable
CREATE TABLE "film_products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iso" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "in_stock" BOOLEAN NOT NULL DEFAULT true,
    "image_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "film_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "user_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("user_id","model_id")
);

-- CreateTable
CREATE TABLE "rental_units" (
    "id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "serial_number" TEXT NOT NULL,
    "condition" "UnitCondition" NOT NULL DEFAULT 'EXCELLENT',
    "status" "UnitStatus" NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "purchased_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_blocks" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "during" daterange GENERATED ALWAYS AS (daterange("start_date", "end_date", '[)')) STORED,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "note" TEXT,
    "rental_amount" INTEGER NOT NULL,
    "addons_amount" INTEGER NOT NULL,
    "deposit_amount" INTEGER NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "picked_up_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "rejected_reason" TEXT,
    "cancelled_reason" TEXT,
    "setup_plan_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_units" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "price_per_day" INTEGER NOT NULL,
    "rental_amount" INTEGER NOT NULL,
    "deposit_amount" INTEGER NOT NULL,
    "during" daterange GENERATED ALWAYS AS (daterange("start_date", "end_date", '[)')) STORED,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_addons" (
    "booking_id" TEXT NOT NULL,
    "film_product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_addons_pkey" PRIMARY KEY ("booking_id","film_product_id")
);

-- CreateTable
CREATE TABLE "booking_status_logs" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "from_status" "BookingStatus",
    "to_status" "BookingStatus" NOT NULL,
    "actor_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_status_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handover_records" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "kind" "HandoverKind" NOT NULL,
    "checklist" JSONB NOT NULL,
    "condition_notes" TEXT,
    "photo_paths" TEXT[],
    "id_checked" BOOLEAN NOT NULL DEFAULT false,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handover_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_records" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "type" "PaymentType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "note" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_slug_key" ON "branches"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "rental_models_slug_key" ON "rental_models"("slug");

-- CreateIndex
CREATE INDEX "rental_models_is_active_category_id_idx" ON "rental_models"("is_active", "category_id");

-- CreateIndex
CREATE INDEX "rental_models_brand_id_idx" ON "rental_models"("brand_id");

-- CreateIndex
CREATE INDEX "rental_models_price_per_day_idx" ON "rental_models"("price_per_day");

-- CreateIndex
CREATE INDEX "rental_model_images_model_id_sort_order_idx" ON "rental_model_images"("model_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "rental_units_serial_number_key" ON "rental_units"("serial_number");

-- CreateIndex
CREATE INDEX "rental_units_model_id_branch_id_status_idx" ON "rental_units"("model_id", "branch_id", "status");

-- CreateIndex
CREATE INDEX "unit_blocks_unit_id_idx" ON "unit_blocks"("unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_code_key" ON "bookings"("code");

-- CreateIndex
CREATE INDEX "bookings_user_id_status_idx" ON "bookings"("user_id", "status");

-- CreateIndex
CREATE INDEX "bookings_branch_id_status_start_date_idx" ON "bookings"("branch_id", "status", "start_date");

-- CreateIndex
CREATE INDEX "booking_units_booking_id_idx" ON "booking_units"("booking_id");

-- CreateIndex
CREATE INDEX "booking_units_unit_id_idx" ON "booking_units"("unit_id");

-- CreateIndex
CREATE INDEX "booking_status_logs_booking_id_idx" ON "booking_status_logs"("booking_id");

-- CreateIndex
CREATE INDEX "handover_records_booking_id_idx" ON "handover_records"("booking_id");

-- CreateIndex
CREATE INDEX "payment_records_booking_id_idx" ON "payment_records"("booking_id");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_models" ADD CONSTRAINT "rental_models_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_models" ADD CONSTRAINT "rental_models_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_model_images" ADD CONSTRAINT "rental_model_images_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "rental_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_model_specs" ADD CONSTRAINT "rental_model_specs_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "rental_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "rental_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_units" ADD CONSTRAINT "rental_units_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "rental_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_units" ADD CONSTRAINT "rental_units_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_blocks" ADD CONSTRAINT "unit_blocks_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "rental_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_units" ADD CONSTRAINT "booking_units_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_units" ADD CONSTRAINT "booking_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "rental_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_units" ADD CONSTRAINT "booking_units_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "rental_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_addons" ADD CONSTRAINT "booking_addons_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_addons" ADD CONSTRAINT "booking_addons_film_product_id_fkey" FOREIGN KEY ("film_product_id") REFERENCES "film_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_logs" ADD CONSTRAINT "booking_status_logs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_records" ADD CONSTRAINT "handover_records_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- GiST Exclusion Constraint to prevent overlapping active unit bookings
ALTER TABLE "booking_units"
  ADD CONSTRAINT "booking_units_no_overlap"
  EXCLUDE USING gist ("unit_id" WITH =, "during" WITH &&) WHERE ("active");

CREATE INDEX "unit_blocks_during_gist_idx"
  ON "unit_blocks" USING gist ("unit_id", "during");

-- Enable Row Level Security (RLS) on all new tables
ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rental_models" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rental_model_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rental_model_specs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "film_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "favorites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rental_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "unit_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_addons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_status_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "handover_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_records" ENABLE ROW LEVEL SECURITY;
