-- Link the Stress drinks to the products created for them in DIMENSIE's Congressus
-- (folder "PPP", id 9445, made on 2026-10-23 with Dimensie's API key), so
-- Dimensie's export can invoice its members' drinks at joint borrels. Product ids
-- are production's; on other databases (staging copy / local) only existing drinks
-- are linked. Offer ids resolved from the folder listing (the POST returns the
-- product entity id, not the offer id).
--   Grolsch Premium Pils: offer 125975
--   Grolsch Weizen 0.3: offer 125976
--   Grolsch Weizen 0.5: offer 125977
--   Grolsch Bok: offer 125978
--   Grolsch Rosé: offer 125979
--   Craft beer of the month: offer 125980
--   Soda (Big Bottle): offer 125981
--   Soda (Small Bottle): offer 125982
--   Fuze Tea (Large Bottle): offer 125983
--   Wine: offer 125984
--   Apple Bandit: offer 125985
--   Viper: offer 125986
--   Flügel (shots): offer 125987
--   Shots (35ml): offer 125988
--   Grolsch Radler 0.0%: offer 125989
--   Grolsch Radler 2.0%: offer 125990
--   Grolsch Weizen 0.0%: offer 125991
--   Grolsch Zomertijd 0.0%: offer 125992
--   Grolsch 0.0%: offer 125993

UPDATE "Association" SET "congressusPppFolderId" = 9445 WHERE "id" = 'dimensie';

INSERT INTO "PppProductOffer" ("id", "productId", "associationId", "offerId")
SELECT 'dimoffer_' || v.pid, v.pid, 'dimensie', v.offer
FROM (VALUES
  ('cmtmyhg7l00013m67ejipeomc', 125975),
  ('cmtmyhgaf00023m673h3bs520', 125976),
  ('cmtmyhgau00033m6768hyl0lr', 125977),
  ('cmtmyhgf000043m670rtum2ca', 125978),
  ('cmtmyhghn00053m67jqi1rpyx', 125979),
  ('cmtmyhgpm000j3m674ydr885g', 125980),
  ('cmtmyhgie00073m67jtkpzaea', 125981),
  ('cmtmyhgiq00083m67vw9qir75', 125982),
  ('cmtmyhgj500093m67d2trovck', 125983),
  ('cmtmyhgi100063m677qrvtbcx', 125984),
  ('cmtmyhglq000f3m67wak98794', 125985),
  ('cmtmyhgoi000g3m67gu25zzyw', 125986),
  ('cmtmyhgox000h3m67n2hv27g0', 125987),
  ('cmtmyhgp9000i3m678ee99g55', 125988),
  ('cmtmyhgji000a3m67yuyudm4z', 125989),
  ('cmtmyhgkd000b3m67t9283zmp', 125990),
  ('cmtmyhgkq000c3m677llx42lj', 125991),
  ('cmtmyhgl2000d3m674bljcwa9', 125992),
  ('cmtmyhgle000e3m67t56mevd7', 125993)
) AS v(pid, offer)
JOIN "PppProduct" p ON p."id" = v.pid
ON CONFLICT ("productId", "associationId") DO NOTHING;
