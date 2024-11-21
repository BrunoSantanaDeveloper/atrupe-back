import { CreateClientDto } from '../../client/dto/create-client.dto';
import { PartialType } from '@nestjs/mapped-types';

export class CreateSupplierDto extends PartialType(CreateClientDto) {}
