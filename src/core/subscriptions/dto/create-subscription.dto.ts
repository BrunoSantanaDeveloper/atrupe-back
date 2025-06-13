import {
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CreateCustomerDto } from 'src/core/customers/dto/create-customer.dto';
import { Type } from 'class-transformer';
import { Cycle } from '@prisma/client';
import { BillingType } from '@prisma/client';

export class CreateSubscriptionDto {
  @ApiProperty({ type: () => CreateCustomerDto })
  @ValidateNested()
  @Type(() => CreateCustomerDto)
  customer: CreateCustomerDto;

  @ApiProperty()
  @IsString()
  planId: string;

  @ApiProperty()
  @IsNumber()
  additionalAccesses: number;

  @ApiProperty({ enum: BillingType })
  @IsEnum(BillingType)
  billingType: BillingType;

  @ApiProperty({ enum: Cycle })
  @IsEnum(Cycle)
  cycle: Cycle;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modules?: string[];
}
