import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { PlayersController } from './players.controller';
import { PlayersService } from './players.service';
import { JobsModule } from '../jobs/jobs.module';
import { ServerToolsController } from './server-tools.controller';
import { RequireOrgRoleGuard } from '../server-instances/guards/require-org-role.guard';

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET || 'change-me-user-secret' }), JobsModule],
  controllers: [PlayersController, ServerToolsController], providers: [PlayersService, PrismaService, OrgMemberGuard, RequireOrgRoleGuard],
})
export class PlayersModule {}
