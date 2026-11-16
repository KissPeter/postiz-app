import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ThreadsDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  topic_tag?: string;
}
