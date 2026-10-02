-- CreateTable
CREATE TABLE "SbzPriceList" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SbzPriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SbzPrice" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "vatRate" INTEGER NOT NULL,
    "costExclCents" INTEGER NOT NULL,
    "costInclCents" INTEGER NOT NULL,
    "onRequest" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "listId" TEXT NOT NULL,

    CONSTRAINT "SbzPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SbzPriceList_validFrom_key" ON "SbzPriceList"("validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "SbzPrice_listId_key_key" ON "SbzPrice"("listId", "key");

-- AddForeignKey
ALTER TABLE "SbzPrice" ADD CONSTRAINT "SbzPrice_listId_fkey" FOREIGN KEY ("listId") REFERENCES "SbzPriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: the price list used so far (SBZ, April 2026) as the base version, valid
-- for all earlier borrels. New lists are added from the admin SBZ page.
INSERT INTO "SbzPriceList" ("id", "label", "validFrom", "source") VALUES ('sbz-initial', 'SBZ price list (April 2026)', '2000-01-01T00:00:00.000Z', 'initial');
INSERT INTO "SbzPrice" ("id", "listId", "key", "name", "section", "unit", "vatRate", "costExclCents", "costInclCents", "onRequest", "sortOrder") VALUES
  ('sbz-initial-premium-pilsner', 'sbz-initial', 'premium-pilsner', 'Grolsch Premium Pilsner (keg)', 'Beer', 'LITER', 21, 182, 220, false, 0),
  ('sbz-initial-weizen-keg', 'sbz-initial', 'weizen-keg', 'Grolsch Weizen (keg)', 'Beer', 'LITER', 21, 410, 496, false, 1),
  ('sbz-initial-herfstbok-keg', 'sbz-initial', 'herfstbok-keg', 'Grolsch Herfstbok (keg)', 'Beer', 'LITER', 21, 460, 557, false, 2),
  ('sbz-initial-lentebok-keg', 'sbz-initial', 'lentebok-keg', 'Grolsch Lentebok (keg)', 'Beer', 'LITER', 21, 460, 557, false, 3),
  ('sbz-initial-zomerzon-keg', 'sbz-initial', 'zomerzon-keg', 'Grolsch Zomerzon (keg)', 'Beer', 'LITER', 21, 460, 557, false, 4),
  ('sbz-initial-rose-keg', 'sbz-initial', 'rose-keg', 'Grolsch Rosé (keg)', 'Beer', 'LITER', 21, 410, 496, false, 5),
  ('sbz-initial-radler-20', 'sbz-initial', 'radler-20', 'Grolsch Radler 2.0% (bottle)', 'Beer', 'UNIT', 21, 70, 85, false, 6),
  ('sbz-initial-radler-00', 'sbz-initial', 'radler-00', 'Grolsch Radler 0.0% (bottle)', 'Beer', 'UNIT', 9, 78, 85, false, 7),
  ('sbz-initial-grolsch-00', 'sbz-initial', 'grolsch-00', 'Grolsch 0.0% (bottle)', 'Beer', 'UNIT', 9, 78, 85, false, 8),
  ('sbz-initial-weizen-00', 'sbz-initial', 'weizen-00', 'Grolsch Weizen 0.0% (bottle)', 'Beer', 'UNIT', 9, 92, 100, false, 9),
  ('sbz-initial-zomertijd-00', 'sbz-initial', 'zomertijd-00', 'Grolsch Zomertijd 0.0% (bottle)', 'Beer', 'UNIT', 9, 92, 100, false, 10),
  ('sbz-initial-craft-beer', 'sbz-initial', 'craft-beer', 'Craft beer of the month (bottle)', 'Beer', 'UNIT', 21, 124, 150, false, 11),
  ('sbz-initial-grimbergen-dubbel', 'sbz-initial', 'grimbergen-dubbel', 'Grimbergen Dubbel (keg)', 'On request', 'LITER', 21, 460, 557, true, 12),
  ('sbz-initial-grimbergen-blanche', 'sbz-initial', 'grimbergen-blanche', 'Grimbergen Blanche (keg)', 'On request', 'LITER', 21, 460, 557, true, 13),
  ('sbz-initial-grimbergen-blond', 'sbz-initial', 'grimbergen-blond', 'Grimbergen Blond (keg)', 'On request', 'LITER', 21, 460, 557, true, 14),
  ('sbz-initial-grimbergen-tripel', 'sbz-initial', 'grimbergen-tripel', 'Grimbergen Tripel (keg)', 'On request', 'LITER', 21, 460, 557, true, 15),
  ('sbz-initial-cola-fanta-125', 'sbz-initial', 'cola-fanta-125', 'Cola/Fanta 1.5/1.25 L (bottle)', 'Soft drinks', 'UNIT', 9, 225, 245, false, 16),
  ('sbz-initial-fuze-tea-125', 'sbz-initial', 'fuze-tea-125', 'Fuze Tea 1.25 L (bottle)', 'Soft drinks', 'UNIT', 9, 245, 267, false, 17),
  ('sbz-initial-soft-drink-small', 'sbz-initial', 'soft-drink-small', 'Soft drink 0.20/0.25 L (bottle)', 'Soft drinks', 'UNIT', 9, 70, 76, false, 18),
  ('sbz-initial-apple-bandit', 'sbz-initial', 'apple-bandit', 'Apple Bandit (bottle)', 'Other', 'UNIT', 21, 129, 156, false, 19),
  ('sbz-initial-viper', 'sbz-initial', 'viper', 'Viper (can)', 'Other', 'UNIT', 21, 129, 156, false, 20),
  ('sbz-initial-wine-075', 'sbz-initial', 'wine-075', 'Wine 0.75 L (bottle)', 'Other', 'UNIT', 21, 490, 593, false, 21),
  ('sbz-initial-flugel-shots', 'sbz-initial', 'flugel-shots', 'Flügel shots (bottle)', 'Other', 'UNIT', 21, 70, 85, false, 22),
  ('sbz-initial-nozem-shots', 'sbz-initial', 'nozem-shots', 'Nozem shots (shot)', 'Other', 'UNIT', 21, 58, 70, false, 23),
  ('sbz-initial-shots', 'sbz-initial', 'shots', 'Shots (shot)', 'Other', 'UNIT', 21, 75, 91, false, 24);
