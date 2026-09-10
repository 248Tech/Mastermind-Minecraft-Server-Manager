import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { PlayersService } from './players.service';

@Controller('api/orgs/:orgId/players')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class PlayersController {
  constructor(private readonly players: PlayersService) {}
  @Get()
  list(@Param('orgId') orgId: string, @Query('serverInstanceId') serverInstanceId?: string) {
    return this.players.list(orgId, serverInstanceId);
  }
}
