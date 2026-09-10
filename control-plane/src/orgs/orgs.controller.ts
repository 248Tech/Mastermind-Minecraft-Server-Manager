import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { OrgsService } from './orgs.service';
import { JwtAuthGuard, RequestWithUser } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { RequireOrgRoleGuard, RequireOrgRoles } from '../server-instances/guards/require-org-role.guard';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

class CreateOrgDto {
  name!: string;
  slug!: string;
}

class UpdateOrgDto {
  @IsOptional()
  @IsString()
  discordWebhookUrl?: string;
  @IsOptional()
  @IsString()
  frigateUrl?: string;
  @IsOptional()
  @IsString()
  frigateApiKey?: string;
  @IsOptional()
  @IsString()
  frigateWebhookSecret?: string;
  @IsOptional()
  @IsBoolean()
  stabilityRestartEnabled?: boolean;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(4)
  @Max(64)
  stabilityRestartMemoryGiB?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(1440)
  stabilityRestartCooldownMinutes?: number;
}

class CreateOrgAccountDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsIn(['operator', 'viewer'])
  role!: 'operator' | 'viewer';
}

class ResetOrgAccountPasswordDto {
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}
class SetOrgAccountApprovalDto {
  @IsBoolean()
  approved!: boolean;
}
class OpenAiSettingsDto{@IsOptional()@IsString()@MinLength(20)@MaxLength(256) apiKey?:string;@IsString()@MinLength(1)@MaxLength(100) model!:string;}
class KimiSettingsDto{@IsOptional()@IsString()@MinLength(10)@MaxLength(512) apiKey?:string;@IsString()@MinLength(1)@MaxLength(100) model!:string;}
class ModAiProviderDto{@IsIn(['codex','kimi']) provider!:'codex'|'kimi';}
class CloudflareSettingsDto{@IsString()@MinLength(20)@MaxLength(2048) apiToken!:string;}
class DigitalOceanSettingsDto{@IsString()@MinLength(20)@MaxLength(2048) apiToken!:string;}
class MailgunSettingsDto{@IsOptional()@IsString()@MinLength(10)@MaxLength(512) apiKey?:string;@IsString()@MinLength(3)@MaxLength(255) domain!:string;@IsEmail() fromEmail!:string;@IsIn(['us','eu']) region!:'us'|'eu';}
class StripeSettingsDto{@IsOptional()@IsString()@MinLength(20)@MaxLength(256) secretKey?:string;@IsOptional()@IsString()@MinLength(20)@MaxLength(256) webhookSecret?:string;}
class RecaptchaSettingsDto{@IsString()@MinLength(20)@MaxLength(256) siteKey!:string;@IsOptional()@IsString()@MinLength(10)@MaxLength(512) secretKey?:string;}
class MaintenancePasswordDto{@IsString()@MinLength(4)@MaxLength(32) password!:string;}

@Controller('api/orgs')
@UseGuards(JwtAuthGuard)
export class OrgsController {
  constructor(private readonly orgsService: OrgsService) {}

  @Post()
  async createOrg(@Body() dto: CreateOrgDto, @Req() req: RequestWithUser) {
    return this.orgsService.createOrg(dto.name, dto.slug, req.user!.id);
  }

  @Get()
  async getUserOrgs(@Req() req: RequestWithUser) {
    return this.orgsService.getUserOrgs(req.user!.id);
  }

  @Get(':orgId')
  @UseGuards(OrgMemberGuard)
  async getOrg(@Param('orgId') orgId: string, @Req() req: RequestWithUser) {
    return this.orgsService.getOrg(orgId, req.user!.id);
  }

