# Manual bank transfer payments

Create two Supabase Storage buckets before enabling payments:

- `payment-assets`: public, JPG/PNG, 5 MB maximum. Stores the shop's fixed QR image.
- `payment-proofs`: private, JPG/PNG, 5 MB maximum. Stores renter transaction screenshots. Read access is issued through short lived signed URLs after API authorization.

Set `STORAGE_BUCKET_PAYMENT_ASSETS` and `STORAGE_BUCKET_PAYMENT_PROOFS` if the bucket names differ from these defaults. Keep the Supabase service role key on the backend only.

After deploying the migration, sign in as an Admin and open **Admin → Thanh toán chuyển khoản**. Enter the bank name, account number, account holder, upload the shop QR, add transfer instructions, then enable and save payment. The transfer content is generated from the persisted booking code as `THANHTOAN BORROLL {booking code}`.

Renter proofs are limited to JPG/PNG and 5 MB, scoped to the renter and booking, and stored as a history of submissions. Staff must compare the screenshot with the bank transaction before confirming; approval records the reviewer and time and moves a pending booking to `CONFIRMED` in the same database transaction. Rejection requires a reason and lets the renter submit a replacement.

Apply `prisma/migrations/20261114000000_add_manual_payments/migration.sql` through the project's normal reviewed deployment migration process. Do not use `prisma migrate dev` against hosted Supabase.
