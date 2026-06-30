import { PartialType } from '@nestjs/swagger';
import { CreateContactSourceDto } from './create-contact-source.dto';

export class UpdateContactSourceDto extends PartialType(
  CreateContactSourceDto,
) {}
