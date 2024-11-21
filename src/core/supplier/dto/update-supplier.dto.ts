import { PartialType } from '@nestjs/mapped-types';
import { UpdateClientDto } from '../../client/dto/update-client.dto';

export class UpdateSupplierDto extends PartialType(UpdateClientDto) {}
