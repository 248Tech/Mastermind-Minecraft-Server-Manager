import { Module } from '@nestjs/common';
import { PairingModule } from './pairing/pairing.module';
import { ServerInstancesModule } from './server-instances/server-instances.module';
import { AlertsModule } from './alerts/alerts.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { BatchesModule } from './batches/batches.module';
import { JobsModule } from './jobs/jobs.module';
import { GameTypesModule } from './game-types/game-types.module';
import { HealthModule } from './health/health.module';
import { HostsModule } from './hosts/hosts.module';
import { AuthModule } from './auth/auth.module';
import { OrgsModule } from './orgs/orgs.module';
import { WebsocketModule } from './websocket/websocket.module';
import { LogsModule } from './logs/logs.module';
import { HealthMonitorModule } from './health-monitor/health-monitor.module';
import { PlayersModule } from './players/players.module';
import { PlayerAuthModule } from './player-auth/player-auth.module';
import { DonationsModule } from './donations/donations.module';
import { TriggersModule } from './triggers/triggers.module';

@Module({
  imports: [
    // WebsocketModule is @Global() — provides BATCH_PROGRESS_EMITTER everywhere
    WebsocketModule,
    HealthModule,
    AuthModule,
    OrgsModule,
    PairingModule,
    HostsModule,
    ServerInstancesModule,
    AlertsModule,
    SchedulerModule,
    BatchesModule,
    JobsModule,
    GameTypesModule,
    LogsModule,
    HealthMonitorModule,
    PlayersModule,
    PlayerAuthModule,
    DonationsModule,
    TriggersModule,
  ],
})
export class AppModule {}
