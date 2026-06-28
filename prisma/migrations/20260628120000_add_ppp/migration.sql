-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'BARTENDER';

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "VatCategory" AS ENUM ('ZERO', 'LOW', 'STANDARD');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "vatCategory" "VatCategory" NOT NULL DEFAULT 'LOW';

-- CreateTable
CREATE TABLE "PppProductCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PppProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PppProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "vatCategory" "VatCategory" NOT NULL DEFAULT 'LOW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "congressusProductId" INTEGER,
    "congressusProductOfferId" INTEGER,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "PppProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PppActivity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ActivityStatus" NOT NULL DEFAULT 'OPEN',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PppActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PppInvoice" (
    "id" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'CONFIRMED',
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exportedAt" TIMESTAMP(3),
    "congressusInvoiceId" INTEGER,
    "memberId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,

    CONSTRAINT "PppInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PppInvoiceLine" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCents" INTEGER NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "PppInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PppProductCategory_name_key" ON "PppProductCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PppProduct_congressusProductId_key" ON "PppProduct"("congressusProductId");

-- CreateIndex
CREATE UNIQUE INDEX "PppProduct_congressusProductOfferId_key" ON "PppProduct"("congressusProductOfferId");

-- AddForeignKey
ALTER TABLE "PppProduct" ADD CONSTRAINT "PppProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PppProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PppInvoice" ADD CONSTRAINT "PppInvoice_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PppInvoice" ADD CONSTRAINT "PppInvoice_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "PppActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PppInvoiceLine" ADD CONSTRAINT "PppInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PppInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PppInvoiceLine" ADD CONSTRAINT "PppInvoiceLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PppProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
