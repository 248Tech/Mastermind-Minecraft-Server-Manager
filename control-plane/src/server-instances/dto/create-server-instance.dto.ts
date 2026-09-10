import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';

const GAME_TYPE_MINECRAFT = 'minecraft';

/** Supported game type slugs (resolved to gameTypeId). */
export const SUPPORTED_GAME_TYPES = [GAME_TYPE_MINECRAFT] as const;

export class CreateServerInstanceDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(128)
  name: string;

  @IsString()
  @IsNotEmpty()
  hostId: string;

  /** Game type slug. Stored as gameTypeId (resolved from slug). */
  @IsString()
  @IsNotEmpty()
  @Matches(/^minecraft$/i, { message: 'gameType must be minecraft' })
  gameType: string = GAME_TYPE_MINECRAFT;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  installPath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  startCommand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[\w.-]+$/, { message: 'telnetHost must be hostname or IP' })
  telnetHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  telnetPort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  telnetPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  mapEmbedUrl?: string;
}
