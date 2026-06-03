import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // ── Admin user ────────────────────────────────────────────────────────────
  const email = process.env.ADMIN_EMAIL ?? "admin@snackbar.local";
  const password = process.env.ADMIN_PASSWORD ?? "changeme123";

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.log(`Admin user already exists: ${email}`);
  } else {
    await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 12),
        role: "ADMIN",
      },
    });
    console.log(`✓ Admin user created: ${email} / ${password}`);
  }

  // ── Seed product categories ───────────────────────────────────────────────
  const categories = [
    { name: "Snacks", sortOrder: 1 },
    { name: "Drinks", sortOrder: 2 },
    { name: "Other", sortOrder: 3 },
  ];

  for (const cat of categories) {
    await prisma.productCategory.upsert({
      where: { name: cat.name },
      create: cat,
      update: {},
    });
  }
  console.log(`✓ Product categories seeded`);

  // ── Sample products ───────────────────────────────────────────────────────
  const snacks = await prisma.productCategory.findFirst({ where: { name: "Snacks" } });
  const drinks = await prisma.productCategory.findFirst({ where: { name: "Drinks" } });

  const products = [
    { name: "Stroopwafel", price: 75, categoryId: snacks!.id, published: true },
    { name: "Mars", price: 100, categoryId: snacks!.id, published: true },
    { name: "Chips", price: 125, categoryId: snacks!.id, published: true },
    { name: "Cola", price: 100, categoryId: drinks!.id, published: true },
    { name: "Water", price: 75, categoryId: drinks!.id, published: true },
    { name: "Spa Rood", price: 75, categoryId: drinks!.id, published: true },
  ];

  for (const p of products) {
    const exists = await prisma.product.findFirst({ where: { name: p.name } });
    if (!exists) {
      await prisma.product.create({ data: p });
    }
  }
  console.log(`✓ Sample products seeded`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
