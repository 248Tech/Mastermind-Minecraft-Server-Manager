import { IsBoolean, IsOptional, IsString, MaxLength, Min, Max, IsInt, Matches, MinLength } from 'class-validator';

export class UpdateServerInstanceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  hostId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^minecraft$/i, { message: 'gameType must be minecraft' })
  gameType?: string;

  @IsOptional()
  @IsString()
  installPath?: string;

  @IsOptional()
  @IsString()
  startCommand?: string;

  /** Pack update script relative to installPath (e.g. update.bat). Stored in config.update_command. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  updateCommand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[\w.-]+$/, { message: 'rconHost must be hostname or IP' })
  rconHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  rconPort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  rconPassword?: string;

  @IsOptional()
  @IsBoolean()
  rebootIfDown?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  mapEmbedUrl?: string;
}
