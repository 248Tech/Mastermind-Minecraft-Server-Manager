/**
 * Prisma seed script — run with: npx ts-node prisma/seed.ts
 * Idempotent via upsert. Seeds game types, default org, roles, and admin user.
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync } from 'crypto';

const prisma = new PrismaClient();

// ─── Password hashing (same as auth.service.ts) ───────────────────────────
function makePasswordHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

// ─── Seed data ─────────────────────────────────────────────────────────────

const GAME_TYPES = [
  {
    slug: 'minecraft',
    name: 'Minecraft',
    capabilities: [
      'start',
      'stop',
      'restart',
      'status',
      'send_command',
      'kick_player',
      'ban_player',
      'get_log_path',
      'install_mod',
      'stream_chat',
    ],
  },
];

const DEFAULT_ORG = { name: 'Default', slug: 'default' };

const ROLES = ['admin', 'operator', 'viewer'] as const;

const BOOTSTRAP_ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const BOOTSTRAP_ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const BOOTSTRAP_ADMIN_NAME = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Administrator';

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding game types...');
  for (const gt of GAME_TYPES) {
    await prisma.gameType.upsert({
      where: { slug: gt.slug },
      update: { name: gt.name, capabilities: gt.capabilities },
      create: { slug: gt.slug, name: gt.name, capabilities: gt.capabilities },
    });
    console.log(`  ✓ GameType: ${gt.slug}`);
  }

  console.log('Seeding default org...');
  const org = await prisma.org.upsert({
    where: { slug: DEFAULT_ORG.slug },
    // Preserve renamed orgs (e.g. Mercenary Gaming). Only create when missing.
    update: {},
    create: { name: DEFAULT_ORG.name, slug: DEFAULT_ORG.slug },
  });
  console.log(`  ✓ Org: ${org.slug} (${org.id})`);

  console.log('Seeding roles...');
  const roleMap: Record<string, { id: string; name: string }> = {};
  for (const roleName of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
    roleMap[roleName] = role;
    console.log(`  ✓ Role: ${roleName}`);
  }

  if (!BOOTSTRAP_ADMIN_EMAIL) {
    const existingAdminCount = await prisma.userOrg.count({ where: { roleId: roleMap['admin'].id } });
    if (existingAdminCount === 0) {
      throw new Error('BOOTSTRAP_ADMIN_EMAIL is required because no administrator account exists');
    }
    console.log('  ~ Existing administrator found; skipping bootstrap administrator');
    console.log('\nSeed complete.');
    return;
  }

  console.log('Seeding bootstrap admin user...');
  const existingUser = await prisma.user.findUnique({ where: { email: BOOTSTRAP_ADMIN_EMAIL } });

  let adminUser: { id: string };
  if (existingUser) {
    adminUser = existingUser.emailVerifiedAt && existingUser.approvedAt ? existingUser : await prisma.user.update({
      where: { id: existingUser.id },
      data: { emailVerifiedAt: existingUser.emailVerifiedAt || new Date(), approvedAt: existingUser.approvedAt || new Date() },
      select: { id: true },
    });
    console.log(`  ~ User already exists: ${BOOTSTRAP_ADMIN_EMAIL}`);
  } else {
    if (!BOOTSTRAP_ADMIN_PASSWORD || BOOTSTRAP_ADMIN_PASSWORD.length < 12) {
      throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters when creating the bootstrap administrator');
    }
    adminUser = await prisma.user.create({
      data: {
        email: BOOTSTRAP_ADMIN_EMAIL,
        name: BOOTSTRAP_ADMIN_NAME,
        passwordHash: makePasswordHash(BOOTSTRAP_ADMIN_PASSWORD),
        emailVerifiedAt: new Date(),
        approvedAt: new Date(),
      },
    });
    console.log(`  ✓ Created user: ${BOOTSTRAP_ADMIN_EMAIL}`);
  }

  // Ensure admin user is in the default org as admin
  const membership = await prisma.userOrg.findUnique({
    where: { userId_orgId: { userId: adminUser.id, orgId: org.id } },
  });

  if (!membership) {
    await prisma.userOrg.create({
      data: {
        userId: adminUser.id,
        orgId: org.id,
        roleId: roleMap['admin'].id,
      },
    });
    console.log(`  ✓ Added admin user to default org as admin`);
  } else {
    if (membership.roleId !== roleMap['admin'].id) {
      await prisma.userOrg.update({
        where: { userId_orgId: { userId: adminUser.id, orgId: org.id } },
        data: { roleId: roleMap['admin'].id },
      });
      console.log(`  ✓ Promoted bootstrap user to admin`);
    } else {
      console.log(`  ~ Admin user already in default org`);
    }
  }

  console.log('\nSeed complete.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
