import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { PairingModule } from '../pairing/pairing.module';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { RequireOrgRoleGuard } from '../server-instances/guards/require-org-role.guard';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';
import { AlertsModule } from '../alerts/alerts.module';
import { JobsModule } from '../jobs/jobs.module';
import { TriggersModule } from '../triggers/triggers.module';

@Module({
  imports: [
    PairingModule,
    AlertsModule,
    JobsModule,
    forwardRef(() => TriggersModule),
    JwtModule.register({ secret: process.env.JWT_SECRET || 'change-me-user-secret' }),
  ],
  controllers: [LogsController],
  providers: [LogsService, PrismaService, OrgMemberGuard, RequireOrgRoleGuard],
})
export class LogsModule {}
