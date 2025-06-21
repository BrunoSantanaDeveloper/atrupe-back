import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { CreateAcademySystemDto } from './dto/create-academy-system.dto';
import { UpdateAcademySystemDto } from './dto/update-academy-system.dto';
import { CreateAcademyProgressDto } from './dto/create-academy-progress.dto';

@Injectable()
export class AcademyService {
  constructor(private prisma: PrismaService) {}

  async createAcademySystem(data: CreateAcademySystemDto) {
    return this.prisma.academySystem.create({
      data,
    });
  }

  async updateAcademySystem(id: string, data: UpdateAcademySystemDto) {
    return await this.prisma.academySystem.update({
      where: { id },
      data,
    });
  }

  async deleteAcademySystem(id: string) {
    try {
      await this.prisma.academyProgress.deleteMany({
        where: { academySystemId: id },
      });
      return await this.prisma.academySystem.delete({
        where: { id },
      });
    } catch (error) {
      console.error('Error deleting academy system:', error);
      throw error;
    }
  }

  async getAcademySystemsByType(type: string, companyId: string) {
    const systems = await this.prisma.academySystem.findMany({
      where: {
        type: {
          has: type,
        },
      },
      include: {
        AcademyProgress: {
          where: {
            companyId,
          },
          select: {
            checked: true,
          },
        },
      },
      orderBy: {
        order: 'asc',
      },
    });

    // Transform the data to match the frontend interface
    const transformedSystems = systems.map((system) => ({
      id: system.id,
      description: system.description || '',
      checked:
        system.AcademyProgress.length > 0
          ? system.AcademyProgress[0].checked
          : false,
      files: system.files,
      video: system.videoUrl,
      page: system.page,
      modal: system.modal,
      buttonTitle: system.buttonTitle,
      section: system.section,
    }));

    // Group by section and create the final structure
    const sections = transformedSystems.reduce<any[]>((acc, system) => {
      const sectionIndex = acc.findIndex(
        (section) => section.title === system.section,
      );

      if (sectionIndex === -1) {
        acc.push({
          title: system.section,
          items: [system],
        });
      } else {
        acc[sectionIndex].items.push(system);
      }

      return acc;
    }, []);

    return {
      plan: type,
      sections,
    };
  }

  async createAcademyProgress(data: CreateAcademyProgressDto) {
    try {
      // Verificar se o academySystem existe
      const academySystem = await this.prisma.academySystem.findUnique({
        where: { id: data.itemId },
      });

      if (!academySystem) {
        throw new Error(`Academy system with id ${data.itemId} not found`);
      }

      return await this.prisma.academyProgress.create({
        data: {
          academySystemId: data.itemId,
          companyId: data.companyId,
          checked: true,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      console.error('Error creating academy progress:', error);
      throw error;
    }
  }

  async extractData() {
    const companyBase = '2a190fe8-e7af-4d75-8673-494dbae0372b';
    const products = await this.prisma.product.findMany({
      where: {
        companyId: companyBase,
      },
      include: {
        category: true,
        items: {
          include: {
            unitOfMeasure: true,
          },
        },
        sector: true,
      },
    });
    return products;
  }
}
