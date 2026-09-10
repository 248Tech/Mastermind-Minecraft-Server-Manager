import { BadRequestException, Body, Controller, Get, GoneException, Headers, Post, Query, Req, UnauthorizedException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PlayerAuthService } from './player-auth.service';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { clientIp } from '../common/client-ip';
import { SteamVerifyDto } from './dto/steam-verify.dto';
import { NameAuthDto } from './dto/name-auth.dto';

@Controller('api/player-auth')
export class PlayerAuthController {
  constructor(
    private readonly auth: PlayerAuthService,
    private readonly rateLimit: AuthRateLimitService,
  ) {}

  @Post('steam/verify')
  async verify(
    @Body() body: SteamVerifyDto,
    @Req() req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  ) {
    await this.rateLimit.consumeSteamVerify(clientIp(req));
    return this.auth.verifySteam(body.serverInstanceId, body.returnTo, body.openid ?? {});
  }

  @Post('register')
  async register(
    @Body() body: NameAuthDto,
    @Req() req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  ) {
    await this.rateLimit.consumePlayerPortalRegister(clientIp(req));
    return this.auth.registerName(body);
  }

  @Post('login')
  async login(
    @Body() body: NameAuthDto,
    @Req() req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  ) {
    await this.rateLimit.consumePlayerPortalLogin(clientIp(req));
    return this.auth.loginName(body);
  }

  @Get('me')
  me(@Headers('authorization') authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Player session required');
    return this.auth.profile(authorization.slice(7));
  }

  @Get('mods')
  mods(@Headers('authorization') authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Player session required');
    return this.auth.portalMods(authorization.slice(7));
  }

  @Get('pois')
  pois(@Headers('authorization') authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Player session required');
    throw new GoneException('POI search is not available for Minecraft servers');
  }

  @Get('pois/preview')
  poiPreview(@Headers('authorization') authorization?: string, @Query('name') _name?: string) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Player session required');
    throw new GoneException('POI preview is not available for Minecraft servers');
  }

  @Post('mod-request')
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1, fileSize: 256 * 1024 * 1024 } }))
  requestMod(
    @Headers('authorization') authorization?: string,
    @Body('description') description?: string,
    @UploadedFile() file?: { originalname: string; size: number; buffer: Buffer },
  ) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Player sign-in required');
    return this.auth.requestMod(authorization.slice(7), file, description);
  }

  @Get('places')
  places(@Headers('authorization') authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Player session required');
    throw new GoneException('Claims, homes, and vehicles are not available for Minecraft servers');
  }

  @Post('vehicles/return')
  returnVehicle(@Headers('authorization') authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Player session required');
    throw new GoneException('Vehicle return is not available for Minecraft servers');
  }

  @Get('map/entities')
  async mapEntities(@Headers('authorization') authorization?: string) {
    // Minecraft portals embed BlueMap/Dynmap; Allocs entity feeds are unused.
    if (authorization?.startsWith('Bearer ')) {
      try {
        await this.auth.requirePlayer(authorization.slice(7));
      } catch {
        /* optional auth — still return empty payload */
      }
    }
    return {
      players: [],
      animals: [],
      hostiles: [],
      playerVisibility: 'hidden' as const,
      errors: {
        players: 'Map entities unavailable for Minecraft',
        animals: 'Map entities unavailable for Minecraft',
        hostiles: 'Map entities unavailable for Minecraft',
      },
    };
  }
}
