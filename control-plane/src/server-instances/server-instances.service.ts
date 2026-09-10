import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreateServerInstanceDto } from './dto/create-server-instance.dto';
import { UpdateServerInstanceDto } from './dto/update-server-instance.dto';

const GAME_TYPE_SLUG_MINECRAFT = 'minecraft';

@Injectable()
export class ServerInstancesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve game type id from slug (e.g. minecraft). */
  private async getGameTypeIdBySlug(slug: string): Promise<string> {
    const gt = await this.prisma.gameType.findFirst({
      where: { slug: slug.toLowerCase() },
    });
    if (!gt) {
      throw new BadRequestException(
        `Game type "${slug}" is not registered. Seed game_types with slug "${slug}".`,
      );
    }
    return gt.id;
  }

  private async getMinecraftGameTypeId(): Promise<string> {
    return this.getGameTypeIdBySlug(GAME_TYPE_SLUG_MINECRAFT);
  }

  /** Resolve host belongs to org (single-host MVP). */
  private async assertHostInOrg(hostId: string, orgId: string): Promise<void> {
    const host = await this.prisma.host.findFirst({
      where: { id: hostId, orgId },
    });
    if (!host) {
      throw new BadRequestException('Host not found or does not belong to this org');
    }
  }

  async findAll(orgId: string) {
    const list = await this.prisma.serverInstance.findMany({
      where: { orgId },
      include: { host: true, gameType: { select: { slug: true, capabilities: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return list.map((row) => this.toResponse(row, false));
  }

  async findOne(orgId: string, id: string, includePassword = false) {
    const row = await this.prisma.serverInstance.findFirst({
      where: { id, orgId },
      include: { host: true, gameType: { select: { slug: true, capabilities: true } } },
    });
    if (!row) {
      throw new NotFoundException('Server instance not found');
    }
    return this.toResponse(row, includePassword);
  }

  async create(
    orgId: string,
    userId: string,
    dto: CreateServerInstanceDto,
    clientIp?: string,
  ) {
    await this.assertHostInOrg(dto.hostId, orgId);
    const gameTypeId = await this.getGameTypeIdBySlug(dto.gameType);

    const created = await this.prisma.serverInstance.create({
      data: {
        orgId,
        hostId: dto.hostId,
        gameTypeId,
        name: dto.name.trim(),
        installPath: dto.installPath?.trim() || null,
        startCommand: dto.startCommand?.trim() || null,
        telnetHost: dto.telnetHost?.trim() || null,
        telnetPort: dto.telnetPort ?? null,
        telnetPassword: dto.telnetPassword ?? null,
        mapEmbedUrl: dto.mapEmbedUrl?.trim() || null,
      },
      include: { host: true, gameType: { select: { slug: true, capabilities: true } } },
    });

    await this.audit(orgId, userId, 'create', created.id, {
      name: created.name,
      hostId: created.hostId,
      gameType: created.gameType?.slug ?? dto.gameType,
    }, clientIp);

    return this.toResponse(created, true);
  }

  async upsertDiscoveredMinecraftInstance(
    hostId: string,
    dto: {
      name?: string;
      installPath?: string;
      startCommand?: string;
      telnetHost?: string;
      telnetPort?: number;
      telnetPassword?: string;
      config?: Record<string, unknown>;
    },
  ) {
    const host = await this.prisma.host.findUnique({
      where: { id: hostId },
      select: { id: true, orgId: true, name: true },
    });
    if (!host) {
      throw new NotFoundException('Host not found');
    }

    const gameTypeId = await this.getMinecraftGameTypeId();
    const existingList = await this.prisma.serverInstance.findMany({
      where: { orgId: host.orgId, hostId, gameTypeId },
      orderBy: { createdAt: 'asc' },
    });

    const installPath = dto.installPath?.trim() || null;
    const existing = this.findMatchingDiscoveredInstance(existingList, installPath)
      ?? (existingList.length === 1 ? existingList[0] : null);

    const discoveryConfig = this.mergeConfig(existing?.config, dto.config);
    const discoveredManaged = this.isDiscoveredManaged(existing?.config);

    if (!existing) {
      const created = await this.prisma.serverInstance.create({
        data: {
          orgId: host.orgId,
          hostId,
          gameTypeId,
          name: dto.name?.trim() || `${host.name} Minecraft`,
          installPath,
          startCommand: dto.startCommand?.trim() || null,
          telnetHost: dto.telnetHost?.trim() || '127.0.0.1',
          telnetPort: dto.telnetPort ?? 25575,
          telnetPassword: dto.telnetPassword ?? null,
          mapEmbedUrl: this.mapEmbedHint(discoveryConfig),
          config: discoveryConfig as Prisma.InputJsonValue,
        },
      });
      return { created: true, serverInstanceId: created.id };
    }

    const hint = this.mapEmbedHint(discoveryConfig);
    await this.prisma.serverInstance.update({
      where: { id: existing.id },
      data: {
        ...(installPath && { installPath }),
        ...(dto.startCommand?.trim() && (discoveredManaged || !existing.startCommand) && {
          startCommand: dto.startCommand.trim(),
        }),
        ...(dto.telnetHost?.trim() && (discoveredManaged || !existing.telnetHost) && {
          telnetHost: dto.telnetHost.trim(),
        }),
        ...(dto.telnetPort !== undefined && (discoveredManaged || existing.telnetPort == null) && {
          telnetPort: dto.telnetPort,
        }),
        ...(dto.telnetPassword !== undefined && (discoveredManaged || !existing.telnetPassword) && {
          telnetPassword: dto.telnetPassword || null,
        }),
        ...(dto.name?.trim() && discoveredManaged && { name: dto.name.trim() }),
        ...(!existing.mapEmbedUrl && hint ? { mapEmbedUrl: hint } : {}),
        config: discoveryConfig as Prisma.InputJsonValue,
      },
    });

    return { created: false, serverInstanceId: existing.id };
  }

  private mapEmbedHint(config: Record<string, unknown> | null | undefined): string | null {
    const hint = config?.map_embed_hint;
    return typeof hint === 'string' && hint.trim() ? hint.trim() : null;
  }

  async update(
    orgId: string,
    userId: string,
    id: string,
    dto: UpdateServerInstanceDto,
    clientIp?: string,
  ) {
    const existing = await this.prisma.serverInstance.findFirst({
      where: { id, orgId },
    });
    if (!existing) {
      throw new NotFoundException('Server instance not found');
    }
    if (dto.hostId !== undefined) {
      await this.assertHostInOrg(dto.hostId, orgId);
    }

    const gameTypeId = dto.gameType ? await this.getGameTypeIdBySlug(dto.gameType) : undefined;
    let nextConfig: Prisma.InputJsonValue | undefined;
    if (dto.updateCommand !== undefined) {
      const current =
        existing.config && typeof existing.config === 'object' && !Array.isArray(existing.config)
          ? { ...(existing.config as Record<string, unknown>) }
          : {};
      const cmd = dto.updateCommand?.trim() || '';
      if (cmd) current.update_command = cmd;
      else delete current.update_command;
      nextConfig = current as Prisma.InputJsonValue;
    }
    const updated = await this.prisma.serverInstance.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.hostId !== undefined && { hostId: dto.hostId }),
        ...(gameTypeId && { gameTypeId }),
        ...(dto.installPath !== undefined && { installPath: dto.installPath?.trim() || null }),
        ...(dto.startCommand !== undefined && { startCommand: dto.startCommand?.trim() || null }),
        ...(dto.telnetHost !== undefined && { telnetHost: dto.telnetHost?.trim() || null }),
        ...(dto.telnetPort !== undefined && { telnetPort: dto.telnetPort ?? null }),
        ...(dto.telnetPassword !== undefined && { telnetPassword: dto.telnetPassword ?? null }),
        ...(dto.rebootIfDown !== undefined && { rebootIfDown: dto.rebootIfDown }),
        ...(dto.mapEmbedUrl !== undefined && { mapEmbedUrl: dto.mapEmbedUrl?.trim() || null }),
        ...(nextConfig !== undefined && { config: nextConfig }),
      },
      include: { host: true, gameType: { select: { slug: true, capabilities: true } } },
    });

    await this.audit(orgId, userId, 'update', id, {
      updated: Object.keys(dto).filter((k) => k !== 'telnetPassword'),
    }, clientIp);

    return this.toResponse(updated, true);
  }

  async remove(orgId: string, userId: string, id: string, clientIp?: string) {
    const existing = await this.prisma.serverInstance.findFirst({
      where: { id, orgId },
    });
    if (!existing) {
      throw new NotFoundException('Server instance not found');
    }

    await this.prisma.serverInstance.delete({ where: { id } });
    await this.audit(orgId, userId, 'delete', id, { name: existing.name }, clientIp);
    return { deleted: true, id };
  }

  private toResponse(
    row: {
      id: string;
      orgId: string;
      hostId: string;
      gameTypeId: string;
      name: string;
      installPath: string | null;
      startCommand: string | null;
      telnetHost: string | null;
      telnetPort: number | null;
      telnetPassword: string | null;
      maintenanceMode?: boolean;
      rebootIfDown?: boolean;
      mapEmbedUrl?: string | null;
      config?: Prisma.JsonValue | null;
      createdAt: Date;
      updatedAt: Date;
      gameType?: { slug: string; capabilities: unknown };
    },
    includePassword: boolean,
  ) {
    const capabilities = Array.isArray(row.gameType?.capabilities)
      ? (row.gameType.capabilities as string[])
      : [];
    const cfg =
      row.config && typeof row.config === 'object' && !Array.isArray(row.config)
        ? (row.config as Record<string, unknown>)
        : {};
    const out: Record<string, unknown> = {
      id: row.id,
      orgId: row.orgId,
      hostId: row.hostId,
      gameTypeId: row.gameTypeId,
      gameType: row.gameType?.slug ?? 'minecraft',
      capabilities,
      name: row.name,
      installPath: row.installPath,
      startCommand: row.startCommand,
      updateCommand: typeof cfg.update_command === 'string' ? cfg.update_command : null,
      telnetHost: row.telnetHost,
      telnetPort: row.telnetPort,
      maintenanceMode: Boolean((row as { maintenanceMode?: boolean }).maintenanceMode),
      rebootIfDown: Boolean((row as { rebootIfDown?: boolean }).rebootIfDown),
      mapEmbedUrl: row.mapEmbedUrl ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    if (includePassword) {
      out.telnetPassword = row.telnetPassword;
    }
    return out;
  }

  private findMatchingDiscoveredInstance(
    rows: Array<{
      id: string;
      installPath: string | null;
      config: Prisma.JsonValue | null;
      startCommand: string | null;
      telnetHost: string | null;
      telnetPort: number | null;
      telnetPassword: string | null;
      mapEmbedUrl?: string | null;
    }>,
    installPath: string | null,
  ) {
    if (!installPath) return null;
    const normalizedTarget = this.normalizePath(installPath);
    return rows.find((row) => this.normalizePath(row.installPath) === normalizedTarget) ?? null;
  }

  private normalizePath(path?: string | null): string {
    return (path ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }

  private mergeConfig(existing: Prisma.JsonValue | null | undefined, incoming?: Record<string, unknown>) {
    const base = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
    const baseDiscovery = base['discovery'];
    const incomingDiscovery = incoming?.discovery;
    if (!incoming) return base;
    return {
      ...base,
      ...incoming,
      discovery: {
        ...(baseDiscovery && typeof baseDiscovery === 'object' && !Array.isArray(baseDiscovery)
          ? (baseDiscovery as Record<string, unknown>)
          : {}),
        ...(incomingDiscovery && typeof incomingDiscovery === 'object' && !Array.isArray(incomingDiscovery)
          ? (incomingDiscovery as Record<string, unknown>)
          : {}),
      },
    };
  }

  private isDiscoveredManaged(config: Prisma.JsonValue | null | undefined): boolean {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
    const discovery = (config as Record<string, unknown>).discovery;
    if (!discovery || typeof discovery !== 'object' || Array.isArray(discovery)) return false;
    return Boolean((discovery as Record<string, unknown>).managedByAgent);
  }

  private async audit(
    orgId: string,
    actorId: string,
    action: string,
    resourceId: string,
    details: Record<string, unknown>,
    ip?: string,
  ) {
    await this.prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        action,
        resourceType: 'server_instance',
        resourceId,
        details: details as Prisma.InputJsonValue,
        ip,
      },
    });
  }
}
