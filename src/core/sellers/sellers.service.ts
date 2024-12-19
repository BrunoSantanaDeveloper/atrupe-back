import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from 'src/config/prisma/prisma.service';

@Injectable()
export class SellersService {
  constructor(private prisma: PrismaService) {}
  // create(createSellerDto: CreateSellerDto) {
  //   return 'This action adds a new seller';
  // }

  async findAll(companyId: string) {
    try {
      const employees = await this.prisma.employee.findMany({
        where: {
          companyId,
          sellerProfile: {
            isNot: null,
          },
        },
        select: {
          id: true,
          name: true,
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          user: {
            name: 'asc',
          },
        },
      });

      // Mapeia os funcionários para um array de objetos com id e userName
      const data = employees.map((employee) => {
        return {
          id: employee.id,
          name: employee.name ?? employee.user.name,
        };
      });
      return data;
    } catch (error) {
      console.error('Error fetching employees:', error);
      throw new BadRequestException('Error fetching employees');
    }
  }
  // findOne(id: number) {
  //   return `This action returns a #${id} seller`;
  // }

  // update(id: number, updateSellerDto: UpdateSellerDto) {
  //   return `This action updates a #${id} seller`;
  // }

  // remove(id: number) {
  //   return `This action removes a #${id} seller`;
  // }
}
