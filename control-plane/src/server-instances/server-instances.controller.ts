import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ServerInstancesService } from './server-instances.service';
import { CreateServerInstanceDto } from './dto/create-server-instance.dto';
import { UpdateServerInstanceDto } from './dto/update-server-instance.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OrgMemberGuard } from './guards/org-member.guard';
import { RequireOrgRoleGuard, RequireOrgRoles } from './guards/require-org-role.guard';
import { RequestWithOrgRole } from './guards/org-member.guard';

@Controller('api/orgs/:orgId/server-instances')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class ServerInstancesController {
  constructor(private readonly service: ServerInstancesService) {}

  /** List all server instances in the org. Viewer can read. */
  @Get()
  async findAll(@Param('orgId') orgId: string) {
    return this.service.findAll(orgId);
  }

  /** Get one; include rconPassword for editing. Viewer can read. */
  @Get(':id')
  async findOne(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.service.findOne(orgId, id, true);
  }

  /** Create. Admin or Operator only. */
  @Post()
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator')
  async create(
    @Param('orgId') orgId: string,
    @Body() dto: CreateServerInstanceDto,
    @Req() req: RequestWithOrgRole & { user: { id: string }; ip?: string; headers?: { 'x-forwarded-for'?: string } },
  ) {
    const ip = (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    return this.service.create(orgId, req.user.id, dto, ip);
  }

  /** Update. Admin or Operator only. */
  @Patch(':id')
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator')
  async update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateServerInstanceDto,
    @Req() req: RequestWithOrgRole & { user: { id: string }; ip?: string; headers?: { 'x-forwarded-for'?: string } },
  ) {
    const ip = (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    return this.service.update(orgId, req.user.id, id, dto, ip);
  }

  /** Delete. Admin or Operator only. */
  @Delete(':id')
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator')
  async remove(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Req() req: RequestWithOrgRole & { user: { id: string }; ip?: string; headers?: { 'x-forwarded-for'?: string } },
  ) {
    const ip = (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    return this.service.remove(orgId, req.user.id, id, ip);
  }
}
