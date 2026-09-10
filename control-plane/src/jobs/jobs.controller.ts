import { BadRequestException, Controller, Get, Post, Body, Param, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma.service';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import type { RequestWithUser } from '../server-instances/guards/jwt-auth.guard';
import { RequireOrgRoleGuard, RequireOrgRoles } from '../server-instances/guards/require-org-role.guard';

@Controller('api/orgs/:orgId/jobs')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class JobsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobsService: JobsService,
  ) {}

  @Post('mod-recommend')
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator', 'viewer')
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1, fileSize: 256 * 1024 * 1024 } }))
  async recommendMod(
    @Param('orgId') orgId: string,
    @Req() req: RequestWithUser,
    @Body('serverInstanceId') serverInstanceId: string,
    @UploadedFile() file?: { originalname: string; size: number; buffer: Buffer },
  ) {
    return this.stageModUpload(orgId, req.user!.id, serverInstanceId, file, 'MOD_UPLOAD_PENDING');
  }

  @Post('mod-upload')
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator')
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1, fileSize: 256 * 1024 * 1024 } }))
  async uploadMod(
    @Param('orgId') orgId: string,
    @Req() req: RequestWithUser,
    @Body('serverInstanceId') serverInstanceId: string,
    @Body('overrideActive') overrideActive?: string,
    @Body('transferConfig') transferConfigRaw?: string,
    @UploadedFile() file?: { originalname: string; size: number; buffer: Buffer },
  ) {
    const override = overrideActive === 'true' || overrideActive === '1';
    const transferConfig = (transferConfigRaw === 'true' || transferConfigRaw === '1') && override;
    return this.stageModUpload(orgId, req.user!.id, serverInstanceId, file, 'MOD_UPLOAD_QUARANTINE', override, transferConfig);
  }

  private async stageModUpload(
    orgId: string,
    userId: string,
    serverInstanceId: string,
    file: { originalname: string; size: number; buffer: Buffer } | undefined,
    jobType: 'MOD_UPLOAD_QUARANTINE' | 'MOD_UPLOAD_PENDING',
    overrideActive = false,
    transferConfig = false,
  ) {
    if (!serverInstanceId) throw new BadRequestException('Server instance is required');
    if (!file?.buffer?.length) throw new BadRequestException('Choose a non-empty ZIP archive');
    if (!/\.zip$/i.test(file.originalname || '')) throw new BadRequestException('Only .zip mod archives are supported');
    const signature = file.buffer.subarray(0, 4).toString('hex');
    if (!['504b0304', '504b0506', '504b0708'].includes(signature)) {
      throw new BadRequestException('The uploaded file is not a valid ZIP archive');
    }
    const uploadId = randomUUID();
    const root = process.env.MOD_UPLOAD_DIR || '/var/lib/mastermind/uploads';
    await mkdir(root, { recursive: true, mode: 0o700 });
    const stagedPath = join(root, `${uploadId}.zip`);
    await writeFile(stagedPath, file.buffer, { mode: 0o600, flag: 'wx' });
    try {
      return await this.jobsService.createJob(
        orgId,
        userId,
        serverInstanceId,
        jobType,
        { uploadId, originalName: file.originalname, sizeBytes: file.size, ...(jobType === 'MOD_UPLOAD_QUARANTINE' && overrideActive ? { overrideActive: true } : {}), ...(jobType === 'MOD_UPLOAD_QUARANTINE' && transferConfig ? { transferConfig: true } : {}) },
      );
    } catch (error) {
      await unlink(stagedPath).catch(() => undefined);
      throw error;
    }
  }

  @Get('runs/:runId')
  async getRun(@Param('orgId') orgId:string,@Param('runId') runId:string) {
    const run=await this.prisma.jobRun.findFirst({where:{id:runId,job:{orgId}},select:{id:true,status:true,startedAt:true,finishedAt:true,result:true}});
    if(!run)return null;
    return {...run,startedAt:run.startedAt?.toISOString()??null,finishedAt:run.finishedAt?.toISOString()??null};
  }

  /** Create and enqueue a new job for a server instance. */
  @Post()
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator', 'viewer')
  async create(
    @Param('orgId') orgId: string,
    @Req() req: RequestWithUser,
    @Body() dto: CreateJobDto,
  ) {
    const userId = req.user!.id;
    return this.jobsService.createJob(
      orgId,
      userId,
      dto.serverInstanceId,
      dto.type,
      dto.payload,
    );
  }

  /** List jobs (org-scoped, with latest JobRun). */
  @Get()
  async list(
    @Param('orgId') orgId: string,
    @Query('limit') limit?: string,
    @Query('serverInstanceId') serverInstanceId?: string,
  ) {
    const take = limit ? Math.min(100, parseInt(limit, 10) || 20) : 20;
    const jobs = await this.prisma.job.findMany({
      where: { orgId, NOT: { OR: [{ type: 'PLAYER_LIST_SYNC' }, { type: 'ITEM_CATALOG' }, { type: 'TRIGGER_GRANT_ITEMS' }, { type: 'RCON', payload: { path: ['purpose'], equals: 'shop_grant' } }] }, ...(serverInstanceId ? { serverInstanceId } : {}) },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        serverInstance: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        jobRuns: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    return jobs.map((j) => ({
      id: j.id,
      orgId: j.orgId,
      batchId: j.batchId,
      serverInstanceId: j.serverInstanceId,
      serverName: j.serverInstance?.name,
      type: j.type,
      payload: j.payload,
      createdAt: j.createdAt.toISOString(),
      startedBy: j.createdBy ? {
        id: j.createdBy.id,
        name: j.createdBy.name || j.createdBy.email,
        email: j.createdBy.email,
      } : null,
      latestRun: j.jobRuns[0]
        ? {
            id: j.jobRuns[0].id,
            status: j.jobRuns[0].status === 'running'
              && (j.jobRuns[0].result as Record<string, unknown> | null)?.phase === 'queued'
              ? 'queued'
              : j.jobRuns[0].status,
            startedAt: j.jobRuns[0].startedAt?.toISOString() ?? null,
            finishedAt: j.jobRuns[0].finishedAt?.toISOString() ?? null,
            result: j.jobRuns[0].result,
          }
        : null,
    }));
  }
}
