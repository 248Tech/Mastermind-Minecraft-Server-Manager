import { PrismaService } from '../prisma.service';

/**
 * Reconcile an early name-only record once a stable ID (UUID/Steam) is known.
 * Ambiguous display names are deliberately left untouched.
 */
export async function reconcileNameFallback(
  prisma: PrismaService,
  serverInstanceId: string,
  identityKey: string,
  name: string,
  steamId: string | null,
) {
  if (identityKey.startsWith('name:')) return;
  const fallbackKey = `name:${name.toLowerCase()}`;
  const fallback = await prisma.player.findUnique({
    where: { serverInstanceId_identityKey: { serverInstanceId, identityKey: fallbackKey } },
  });
  if (!fallback) return;

  // Resolve by the unique identity first. A stale or differently-cased stored
  // name must not make us miss the canonical row and collide while promoting.
  const canonical = await prisma.player.findUnique({
    where: { serverInstanceId_identityKey: { serverInstanceId, identityKey } },
  });

  if (!canonical) {
    await prisma.player.update({
      where: { id: fallback.id },
      data: { identityKey, steamId },
    });
    return;
  }

  const online = canonical.online || fallback.online;
  const sessionStarts = [canonical.currentSessionStartedAt, fallback.currentSessionStartedAt].filter((value): value is Date => Boolean(value));
  await prisma.$transaction([
    prisma.playerSession.updateMany({ where: { playerId: fallback.id }, data: { playerId: canonical.id } }),
    prisma.player.update({
      where: { id: canonical.id },
      data: {
        steamId: steamId ?? canonical.steamId,
        lifetimeSeconds: { increment: fallback.lifetimeSeconds },
        firstSeenAt: fallback.firstSeenAt < canonical.firstSeenAt ? fallback.firstSeenAt : canonical.firstSeenAt,
        lastSeenAt: fallback.lastSeenAt > canonical.lastSeenAt ? fallback.lastSeenAt : canonical.lastSeenAt,
        online,
        currentSessionStartedAt: online && sessionStarts.length ? new Date(Math.min(...sessionStarts.map(value => value.getTime()))) : null,
      },
    }),
    prisma.player.delete({ where: { id: fallback.id } }),
  ]);
}
