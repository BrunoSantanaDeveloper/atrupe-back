import { IsBoolean } from 'class-validator';

export class UpdateAiAccessConfigDto {
  @IsBoolean()
  enabled: boolean;
}