  @Get(':orgId/accounts')
  @UseGuards(OrgMemberGuard, RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  async getAccounts(@Param('orgId') orgId: string) {
    return this.orgsService.getAccounts(orgId);
  }

  @Get(':orgId/integrations/profile-editor')
  @UseGuards(OrgMemberGuard)
  async getProfileEditorCredit(@Param('orgId') orgId: string) {
    return this.orgsService.getProfileEditorCredit(orgId);
  }

  @Post(':orgId/accounts')
  @UseGuards(OrgMemberGuard, RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  async createAccount(@Param('orgId') orgId: string, @Req() req: RequestWithUser, @Body() dto: CreateOrgAccountDto) {
    return this.orgsService.createAccount(orgId, req.user!.id, dto);
  }

  @Get(':orgId/security')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  getSecurity(@Param('orgId')orgId:string){return this.orgsService.getSecuritySettings(orgId);}

  @Post(':orgId/integrations/recaptcha')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  saveRecaptcha(@Param('orgId')orgId:string,@Req()req:RequestWithUser,@Body()dto:RecaptchaSettingsDto){return this.orgsService.saveRecaptchaSettings(orgId,req.user!.id,dto);}

  @Delete(':orgId/integrations/recaptcha')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  clearRecaptcha(@Param('orgId')orgId:string,@Req()req:RequestWithUser){return this.orgsService.clearRecaptchaSettings(orgId,req.user!.id);}

  @Patch(':orgId/accounts/:accountId/approval')
  @UseGuards(OrgMemberGuard, RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  async setAccountApproval(
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @Req() req: RequestWithUser,
    @Body() dto: SetOrgAccountApprovalDto,
  ) {
    return this.orgsService.setAccountApproval(orgId, accountId, req.user!.id, dto.approved);
  }

  @Delete(':orgId/accounts/:accountId')
  @UseGuards(OrgMemberGuard, RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  async deleteAccount(
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.orgsService.deleteAccount(orgId, accountId, req.user!.id);
  }

  @Patch(':orgId/accounts/:accountId/password')
  @UseGuards(OrgMemberGuard, RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  async resetAccountPassword(
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @Req() req: RequestWithUser,
    @Body() dto: ResetOrgAccountPasswordDto,
  ) {
    return this.orgsService.resetAccountPassword(orgId, accountId, req.user!.id, dto.newPassword);
  }

  @Patch(':orgId')
  @UseGuards(OrgMemberGuard, RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  async updateOrg(
    @Param('orgId') orgId: string,
    @Body() dto: UpdateOrgDto,
    @Req() req: RequestWithUser,
  ) {
    return this.orgsService.updateOrg(orgId, req.user!.id, dto);
  }

  @Post(':orgId/integrations/openai')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  saveOpenAi(@Param('orgId')orgId:string,@Req()req:RequestWithUser,@Body()dto:OpenAiSettingsDto){return this.orgsService.saveOpenAiSettings(orgId,req.user!.id,dto);}

  @Post(':orgId/integrations/openai/test')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  testOpenAi(@Param('orgId')orgId:string){return this.orgsService.testOpenAi(orgId);}

  @Delete(':orgId/integrations/openai')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  clearOpenAi(@Param('orgId')orgId:string){return this.orgsService.clearOpenAiSettings(orgId);}

  @Patch(':orgId/integrations/mod-ai/provider')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  selectModAiProvider(@Param('orgId')orgId:string,@Req()req:RequestWithUser,@Body()dto:ModAiProviderDto){return this.orgsService.selectModAiProvider(orgId,req.user!.id,dto.provider);}

  @Post(':orgId/integrations/kimi')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  saveKimi(@Param('orgId')orgId:string,@Req()req:RequestWithUser,@Body()dto:KimiSettingsDto){return this.orgsService.saveKimiSettings(orgId,req.user!.id,dto);}

  @Post(':orgId/integrations/kimi/test')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  testKimi(@Param('orgId')orgId:string){return this.orgsService.testKimi(orgId);}

  @Delete(':orgId/integrations/kimi')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  clearKimi(@Param('orgId')orgId:string){return this.orgsService.clearKimiSettings(orgId);}

  @Post(':orgId/integrations/cloudflare')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  saveCloudflare(@Param('orgId')orgId:string,@Req()req:RequestWithUser,@Body()dto:CloudflareSettingsDto){return this.orgsService.saveCloudflareSettings(orgId,req.user!.id,dto.apiToken);}

  @Delete(':orgId/integrations/cloudflare')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  clearCloudflare(@Param('orgId')orgId:string,@Req()req:RequestWithUser){return this.orgsService.clearCloudflareSettings(orgId,req.user!.id);}

  @Post(':orgId/integrations/digitalocean')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  saveDigitalOcean(@Param('orgId')orgId:string,@Req()req:RequestWithUser,@Body()dto:DigitalOceanSettingsDto){return this.orgsService.saveDigitalOceanSettings(orgId,req.user!.id,dto.apiToken);}

  @Post(':orgId/integrations/digitalocean/test')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  testDigitalOcean(@Param('orgId')orgId:string){return this.orgsService.testDigitalOcean(orgId);}

  @Delete(':orgId/integrations/digitalocean')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  clearDigitalOcean(@Param('orgId')orgId:string,@Req()req:RequestWithUser){return this.orgsService.clearDigitalOceanSettings(orgId,req.user!.id);}

  @Post(':orgId/integrations/mailgun')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  saveMailgun(@Param('orgId')orgId:string,@Req()req:RequestWithUser,@Body()dto:MailgunSettingsDto){return this.orgsService.saveMailgunSettings(orgId,req.user!.id,dto);}

  @Post(':orgId/integrations/mailgun/test')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  testMailgun(@Param('orgId')orgId:string,@Req()req:RequestWithUser){return this.orgsService.testMailgun(orgId,req.user!.id);}

  @Delete(':orgId/integrations/mailgun')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  clearMailgun(@Param('orgId')orgId:string,@Req()req:RequestWithUser){return this.orgsService.clearMailgunSettings(orgId,req.user!.id);}

  @Post(':orgId/integrations/stripe')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  saveStripe(@Param('orgId')orgId:string,@Req()req:RequestWithUser,@Body()dto:StripeSettingsDto){return this.orgsService.saveStripeSettings(orgId,req.user!.id,dto);}

  @Post(':orgId/integrations/stripe/test')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  testStripe(@Param('orgId')orgId:string){return this.orgsService.testStripe(orgId);}

  @Delete(':orgId/integrations/stripe')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  clearStripe(@Param('orgId')orgId:string,@Req()req:RequestWithUser){return this.orgsService.clearStripeSettings(orgId,req.user!.id);}

  @Post(':orgId/integrations/maintenance-password')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  saveMaintenancePassword(@Param('orgId')orgId:string,@Req()req:RequestWithUser,@Body()dto:MaintenancePasswordDto){
    return this.orgsService.saveMaintenancePassword(orgId,req.user!.id,dto.password);
  }

  @Delete(':orgId/integrations/maintenance-password')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  clearMaintenancePassword(@Param('orgId')orgId:string,@Req()req:RequestWithUser){
    return this.orgsService.clearMaintenancePassword(orgId,req.user!.id);
  }

  @Post(':orgId/detection/frigate/test')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  async testFrigate(@Param('orgId') orgId: string, @Req() req: RequestWithUser) {
    return this.orgsService.testFrigateConnection(orgId, req.user!.id);
  }
}
