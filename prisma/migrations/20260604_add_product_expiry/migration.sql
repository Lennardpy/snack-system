-- Best-before date for products. In the final 7 days before this date (and
-- after it) the product is sold at 50% off. NULL = no expiry, never discounted.
ALTER TABLE "Product" ADD COLUMN "expiresAt" TIMESTAMP(3);
