import { Controller, Get } from '@nestjs/common';
import { PlayerAuthService } from './player-auth.service';

@Controller('api/public')
export class PublicLandingController {
  constructor(private readonly players: PlayerAuthService) {}

  @Get('landing')
  landing() {
    return this.players.publicLanding();
  }

  @Get('map')
  map() {
    return this.players.publicMap();
  }
}
