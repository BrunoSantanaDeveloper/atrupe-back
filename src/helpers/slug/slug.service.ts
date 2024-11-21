import { Injectable } from '@nestjs/common';
import slugify from 'slugify';

@Injectable()
export class SlugService {
  generate(name: string): string {
    return slugify(name, { lower: true, strict: true });
  }
}
