CREATE TYPE "ManualPaymentStatus" AS ENUM ('UNPAID', 'PENDING_VERIFICATION', 'REJECTED', 'PAID');
CREATE TYPE "PaymentProofStatus" AS ENUM ('PENDING', 'REJECTED', 'APPROVED');

ALTER TABLE "contact_settings"
  ADD COLUMN "payment_bank_name" TEXT,
  ADD COLUMN "payment_account_number" TEXT,
  ADD COLUMN "payment_account_name" TEXT,
  ADD COLUMN "payment_qr_path" TEXT,
  ADD COLUMN "payment_instructions" TEXT,
  ADD COLUMN "payment_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "manual_payments" (
  "id" TEXT NOT NULL,
  "booking_id" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "status" "ManualPaymentStatus" NOT NULL DEFAULT 'UNPAID',
  "confirmed_by" TEXT,
  "confirmed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "manual_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_proofs" (
  "id" TEXT NOT NULL,
  "payment_id" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "status" "PaymentProofStatus" NOT NULL DEFAULT 'PENDING',
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "rejection_reason" TEXT,
  CONSTRAINT "payment_proofs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "manual_payments_booking_id_key" ON "manual_payments"("booking_id");
CREATE INDEX "manual_payments_status_created_at_idx" ON "manual_payments"("status", "created_at");
CREATE INDEX "payment_proofs_payment_id_submitted_at_idx" ON "payment_proofs"("payment_id", "submitted_at");

ALTER TABLE "manual_payments" ADD CONSTRAINT "manual_payments_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "manual_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "manual_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_proofs" ENABLE ROW LEVEL SECURITY;
