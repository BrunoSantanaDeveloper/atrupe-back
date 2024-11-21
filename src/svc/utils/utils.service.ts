import { Injectable } from '@nestjs/common';
import { PlugService } from '../plug/plug.service';
import { PrismaService } from 'nestjs-prisma';

@Injectable()
export class UtilsService {
  constructor(
    private readonly plugService: PlugService,
    private readonly prisma: PrismaService,
  ) {}

  states() {
    return this.prisma.state.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async createStates() {
    const states = await this.plugService.states();

    for (const state of states) {
      await this.prisma.state.create({
        data: {
          name: state.name,
          code: state.code,
          isActive: true,
        },
      });
    }
  }

  cities(state?: string) {
    const where = state ? { stateId: state } : {};

    return this.prisma.city.findMany({
      where: {
        ...where,
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  city(id: string) {
    return this.prisma.city.findUnique({
      where: {
        id: id,
        isActive: true,
      },
    });
  }

  async createCity() {
    const states = await this.states();

    for (const state of states) {
      const cities = await this.plugService.cities(state.code);

      for (const city of cities) {
        await this.prisma.city.create({
          data: {
            name: city.name,
            code: city.code,
            stateId: state.id,
            isActive: true,
          },
        });
      }
    }
  }

  zipcode(zipcode: string) {
    return this.plugService.zipcode(zipcode);
  }
}
